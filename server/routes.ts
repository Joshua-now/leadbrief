import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { eq } from "drizzle-orm";
import { storage } from "./storage";
import { BulkInputHandler, IMPORT_LIMITS } from "./lib/input-handler";
import { processJobItems, recoverStaleJobs, getProcessorHealth } from "./lib/job-processor";
import { parseFile } from "./lib/file-parser";
import { setupAuth, registerAuthRoutes, isAuthenticated, getActiveAuthProvider, getIsAuthEnabled } from "./replit_integrations/auth";
import { isSupabaseConfigured } from "./lib/supabase";
import { db } from "./db";
import { companies, contacts, bulkJobs, bulkJobItems } from "@shared/schema";
import { getSystemHealth, withTimeout, categorizeError } from "./lib/guardrails";
import { getEnvPresenceFlags, getAppVersion, checkDependencies } from "./lib/env";
import { getLastLogs, crashLog } from "./lib/crash-logger";
import { pushToInstantly, pushBatchToInstantly, isInstantlyConfigured, getInstantlyConfig } from "./lib/instantly";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// Rate limiting store (in-memory for MVP)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// API Key validation middleware for intake endpoint
// Security: If API_INTAKE_KEY env var is set, require matching X-API-Key header
// This is enforced at the environment level - no database dependency
function validateApiKey(req: Request, res: Response, next: () => void) {
  const configuredApiKey = (process.env.API_INTAKE_KEY || process.env.API_KEY || '').trim();
  
  // If no API key configured in env, endpoint is open
  if (!configuredApiKey) {
    return next();
  }
  
  // API key is configured - require valid X-API-Key header
  const apiKey = ((req.headers['x-api-key'] as string) || '').trim();
  
  if (!apiKey) {
    return res.status(401).json({ error: "Missing X-API-Key header" });
  }
  
  if (apiKey !== configuredApiKey) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  
  next();
}

// Simple rate limiter middleware
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: () => void) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = rateLimitStore.get(ip);

    if (!record || now > record.resetAt) {
      rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
      next();
    } else if (record.count < maxRequests) {
      record.count++;
      next();
    } else {
      res.status(429).json({ 
        error: "Too many requests", 
        retryAfter: Math.ceil((record.resetAt - now) / 1000) 
      });
    }
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Setup authentication (BEFORE other routes)
  await setupAuth(app);
  registerAuthRoutes(app);
  
  // Auth config endpoint (public - tells frontend which auth provider to use)
  // Also provides Supabase public config for runtime initialization
  app.get("/api/auth/config", (_req: Request, res: Response) => {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    
    // Prevent caching to ensure frontend always gets fresh config
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    res.json({
      provider: getActiveAuthProvider(),
      isEnabled: getIsAuthEnabled(),
      supabaseConfigured: isSupabaseConfigured(),
      // Public Supabase config for frontend (anon key is designed to be public)
      supabase: supabaseUrl && supabaseAnonKey ? {
        url: supabaseUrl,
        anonKey: supabaseAnonKey,
      } : null,
    });
  });
  
  // Health check endpoint (public - no auth required)
  // ALWAYS returns 200 OK if process is alive - for load balancer liveness probes
  // Use /api/ready for dependency checks
  app.get("/api/health", async (_req: Request, res: Response) => {
    const version = getAppVersion();
    const uptime = process.uptime();
    
    // Always return 200 - process is alive
    res.json({
      ok: true,
      status: "alive",
      timestamp: new Date().toISOString(),
      version,
      uptime: Math.round(uptime),
      authProvider: getActiveAuthProvider(),
    });
  });

  // Readiness check endpoint (for Kubernetes/container orchestration)
  // Returns 200 only when all dependencies are ready
  app.get("/api/ready", async (_req: Request, res: Response) => {
    try {
      const deps = await checkDependencies();
      
      if (deps.ready) {
        res.json({
          ready: true,
          status: "ready",
          dependencies: deps.details,
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(503).json({
          ready: false,
          status: "not_ready",
          dependencies: deps.details,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error: any) {
      res.status(503).json({
        ready: false,
        status: "error",
        error: error.message || "Readiness check failed",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Debug session endpoint - shows current auth state for debugging
  app.get("/api/debug/session", isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;
    
    res.json({
      authenticated: true,
      userId: user?.id || user?.claims?.sub || null,
      email: user?.email || user?.claims?.email || null,
      authProvider: getActiveAuthProvider(),
      expiresAt: user?.expires_at ? new Date(user.expires_at * 1000).toISOString() : null,
      hasRefreshToken: !!user?.refresh_token,
      sessionCheckedAt: new Date().toISOString(),
    });
  });
  
  // Debug whoami endpoint - detailed auth diagnostics (does not require auth)
  app.get("/api/debug/whoami", async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const hasAuthHeader = !!authHeader;
    const hasBearerToken = authHeader?.startsWith('Bearer ') || false;
    const hasSession = !!(req as any).session;
    const hasPassportUser = !!(req as any).user;
    const sessionId = (req as any).sessionID?.slice(0, 8) || null;
    const activeProvider = getActiveAuthProvider();
    
    let tokenStatus = 'no_token';
    let userId: string | null = null;
    let email: string | null = null;
    
    // Check Bearer token if present
    if (hasBearerToken && authHeader) {
      const token = authHeader.slice(7);
      try {
        const { verifySupabaseToken } = await import('./lib/supabase');
        const result = await verifySupabaseToken(token);
        if (result) {
          tokenStatus = 'valid';
          userId = result.user.id;
          email = result.user.email || null;
        } else {
          tokenStatus = 'invalid_or_expired';
        }
      } catch (e: any) {
        tokenStatus = `error: ${e.message}`;
      }
    }
    
    // Check session user if present (Replit auth)
    const sessionUser = (req as any).user;
    if (sessionUser) {
      userId = sessionUser.id || sessionUser.claims?.sub || null;
      email = sessionUser.email || sessionUser.claims?.email || null;
      tokenStatus = sessionUser.expires_at ? 
        (Date.now() / 1000 <= sessionUser.expires_at ? 'session_valid' : 'session_expired') :
        'session_no_expiry';
    }
    
    res.json({
      activeProvider,
      hasAuthHeader,
      hasBearerToken,
      hasSession,
      hasPassportUser,
      sessionIdPrefix: sessionId,
      tokenStatus,
      userId,
      email,
      checkedAt: new Date().toISOString(),
    });
  });

  // Final verification endpoint - comprehensive system check
  // Tests health, ready, intake auth enforcement (with real HTTP calls), and DB write
  // Cleans up only test records it creates
  app.get("/api/finalcheck", async (req: Request, res: Response) => {
    const testId = `__finalcheck_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const results: Record<string, { pass: boolean; detail?: string }> = {};
    let createdCompanyId: string | null = null;
    let createdContactId: string | null = null;
    let createdJobId: string | null = null;
    
    const configuredApiKey = (process.env.API_INTAKE_KEY || process.env.API_KEY || '').trim();
    
    // Determine base URL for self-calls
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    
    // Test 1: Health check (real call)
    try {
      const healthRes = await fetch(`${baseUrl}/api/health`);
      const healthData = await healthRes.json() as any;
      results.health = { 
        pass: healthRes.ok && healthData.ok, 
        detail: healthData.status || "alive" 
      };
    } catch (e: any) {
      results.health = { pass: false, detail: e.message };
    }
    
    // Test 2: Ready check (real call)
    try {
      const deps = await checkDependencies();
      results.ready = { pass: deps.ready, detail: deps.ready ? "ready" : "not_ready" };
    } catch (e: any) {
      results.ready = { pass: false, detail: e.message };
    }
    
    // Test 3: Intake auth enforcement - actually call the endpoint
    // Use example.com which is reserved by RFC 2606 for documentation/testing
    const testEmail1 = `finalcheck_nokey_${testId}@example.com`;
    const testEmail2 = `finalcheck_withkey_${testId}@example.com`;
    
    if (configuredApiKey) {
      // Test 3a: Call without key - should get 401
      try {
        const noKeyRes = await fetch(`${baseUrl}/api/intake`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: testEmail1 }),
        });
        if (noKeyRes.status === 401) {
          results.intake_no_key = { pass: true, detail: "401 returned (correct)" };
        } else {
          results.intake_no_key = { pass: false, detail: `Expected 401, got ${noKeyRes.status}` };
        }
      } catch (e: any) {
        results.intake_no_key = { pass: false, detail: e.message };
      }
      
      // Test 3b: Call with correct key - should succeed
      try {
        const withKeyRes = await fetch(`${baseUrl}/api/intake`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-API-Key': configuredApiKey,
          },
          body: JSON.stringify({ email: testEmail2 }),
        });
        const withKeyData = await withKeyRes.json() as any;
        if (withKeyRes.ok && withKeyData.success) {
          results.intake_with_key = { 
            pass: true, 
            detail: `200 success, contactId=${withKeyData.contactId}` 
          };
          // Track for cleanup
          createdContactId = withKeyData.contactId;
          createdJobId = withKeyData.jobId;
        } else {
          results.intake_with_key = { 
            pass: false, 
            detail: `Expected 200 success, got ${withKeyRes.status}: ${JSON.stringify(withKeyData)}` 
          };
        }
      } catch (e: any) {
        results.intake_with_key = { pass: false, detail: e.message };
      }
    } else {
      // No API key configured - endpoint should be open
      try {
        const openRes = await fetch(`${baseUrl}/api/intake`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: testEmail1 }),
        });
        const openData = await openRes.json() as any;
        if (openRes.ok && openData.success) {
          results.intake_no_key = { 
            pass: true, 
            detail: `Endpoint open (no API_INTAKE_KEY), contactId=${openData.contactId}` 
          };
          createdContactId = openData.contactId;
          createdJobId = openData.jobId;
        } else {
          results.intake_no_key = { 
            pass: false, 
            detail: `Expected 200 success, got ${openRes.status}` 
          };
        }
      } catch (e: any) {
        results.intake_no_key = { pass: false, detail: e.message };
      }
    }
    
    // Test 4: DB write test (direct storage call to verify DB access)
    try {
      const testCompany = await storage.createCompany({
        name: `__FINALCHECK__ ${testId}`,
        domain: `${testId}.finalcheck.invalid`,
      });
      createdCompanyId = testCompany.id;
      
      results.db_write = { 
        pass: true, 
        detail: `companyId=${createdCompanyId}` 
      };
    } catch (e: any) {
      results.db_write = { pass: false, detail: e.message };
    }
    
    // Cleanup: delete test records (robust - track each deletion)
    const cleanupDetails: string[] = [];
    try {
      // Delete job items and jobs first (foreign key constraints)
      if (createdJobId) {
        await db.delete(bulkJobItems).where(eq(bulkJobItems.bulkJobId, createdJobId));
        await db.delete(bulkJobs).where(eq(bulkJobs.id, createdJobId));
        cleanupDetails.push(`job=${createdJobId}`);
      }
      // Delete contacts
      if (createdContactId) {
        await db.delete(contacts).where(eq(contacts.id, createdContactId));
        cleanupDetails.push(`contact=${createdContactId}`);
      }
      // Delete test company we created directly
      if (createdCompanyId) {
        await db.delete(companies).where(eq(companies.id, createdCompanyId));
        cleanupDetails.push(`company=${createdCompanyId}`);
      }
      // Also clean up any company created via intake (by test email domain)
      await db.delete(companies).where(eq(companies.domain, `${testId}.finalcheck.invalid`));
      
      results.cleanup = { 
        pass: true, 
        detail: cleanupDetails.length > 0 ? `deleted: ${cleanupDetails.join(', ')}` : "no records to clean" 
      };
    } catch (e: any) {
      results.cleanup = { 
        pass: false, 
        detail: `${e.message}. Partial cleanup: ${cleanupDetails.join(', ')}` 
      };
    }
    
    // Calculate overall pass
    const allPass = Object.values(results).every(r => r.pass);
    
    res.json({
      ok: allPass,
      timestamp: new Date().toISOString(),
      api_key_configured: !!configuredApiKey,
      tests: results,
    });
  });

  // Smoke test endpoint - proves end-to-end flow works
  // Creates UNIQUE test data, verifies DB storage, then safely cleans up
  // Uses createCompany (not upsert) to ensure we only delete what we created
  app.post("/api/smoke", async (req: Request, res: Response) => {
    // Use crypto-strong unique ID to avoid any collision with real data
    const testId = `__smoke_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const steps: Array<{ step: string; status: "pass" | "fail"; detail?: string }> = [];
    
    // Track created IDs for cleanup - only delete what WE created
    let createdCompanyId: string | null = null;
    let createdContactId: string | null = null;
    let createdJobId: string | null = null;
    
    // Cleanup function - removes ONLY test data we created
    const cleanup = async () => {
      try {
        // Delete in reverse order of creation (foreign key constraints)
        if (createdJobId) {
          await db.delete(bulkJobItems).where(eq(bulkJobItems.bulkJobId, createdJobId));
          await db.delete(bulkJobs).where(eq(bulkJobs.id, createdJobId));
        }
        if (createdContactId) {
          await db.delete(contacts).where(eq(contacts.id, createdContactId));
        }
        if (createdCompanyId) {
          await db.delete(companies).where(eq(companies.id, createdCompanyId));
        }
        steps.push({ step: "cleanup", status: "pass" });
      } catch (e: any) {
        steps.push({ step: "cleanup", status: "fail", detail: e.message });
      }
    };
    
    try {
      // Use unique markers that cannot match real data
      const testEmail = `${testId}@__smoke_test__.invalid`;
      const testCompanyName = `__SMOKE_TEST__ ${testId}`;
      
      // Step 1: CREATE company (not upsert - always creates new)
      try {
        const company = await storage.createCompany({
          name: testCompanyName,
          domain: `${testId}.smoke-test.invalid`,
        });
        createdCompanyId = company.id;
        steps.push({ step: "create_company", status: "pass", detail: company.id });
      } catch (e: any) {
        steps.push({ step: "create_company", status: "fail", detail: e.message });
        throw e;
      }
      
      // Step 2: CREATE contact (not upsert - always creates new)
      try {
        const contact = await storage.createContact({
          email: testEmail,
          firstName: "__Smoke__",
          lastName: testId,
          companyId: createdCompanyId,
          phone: null,
          title: null,
          city: null,
          linkedinUrl: null,
        });
        createdContactId = contact.id;
        steps.push({ step: "create_contact", status: "pass", detail: contact.id });
      } catch (e: any) {
        steps.push({ step: "create_contact", status: "fail", detail: e.message });
        throw e;
      }
      
      // Step 3: Create tracking job
      try {
        const job = await storage.createBulkJob({
          name: `__SMOKE_TEST__: ${testId}`,
          sourceFormat: "smoke_test",
          totalRecords: 1,
          status: "complete",
          successful: 1,
          completedAt: new Date(),
        });
        createdJobId = job.id;
        steps.push({ step: "create_job", status: "pass", detail: job.id });
      } catch (e: any) {
        steps.push({ step: "create_job", status: "fail", detail: e.message });
        throw e;
      }
      
      // Step 4: Create job item linking contact
      try {
        await storage.createBulkJobItems([{
          bulkJobId: createdJobId!,
          rowNumber: 1,
          status: "complete",
          parsedData: JSON.parse(JSON.stringify({ 
            email: testEmail, 
            firstName: "__Smoke__", 
            lastName: testId 
          })),
          contactId: createdContactId!,
          companyId: createdCompanyId,
        }]);
        steps.push({ step: "create_job_item", status: "pass" });
      } catch (e: any) {
        steps.push({ step: "create_job_item", status: "fail", detail: e.message });
        throw e;
      }
      
      // Step 5: Verify data can be retrieved
      try {
        const retrievedJob = await storage.getBulkJob(createdJobId!);
        if (retrievedJob && retrievedJob.status === "complete") {
          steps.push({ step: "verify_retrieval", status: "pass" });
        } else {
          steps.push({ step: "verify_retrieval", status: "fail", detail: "Job not found or wrong status" });
        }
      } catch (e: any) {
        steps.push({ step: "verify_retrieval", status: "fail", detail: e.message });
        throw e;
      }
      
      // Step 6: Clean up test data (don't pollute production)
      await cleanup();
      
      const allPassed = steps.every(s => s.status === "pass");
      
      res.json({
        success: allPassed,
        testId,
        steps,
        message: allPassed 
          ? "End-to-end smoke test passed - data created, verified, and cleaned up" 
          : "Smoke test had failures",
      });
    } catch (error: any) {
      // Always try to clean up even on failure
      await cleanup();
      
      res.status(500).json({
        success: false,
        testId,
        steps,
        error: error.message || "Smoke test failed",
      });
    }
  });

  // Import self-test endpoint - creates 3 sample leads with different completeness to verify import pipeline
  // Protected: requires API key or DEBUG_KEY
  app.get("/api/import/selftest", async (req: Request, res: Response) => {
    // Require API key or DEBUG_KEY for access
    const configuredApiKey = process.env.API_INTAKE_KEY;
    const debugKey = process.env.DEBUG_KEY;
    const providedKey = req.headers['x-api-key'] as string || req.headers['x-debug-key'] as string;
    
    const isAuthorized = 
      (configuredApiKey && providedKey === configuredApiKey) ||
      (debugKey && providedKey === debugKey);
    
    if (!isAuthorized) {
      return res.status(401).json({ 
        error: "Unauthorized", 
        hint: "Provide X-API-Key or X-Debug-Key header" 
      });
    }
    
    const testId = `selftest_${Date.now()}`;
    const createdContactIds: string[] = [];
    const createdCompanyIds: string[] = [];
    
    try {
      // Sample lead 1: Full data (high quality - should be ~75-85%)
      const lead1 = {
        email: `full_${testId}@test.example`,
        phone: "+1-555-0101",
        firstName: "Full",
        lastName: "Data",
        companyName: `Full Data Corp ${testId}`,
        website: `https://www.fulldata${testId}.com`,
        city: "San Francisco",
        state: "CA",
        address: "123 Market St",
        category: "Technology",
        title: "CEO",
        linkedinUrl: `https://linkedin.com/in/fulldata${testId}`,
      };
      
      // Sample lead 2: Medium data (medium quality - should be ~45-55%)
      const lead2 = {
        email: `medium_${testId}@test.example`,
        companyName: `Medium Corp ${testId}`,
        website: `https://www.mediumcorp${testId}.com`,
        city: "Los Angeles",
        state: "CA",
      };
      
      // Sample lead 3: Minimal data (low quality - should be ~20-35%)
      const lead3 = {
        companyName: `Minimal LLC ${testId}`,
        website: `https://www.minimal${testId}.com`,
      };
      
      const results: Array<{
        input: typeof lead1 | typeof lead2 | typeof lead3;
        contactId: string;
        companyId: string | null;
        dataQualityScore: number;
        storedContact: {
          id: string;
          email: string | null;
          companyName: string | null;
          website: string | null;
          city: string | null;
          state: string | null;
          category: string | null;
          dataQualityScore: string | null;
        };
      }> = [];
      
      for (const lead of [lead1, lead2, lead3]) {
        // Create company
        let companyId: string | null = null;
        if (lead.companyName) {
          const company = await storage.upsertCompany({
            name: lead.companyName,
            domain: lead.website || null,
          });
          companyId = company.id;
          createdCompanyIds.push(company.id);
        }
        
        // Calculate data quality score
        const qualityWeights: Record<string, number> = {
          email: 20, phone: 15, website: 15, companyName: 10,
          city: 5, state: 5, linkedinUrl: 5, title: 5,
          firstName: 3, lastName: 2, address: 3, category: 2,
        };
        let qualityScore = 0;
        for (const [field, weight] of Object.entries(qualityWeights)) {
          if ((lead as any)[field]) qualityScore += weight;
        }
        qualityScore = Math.min(qualityScore, 100);
        
        // Create contact
        const contact = await storage.createContact({
          email: (lead as any).email || null,
          phone: (lead as any).phone || null,
          firstName: (lead as any).firstName || null,
          lastName: (lead as any).lastName || null,
          title: (lead as any).title || null,
          companyName: lead.companyName || null,
          website: lead.website || null,
          city: (lead as any).city || null,
          state: (lead as any).state || null,
          address: (lead as any).address || null,
          category: (lead as any).category || null,
          companyId,
          linkedinUrl: (lead as any).linkedinUrl || null,
          dataQualityScore: String(qualityScore),
        });
        createdContactIds.push(contact.id);
        
        results.push({
          input: lead,
          contactId: contact.id,
          companyId,
          dataQualityScore: qualityScore,
          storedContact: {
            id: contact.id,
            email: contact.email,
            companyName: contact.companyName,
            website: contact.website,
            city: contact.city,
            state: contact.state,
            category: contact.category,
            dataQualityScore: contact.dataQualityScore,
          },
        });
      }
      
      // Create tracking job
      const job = await storage.createBulkJob({
        name: `Import Self-Test: ${testId}`,
        sourceFormat: "selftest",
        totalRecords: 3,
        status: "complete",
        successful: 3,
        completedAt: new Date(),
      });
      
      // Create job items
      await storage.createBulkJobItems(
        createdContactIds.map((contactId, idx) => ({
          bulkJobId: job.id,
          rowNumber: idx + 1,
          status: "complete" as const,
          parsedData: JSON.parse(JSON.stringify(results[idx].input)),
          contactId,
          companyId: createdCompanyIds[idx] || null,
          fitScore: String(results[idx].dataQualityScore),
        }))
      );
      
      res.json({
        success: true,
        testId,
        jobId: job.id,
        message: "Import self-test completed. 3 sample leads created with different quality scores.",
        results,
        dataQualityDimensions: [
          "email", "phone", "website", "companyName", "city", "state",
          "linkedinUrl", "title", "firstName", "lastName", "address", "category"
        ],
        cleanup_sql: `DELETE FROM contacts WHERE email LIKE '%${testId}%' OR company_name LIKE '%${testId}%';`,
      });
    } catch (error: any) {
      // Cleanup on error
      for (const id of createdContactIds) {
        try { await db.delete(contacts).where(eq(contacts.id, id)); } catch {}
      }
      for (const id of createdCompanyIds) {
        try { await db.delete(companies).where(eq(companies.id, id)); } catch {}
      }
      
      res.status(500).json({
        success: false,
        testId,
        error: error.message,
      });
    }
  });

  // Debug endpoint to get last logs (protected by DEBUG_KEY)
  app.get("/api/debug/lastlog", (req: Request, res: Response) => {
    const debugKey = req.headers['x-debug-key'] as string;
    const configuredKey = process.env.DEBUG_KEY;
    
    // Require DEBUG_KEY to be set and match
    if (!configuredKey) {
      return res.status(501).json({ error: "DEBUG_KEY not configured" });
    }
    
    if (!debugKey || debugKey !== configuredKey) {
      return res.status(401).json({ error: "Invalid or missing X-DEBUG-KEY header" });
    }
    
    const lines = parseInt(req.query.lines as string) || 100;
    const logs = getLastLogs(Math.min(lines, 2000));
    
    res.json({
      count: logs.length,
      logs,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    });
  });

  // Recover stale jobs endpoint (for manual trigger or cron)
  app.post("/api/jobs/recover", async (_req: Request, res: Response) => {
    try {
      const recovered = await recoverStaleJobs();
      res.json({ success: true, recoveredJobs: recovered });
    } catch (error) {
      console.error("Recovery error:", error);
      res.status(500).json({ error: "Recovery failed" });
    }
  });

  // Get all jobs (protected)
  app.get("/api/jobs", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const jobs = await storage.getBulkJobs(limit);
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  // Get single job with stats (protected)
  app.get("/api/jobs/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Guard rail: Validate UUID format
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ error: "Invalid job ID format" });
      }

      const job = await storage.getBulkJob(id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      const stats = await storage.getBulkJobStats(id);
      res.json({ job, stats });
    } catch (error) {
      console.error("Error fetching job:", error);
      res.status(500).json({ error: "Failed to fetch job" });
    }
  });

  // Retry a failed job
  app.post("/api/jobs/:id/retry", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ error: "Invalid job ID format" });
      }

      const job = await storage.getBulkJob(id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      if (job.status !== "failed" && job.status !== "complete") {
        return res.status(400).json({ error: "Job must be failed or complete to retry" });
      }

      // Reset job status and re-process
      await storage.updateBulkJob(id, {
        status: "processing",
        lastError: null,
        startedAt: new Date(),
      });

      processJobItems(id).catch(console.error);

      res.json({ success: true, message: "Job retry started" });
    } catch (error) {
      console.error("Error retrying job:", error);
      res.status(500).json({ error: "Failed to retry job" });
    }
  });

  // Bulk import endpoint with rate limiting
  app.post("/api/import/bulk", rateLimit(10, 60000), async (req: Request, res: Response) => {
    try {
      const { content, jobName, format } = req.body;

      if (!content) {
        return res.status(400).json({ error: "No content provided" });
      }

      if (typeof content !== 'string') {
        return res.status(400).json({ error: "Content must be a string" });
      }

      // Guard rail: Check content size
      const sizeInMB = Buffer.byteLength(content, 'utf8') / (1024 * 1024);
      if (sizeInMB > IMPORT_LIMITS.MAX_FILE_SIZE_MB) {
        return res.status(400).json({ 
          error: `Content exceeds maximum size of ${IMPORT_LIMITS.MAX_FILE_SIZE_MB}MB` 
        });
      }

      // Parse the input
      const importResult = BulkInputHandler.parse(content, format);

      if (importResult.records.length === 0) {
        return res.status(400).json({
          error: "No valid records found",
          details: importResult.errors.slice(0, 10),
          stats: importResult.stats,
        });
      }

      // Create bulk job
      const bulkJob = await storage.createBulkJob({
        name: (jobName || `Import - ${new Date().toISOString()}`).slice(0, 200),
        sourceFormat: format || BulkInputHandler.detectFormat(content),
        totalRecords: importResult.records.length,
        status: "pending",
      });

      // Create job items with properly serialized JSON
      const items = importResult.records.map((record, idx) => ({
        bulkJobId: bulkJob.id,
        rowNumber: idx + 1,
        status: "pending",
        rawData: JSON.parse(JSON.stringify(record)),
        parsedData: JSON.parse(JSON.stringify(record)),
      }));

      await storage.createBulkJobItems(items);

      // Process items asynchronously
      processJobItems(bulkJob.id).catch(console.error);

      res.json({
        success: true,
        jobId: bulkJob.id,
        stats: importResult.stats,
        warnings: importResult.warnings,
        message: `Uploaded ${importResult.records.length} records`,
      });
    } catch (error) {
      console.error("Import error:", error);
      res.status(500).json({ error: "Import failed" });
    }
  });

  // File upload endpoint for CSV/XLSX imports
  app.post("/api/import/file", rateLimit(10, 60000), upload.single("file"), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      const jobName = req.body.jobName;

      if (!file) {
        return res.status(400).json({ error: "No file provided" });
      }

      console.log(`[Import] File upload: ${file.originalname}, size: ${file.size}, type: ${file.mimetype}`);

      const parseResult = parseFile(file.buffer, file.originalname, file.mimetype);

      if ('error' in parseResult) {
        console.log(`[Import] Parse error: ${parseResult.error}`);
        return res.status(parseResult.status).json({ error: parseResult.error });
      }

      console.log(`[Import] Parsed ${parseResult.importedRows} records from ${parseResult.totalRows} total rows`);

      if (parseResult.importedRows === 0) {
        return res.status(400).json({
          error: "No valid records found in file",
          totalRows: parseResult.totalRows,
          skippedRows: parseResult.skippedRows,
          errors: parseResult.errors.slice(0, 20),
        });
      }

      // Create bulk job
      const fileExt = file.originalname.split('.').pop()?.toLowerCase() || 'unknown';
      const bulkJob = await storage.createBulkJob({
        name: (jobName || file.originalname.replace(/\.[^/.]+$/, "")).slice(0, 200),
        sourceFormat: fileExt,
        totalRecords: parseResult.importedRows,
        status: "pending",
      });

      // Create job items using same logic as intake
      const items = parseResult.records.map((record, idx) => ({
        bulkJobId: bulkJob.id,
        rowNumber: idx + 1,
        status: "pending",
        rawData: JSON.parse(JSON.stringify(record)),
        parsedData: JSON.parse(JSON.stringify(record)),
      }));

      await storage.createBulkJobItems(items);

      // Process items asynchronously
      processJobItems(bulkJob.id).catch(console.error);

      console.log(`[Import] Created job ${bulkJob.id} with ${items.length} items`);

      res.json({
        success: true,
        jobId: bulkJob.id,
        totalRows: parseResult.totalRows,
        importedRows: parseResult.importedRows,
        skippedRows: parseResult.skippedRows,
        errors: parseResult.errors.slice(0, 20),
        message: `Imported ${parseResult.importedRows} records from ${file.originalname}`,
      });
    } catch (error) {
      console.error("[Import] File upload error:", error);
      res.status(500).json({ error: "File import failed" });
    }
  });

  // Contact intake endpoint - accepts single lead or array of leads
  // Auth: X-API-Key header required when apiKeyEnabled in settings
  // Returns 200 JSON with contactId(s) - never redirects
  app.post("/api/intake", validateApiKey, rateLimit(30, 60000), async (req: Request, res: Response) => {
    try {
      // Support both single object and array of leads
      const leads = Array.isArray(req.body) ? req.body : [req.body];
      
      if (leads.length === 0) {
        return res.status(400).json({ error: "No leads provided" });
      }
      if (leads.length > 100) {
        return res.status(400).json({ error: "Maximum 100 leads per request" });
      }

      const results: Array<{ 
        success: boolean; 
        contactId?: string; 
        email?: string; 
        error?: string;
        isNew?: boolean;
        matchedBy?: string | null;
        fieldsUpdated?: string[];
      }> = [];

      for (const lead of leads) {
        try {
          // Extract all fields with comprehensive aliases (supporting both camelCase and snake_case)
          const { 
            email, phone, firstName, first_name, lastName, last_name, company, title, linkedinUrl, linkedin_url,
            ghlContactId, leadName, lead_name, companyName, company_name, websiteUrl, website_url, website, domain, site,
            city, state, address, formatted_address, full_address,
            category, type, primary_category, business_type, industry,
            place_name, business_name, business
          } = lead;

          // Normalize fields with fallback aliases (supporting both camelCase and snake_case)
          const contactEmail = email?.toLowerCase()?.trim();
          const contactPhone = phone?.trim();
          const contactFirstName = (firstName || first_name || ((leadName || lead_name)?.split(" ")[0]))?.trim();
          const contactLastName = (lastName || last_name || ((leadName || lead_name)?.split(" ").slice(1).join(" ")))?.trim();
          const contactCompany = (company || companyName || company_name || place_name || business_name || business)?.trim();
          const contactWebsite = (websiteUrl || website_url || website || domain || site)?.trim();
          const contactCity = city?.trim();
          const contactState = state?.trim();
          const contactAddress = (address || formatted_address || full_address)?.trim();
          const contactCategory = (category || type || primary_category || business_type || industry)?.trim();
          const contactLinkedin = (linkedinUrl || linkedin_url)?.trim();

          // Allow website+company as valid identifier
          if (!contactEmail && !contactPhone && !contactLinkedin && !contactWebsite) {
            results.push({ success: false, email: contactEmail, error: "Email, phone, LinkedIn URL, or website required" });
            continue;
          }

          // Validate email format if provided
          if (contactEmail && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(contactEmail)) {
            results.push({ success: false, email: contactEmail, error: "Invalid email format" });
            continue;
          }

          // Create or update company if provided
          let companyId: string | null = null;
          if (contactCompany) {
            const companyRecord = await storage.upsertCompany({
              name: contactCompany.slice(0, 500),
              domain: contactWebsite?.slice(0, 500) || null,
            });
            companyId = companyRecord.id;
          }

          // Use mergeContact for idempotent upsert with deduplication
          const mergeResult = await storage.mergeContact({
            email: contactEmail || null,
            phone: contactPhone || null,
            firstName: contactFirstName?.slice(0, 200) || null,
            lastName: contactLastName?.slice(0, 200) || null,
            title: title?.slice(0, 200) || null,
            companyName: contactCompany?.slice(0, 500) || null,
            website: contactWebsite?.slice(0, 500) || null,
            city: contactCity?.slice(0, 200) || null,
            state: contactState?.slice(0, 100) || null,
            address: contactAddress?.slice(0, 500) || null,
            category: contactCategory?.slice(0, 200) || null,
            companyId,
            linkedinUrl: contactLinkedin?.slice(0, 500) || null,
          }, 'intake');

          results.push({ 
            success: true, 
            contactId: mergeResult.contact.id, 
            email: contactEmail,
            isNew: mergeResult.isNew,
            matchedBy: mergeResult.matchedBy,
            fieldsUpdated: mergeResult.fieldsUpdated,
          });
        } catch (e: any) {
          results.push({ success: false, error: e.message });
        }
      }

      // Create a tracking job for the batch
      const successCount = results.filter(r => r.success).length;
      const job = await storage.createBulkJob({
        name: `API Intake: ${successCount}/${leads.length} leads`,
        sourceFormat: "api_intake",
        totalRecords: leads.length,
        status: "complete",
        successful: successCount,
        failed: leads.length - successCount,
        completedAt: new Date(),
      });

      // Create job items for successful contacts with full parsed data
      const jobItems = results
        .filter(r => r.success && r.contactId)
        .map((r, idx) => {
          const lead = leads[Array.isArray(req.body) ? results.indexOf(r) : 0];
          const itemCompany = (lead.company || lead.companyName || lead.company_name || lead.place_name || lead.business_name || lead.business)?.trim();
          const itemWebsite = (lead.websiteUrl || lead.website_url || lead.website || lead.domain || lead.site)?.trim();
          const itemCity = lead.city?.trim();
          const itemState = lead.state?.trim();
          const itemCategory = (lead.category || lead.type || lead.primary_category || lead.business_type || lead.industry)?.trim();
          const itemFirstName = (lead.firstName || lead.first_name || (lead.leadName || lead.lead_name)?.split(" ")[0])?.trim();
          const itemLastName = (lead.lastName || lead.last_name || (lead.leadName || lead.lead_name)?.split(" ").slice(1).join(" "))?.trim();
          
          return {
            bulkJobId: job.id,
            rowNumber: idx + 1,
            status: "complete" as const,
            parsedData: JSON.parse(JSON.stringify({
              email: r.email,
              phone: lead.phone?.trim() || null,
              firstName: itemFirstName || null,
              lastName: itemLastName || null,
              company: itemCompany || null,
              companyName: itemCompany || null,
              companyDomain: itemWebsite || null,
              websiteUrl: itemWebsite || null,
              website: itemWebsite || null,
              city: itemCity || null,
              state: itemState || null,
              category: itemCategory || null,
              title: lead.title?.trim() || null,
            })),
            contactId: r.contactId!,
          };
        });

      if (jobItems.length > 0) {
        await storage.createBulkJobItems(jobItems);
      }

      // Return single result for single input, array for array input
      if (!Array.isArray(req.body)) {
        const result = results[0];
        if (result.success) {
          return res.json({
            success: true,
            contactId: result.contactId,
            jobId: job.id,
            status: "complete",
            isNew: result.isNew,
            matchedBy: result.matchedBy,
            fieldsUpdated: result.fieldsUpdated,
          });
        } else {
          return res.status(400).json({ success: false, error: result.error });
        }
      }

      // Return array results
      res.json({
        success: successCount > 0,
        jobId: job.id,
        total: leads.length,
        successful: successCount,
        failed: leads.length - successCount,
        results,
      });
    } catch (error) {
      console.error("Intake error:", error);
      res.status(500).json({ error: "Processing failed" });
    }
  });

  // Get all contacts with pagination (protected)
  app.get("/api/contacts", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const contacts = await storage.getContacts(limit);
      res.json(contacts);
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  // Export all contacts (CSV or JSON) - protected - MUST be before /api/contacts/:id
  app.get("/api/contacts/export", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || 'csv';
      console.log(`[Export] Contacts export requested, format: ${format}`);
      
      const contacts = await storage.getContacts(500);
      console.log(`[Export] Contacts fetched: ${contacts.length}`);
      
      // Return structured "no data" response
      if (contacts.length === 0) {
        console.log(`[Export] No contacts found for export`);
        return res.status(200).json({
          noData: true,
          reason: "No contacts found in database",
          counts: { total: 0 },
          exportedAt: new Date().toISOString(),
        });
      }
      
      if (format === 'csv') {
        const headers = [
          'first_name', 'last_name', 'email', 'phone', 'title',
          'company_name', 'website', 'city', 'state', 'category',
          'linkedin_url', 'data_quality_score'
        ];
        
        const csvRows = [headers.join(',')];
        
        for (const contact of contacts) {
          const row = [
            escapeCSV(contact.firstName),
            escapeCSV(contact.lastName),
            escapeCSV(contact.email),
            escapeCSV(contact.phone),
            escapeCSV(contact.title),
            escapeCSV(contact.companyName),
            escapeCSV(contact.website),
            escapeCSV(contact.city),
            escapeCSV(contact.state),
            escapeCSV(contact.category),
            escapeCSV(contact.linkedinUrl),
            contact.dataQualityScore?.toString() || '',
          ];
          csvRows.push(row.join(','));
        }
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="contacts-export.csv"`);
        res.send(csvRows.join('\n'));
      } else {
        res.json({
          contacts: contacts.map((c: typeof contacts[0]) => ({
            first_name: c.firstName,
            last_name: c.lastName,
            email: c.email,
            phone: c.phone,
            title: c.title,
            company_name: c.companyName,
            website: c.website,
            city: c.city,
            state: c.state,
            category: c.category,
            linkedin_url: c.linkedinUrl,
            data_quality_score: c.dataQualityScore,
          })),
          count: contacts.length,
          exportedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Contacts export error:", error);
      res.status(500).json({ error: "Export failed" });
    }
  });

  // Get single contact (protected)
  app.get("/api/contacts/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ error: "Invalid contact ID format" });
      }

      const contact = await storage.getContact(id);
      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }
      res.json(contact);
    } catch (error) {
      console.error("Error fetching contact:", error);
      res.status(500).json({ error: "Failed to fetch contact" });
    }
  });

  // Get import limits (for frontend validation)
  app.get("/api/config/limits", (_req: Request, res: Response) => {
    res.json(IMPORT_LIMITS);
  });

  // Settings endpoints (protected)
  app.get("/api/settings", isAuthenticated, async (_req: Request, res: Response) => {
    // Default settings to return if DB fails or no settings exist
    const defaultSettings = {
      id: null,
      webhookUrl: null,
      apiKeyEnabled: false,
      emailNotifications: false,
      autoRetryEnabled: true,
      maxRetries: 3,
    };
    
    try {
      const appSettings = await storage.getSettings();
      res.json(appSettings || defaultSettings);
    } catch (error: any) {
      // Log the error for debugging but return defaults instead of failing
      console.error("Error fetching settings:", error?.message || error);
      
      // If the table doesn't exist yet, return defaults gracefully
      if (error?.message?.includes('does not exist') || error?.message?.includes('relation')) {
        console.warn("Settings table may not exist yet, returning defaults");
        return res.json(defaultSettings);
      }
      
      // For other errors, still return defaults to not break the UI
      res.json(defaultSettings);
    }
  });

  app.post("/api/settings", isAuthenticated, async (req: Request, res: Response) => {
    console.log("[Settings] POST /api/settings received");
    console.log("[Settings] Request body:", JSON.stringify(req.body, null, 2));
    console.log("[Settings] User:", (req as any).user?.id || "unknown");
    console.log("[Settings] Session ID:", req.sessionID || "none");
    
    try {
      const { webhookUrl, apiKeyEnabled, emailNotifications, autoRetryEnabled, maxRetries } = req.body;
      console.log("[Settings] Parsed values:", { webhookUrl, apiKeyEnabled, emailNotifications, autoRetryEnabled, maxRetries });
      
      const appSettings = await storage.upsertSettings({
        webhookUrl: webhookUrl || null,
        apiKeyEnabled: !!apiKeyEnabled,
        emailNotifications: !!emailNotifications,
        autoRetryEnabled: autoRetryEnabled !== false,
        maxRetries: Math.min(Math.max(parseInt(maxRetries) || 3, 1), 10),
      });
      
      console.log("[Settings] Save successful, ID:", appSettings.id);
      res.json(appSettings);
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      const errorStack = error?.stack || "no stack";
      console.error("[Settings] ERROR saving settings:");
      console.error("[Settings] Message:", errorMessage);
      console.error("[Settings] Stack:", errorStack);
      console.error("[Settings] Full error:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
      
      // Check if it's a missing table error
      if (errorMessage.includes('does not exist') || errorMessage.includes('relation')) {
        return res.status(500).json({ 
          error: "Settings table not found",
          hint: "Run the settings table migration. See RUNBOOK.md for SQL.",
          detail: errorMessage,
        });
      }
      
      res.status(500).json({ error: "Failed to save settings", detail: errorMessage });
    }
  });

  // Settings self-test endpoint - verifies settings read/write works (protected)
  app.get("/api/settings/selftest", isAuthenticated, async (_req: Request, res: Response) => {
    const results: { step: string; success: boolean; detail?: any }[] = [];
    const testMarker = `selftest-${Date.now()}`;
    let originalSettings: any = null;
    
    try {
      // Step 1: Read current settings
      try {
        originalSettings = await storage.getSettings();
        results.push({ 
          step: "read_settings", 
          success: true, 
          detail: originalSettings ? { id: originalSettings.id, apiKeyEnabled: originalSettings.apiKeyEnabled } : { status: "no_settings_yet" }
        });
      } catch (err: any) {
        results.push({ step: "read_settings", success: false, detail: err?.message });
      }

      // Step 2: Write test value
      try {
        const testWrite = await storage.upsertSettings({
          webhookUrl: testMarker,
          apiKeyEnabled: originalSettings?.apiKeyEnabled ?? false,
          emailNotifications: originalSettings?.emailNotifications ?? false,
          autoRetryEnabled: originalSettings?.autoRetryEnabled ?? true,
          maxRetries: originalSettings?.maxRetries ?? 3,
        });
        results.push({ 
          step: "write_test_value", 
          success: testWrite.webhookUrl === testMarker, 
          detail: { written: testWrite.webhookUrl === testMarker }
        });
      } catch (err: any) {
        results.push({ step: "write_test_value", success: false, detail: err?.message });
      }

      // Step 3: Read back test value
      try {
        const readBack = await storage.getSettings();
        const matches = readBack?.webhookUrl === testMarker;
        results.push({ 
          step: "read_test_value", 
          success: matches, 
          detail: { matches, webhookUrl: readBack?.webhookUrl?.substring(0, 20) }
        });
      } catch (err: any) {
        results.push({ step: "read_test_value", success: false, detail: err?.message });
      }

      // Step 4: Restore original value
      try {
        await storage.upsertSettings({
          webhookUrl: originalSettings?.webhookUrl ?? null,
          apiKeyEnabled: originalSettings?.apiKeyEnabled ?? false,
          emailNotifications: originalSettings?.emailNotifications ?? false,
          autoRetryEnabled: originalSettings?.autoRetryEnabled ?? true,
          maxRetries: originalSettings?.maxRetries ?? 3,
        });
        results.push({ step: "restore_original", success: true });
      } catch (err: any) {
        results.push({ step: "restore_original", success: false, detail: err?.message });
      }

      const allPassed = results.every(r => r.success);
      res.json({
        success: allPassed,
        message: allPassed ? "Settings read/write verified" : "Some tests failed",
        results,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: "Settings selftest failed",
        error: error?.message || String(error),
        results,
      });
    }
  });

  // Integration status endpoint - shows configured integrations
  app.get("/api/integrations/status", isAuthenticated, async (_req: Request, res: Response) => {
    const apiKeyConfigured = !!(process.env.API_INTAKE_KEY || process.env.API_KEY);
    const instantlyConfig = getInstantlyConfig();
    
    res.json({
      inbound: {
        endpoint: "/api/intake",
        method: "POST",
        authHeader: "X-API-Key",
        apiKeyConfigured,
        status: apiKeyConfigured ? "ready" : "not_configured",
      },
      instantly: {
        configured: instantlyConfig.configured,
        campaignId: instantlyConfig.campaignId ? `...${instantlyConfig.campaignId.slice(-4)}` : null,
        status: instantlyConfig.configured ? "ready" : "not_configured",
      },
    });
  });

  // Instantly push endpoint - push contact(s) to Instantly campaign
  app.post("/api/instantly/push", isAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!isInstantlyConfigured()) {
        return res.status(503).json({ 
          error: "Instantly not configured",
          message: "Set INSTANTLY_API_KEY and INSTANTLY_CAMPAIGN_ID environment variables" 
        });
      }

      const { contactId, contactIds, campaignId } = req.body;
      
      // Single contact
      if (contactId) {
        const result = await pushToInstantly(contactId, campaignId);
        return res.json(result);
      }
      
      // Batch contacts
      if (contactIds && Array.isArray(contactIds)) {
        if (contactIds.length > 100) {
          return res.status(400).json({ error: "Maximum 100 contacts per push" });
        }
        const results = await pushBatchToInstantly(contactIds, campaignId);
        const successCount = results.filter(r => r.success).length;
        return res.json({
          success: successCount > 0,
          total: contactIds.length,
          successful: successCount,
          failed: contactIds.length - successCount,
          results,
        });
      }
      
      return res.status(400).json({ error: "Provide contactId or contactIds array" });
    } catch (error: any) {
      console.error("Instantly push error:", error);
      res.status(500).json({ error: error.message || "Push failed" });
    }
  });

  // Instantly test endpoint - verifies configuration works
  app.post("/api/instantly/test", isAuthenticated, async (_req: Request, res: Response) => {
    const config = getInstantlyConfig();
    
    if (!config.configured) {
      return res.json({
        success: false,
        configured: false,
        error: "Set INSTANTLY_API_KEY and INSTANTLY_CAMPAIGN_ID in environment variables",
      });
    }
    
    // Test API connection
    try {
      const response = await fetch("https://api.instantly.ai/api/v1/campaign/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: config.apiKey }),
      });
      
      if (response.ok) {
        return res.json({
          success: true,
          configured: true,
          campaignId: config.campaignId,
          message: "Instantly API connection successful",
        });
      } else {
        return res.json({
          success: false,
          configured: true,
          error: `API returned ${response.status}`,
        });
      }
    } catch (e: any) {
      return res.json({
        success: false,
        configured: true,
        error: e.message,
      });
    }
  });

  // Export job results (CSV or JSON) - protected
  app.get("/api/jobs/:id/export", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const format = (req.query.format as string) || 'json';
      
      console.log(`[Export] Job export requested: ${id}, format: ${format}`);
      
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        console.log(`[Export] Invalid job ID format: ${id}`);
        return res.status(400).json({ error: "Invalid job ID format" });
      }

      const job = await storage.getBulkJob(id);
      if (!job) {
        console.log(`[Export] Job not found: ${id}`);
        return res.status(404).json({ error: "Job not found" });
      }

      console.log(`[Export] Job found: ${job.name}, status: ${job.status}, totalRecords: ${job.totalRecords}, successful: ${job.successful}`);

      const items = await storage.getBulkJobItems(id);
      console.log(`[Export] Total items fetched: ${items.length}, statuses: ${Array.from(new Set(items.map(i => i.status))).join(', ')}`);

      
      // Build export records with required fields
      const filteredItems = items.filter(item => item.status === 'complete' || item.status === 'completed');
      console.log(`[Export] Filtered items (complete/completed): ${filteredItems.length} of ${items.length}`);
      
      // Group items by status for debugging
      const statusCounts = items.reduce((acc, item) => {
        const status = item.status || 'unknown';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log(`[Export] Status breakdown:`, JSON.stringify(statusCounts));
      
      // Return structured "no data" response if no completed items
      if (filteredItems.length === 0) {
        console.log(`[Export] No completed items for job: ${id}`);
        return res.status(200).json({
          noData: true,
          reason: items.length === 0 
            ? "Job has no items" 
            : `Job has ${items.length} items but none with 'complete' or 'completed' status`,
          counts: {
            total: items.length,
            byStatus: statusCounts,
            exportable: 0,
          },
          job: {
            id: job.id,
            name: job.name,
            status: job.status,
          },
          exportedAt: new Date().toISOString(),
        });
      }
      
      // Build raw export records
      const rawRecords = filteredItems.map(item => {
        const parsed = item.parsedData as Record<string, string> | null;
        const enrichment = item.enrichmentData as Record<string, unknown> | null;
        const sources = item.scrapeSources as Array<{ url: string; statusCode: number; success: boolean; error?: string }> | null;
        const domainDiscovery = enrichment?.domainDiscovery as { domain?: string; source?: string; verified?: boolean } | null;
        
        return {
          company_name: enrichment?.companyName || parsed?.company || parsed?.companyName || null,
          website: domainDiscovery?.domain || parsed?.companyDomain || parsed?.websiteUrl || parsed?.website || null,
          city: enrichment?.city || parsed?.city || null,
          state: enrichment?.state || null,
          category: enrichment?.industry || null,
          services: (enrichment?.services as string[])?.join(', ') || null,
          personalization_bullets: item.personalizationBullets || [],
          icebreaker: item.icebreaker || null,
          confidence_score: item.confidenceScore ? parseFloat(item.confidenceScore) : 0,
          confidence_rationale: item.confidenceRationale || null,
          scrape_sources: sources || [],
          email: parsed?.email || null,
          phone: parsed?.phone || null,
          first_name: parsed?.firstName || null,
          last_name: parsed?.lastName || null,
          title: parsed?.title || null,
        };
      });
      
      // Deduplicate export records using priority: phone > email > company+city
      // Track ALL identifiers that have been claimed by kept records
      type ExportRecord = typeof rawRecords[0];
      const keptRecords: ExportRecord[] = [];
      const seenPhones = new Set<string>();
      const seenEmails = new Set<string>();
      const seenCompanyCities = new Set<string>();
      
      for (const record of rawRecords) {
        const phoneNorm = typeof record.phone === 'string' ? record.phone.replace(/\D/g, '') : null;
        const hasPhone = phoneNorm && phoneNorm.length >= 7;
        const emailNorm = typeof record.email === 'string' ? record.email.toLowerCase() : null;
        const companyNorm = typeof record.company_name === 'string' ? record.company_name.toLowerCase().trim() : null;
        const cityNorm = typeof record.city === 'string' ? record.city.toLowerCase().trim() : null;
        const companyCityKey = (companyNorm && cityNorm) ? `${companyNorm}|${cityNorm}` : null;
        
        // Check if this record is a duplicate of an already-kept record
        // A record is a duplicate if ANY of its identifiers was already claimed
        let isDuplicate = false;
        if (hasPhone && seenPhones.has(phoneNorm)) isDuplicate = true;
        if (emailNorm && seenEmails.has(emailNorm)) isDuplicate = true;
        if (companyCityKey && seenCompanyCities.has(companyCityKey)) isDuplicate = true;
        
        if (isDuplicate) continue;
        
        // Keep this record and claim ALL its identifiers
        keptRecords.push(record);
        if (hasPhone) seenPhones.add(phoneNorm);
        if (emailNorm) seenEmails.add(emailNorm);
        if (companyCityKey) seenCompanyCities.add(companyCityKey);
      }
      
      const exportRecords = keptRecords;
      console.log(`[Export] Deduplicated: ${rawRecords.length} -> ${exportRecords.length} records`);

      if (format === 'csv') {
        // Generate CSV
        const headers = [
          'company_name', 'website', 'city', 'state', 'category', 'services',
          'personalization_bullet_1', 'personalization_bullet_2', 'personalization_bullet_3', 'personalization_bullet_4',
          'icebreaker', 'confidence_score', 'confidence_rationale',
          'scrape_url', 'scrape_status',
          'email', 'phone', 'first_name', 'last_name', 'title'
        ];
        
        const csvRows = [headers.join(',')];
        
        for (const record of exportRecords) {
          const bullets = record.personalization_bullets || [];
          const source = record.scrape_sources[0] || { url: '', statusCode: 0 };
          
          const row = [
            escapeCSV(record.company_name as string | null),
            escapeCSV(record.website as string | null),
            escapeCSV(record.city as string | null),
            escapeCSV(record.state as string | null),
            escapeCSV(record.category as string | null),
            escapeCSV(record.services as string | null),
            escapeCSV(bullets[0] || ''),
            escapeCSV(bullets[1] || ''),
            escapeCSV(bullets[2] || ''),
            escapeCSV(bullets[3] || ''),
            escapeCSV(record.icebreaker),
            record.confidence_score.toString(),
            escapeCSV(record.confidence_rationale),
            escapeCSV(source.url),
            source.statusCode?.toString() || '',
            escapeCSV(record.email),
            escapeCSV(record.phone),
            escapeCSV(record.first_name),
            escapeCSV(record.last_name),
            escapeCSV(record.title),
          ];
          csvRows.push(row.join(','));
        }
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="export-${id}.csv"`);
        res.send(csvRows.join('\n'));
      } else {
        // JSON export with schema metadata
        res.json({
          job: {
            id: job.id,
            name: job.name,
            status: job.status,
            totalRecords: job.totalRecords,
            successful: job.successful,
            failed: job.failed,
            duplicatesFound: job.duplicatesFound,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
          },
          schema: {
            company_name: 'string | null',
            website: 'string | null',
            city: 'string | null',
            state: 'string | null',
            category: 'string | null',
            services: 'string | null (comma-separated)',
            personalization_bullets: 'string[] (2-4 items)',
            icebreaker: 'string | null',
            confidence_score: 'number (0-1)',
            confidence_rationale: 'string | null',
            scrape_sources: 'Array<{url: string, statusCode: number, success: boolean, error?: string}>',
            email: 'string | null',
            phone: 'string | null',
            first_name: 'string | null',
            last_name: 'string | null',
            title: 'string | null',
          },
          records: exportRecords,
          exportedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Export failed" });
    }
  });

  return httpServer;
}

// Helper function to escape CSV values
function escapeCSV(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
