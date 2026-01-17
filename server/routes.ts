import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { BulkInputHandler, IMPORT_LIMITS } from "./lib/input-handler";
import { processJobItems, recoverStaleJobs, getProcessorHealth } from "./lib/job-processor";
import { parseFile } from "./lib/file-parser";
import { setupAuth, registerAuthRoutes, isAuthenticated, getActiveAuthProvider, getIsAuthEnabled } from "./replit_integrations/auth";
import { isSupabaseConfigured } from "./lib/supabase";
import { db } from "./db";
import { getSystemHealth, withTimeout, categorizeError } from "./lib/guardrails";
import { getEnvPresenceFlags, getAppVersion } from "./lib/env";
import { getLastLogs, crashLog } from "./lib/crash-logger";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_LIMITS.MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// Rate limiting store (in-memory for MVP)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// API Key validation middleware for intake endpoint
function validateApiKey(req: Request, res: Response, next: () => void) {
  const apiKey = req.headers['x-api-key'] as string;
  const configuredApiKey = process.env.API_KEY;
  
  // If no API_KEY is configured, allow all requests (for development/backwards compatibility)
  if (!configuredApiKey) {
    return next();
  }
  
  if (!apiKey || apiKey !== configuredApiKey) {
    return res.status(401).json({ error: "Invalid or missing API key" });
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
  app.get("/api/auth/config", (_req: Request, res: Response) => {
    res.json({
      provider: getActiveAuthProvider(),
      isEnabled: getIsAuthEnabled(),
      supabaseConfigured: isSupabaseConfigured(),
    });
  });
  
  // Health check endpoint (public - no auth required)
  app.get("/api/health", async (req: Request, res: Response) => {
    try {
      // Support for detailed or simple health check
      const detailed = req.query.detailed === "true";
      
      // DB smoke test - quick check to verify DB connection
      let dbOk = false;
      let dbLatencyMs = 0;
      try {
        const dbStart = Date.now();
        await storage.getBulkJobs(1); // Simple query to test connection
        dbLatencyMs = Date.now() - dbStart;
        dbOk = true;
      } catch (dbError) {
        console.error("[Health] DB smoke test failed:", dbError);
        dbOk = false;
      }
      
      const envFlags = getEnvPresenceFlags();
      const version = getAppVersion();
      
      if (detailed) {
        // Full system health with timeout protection
        const systemHealth = await withTimeout(
          getSystemHealth(),
          5000,
          "Health check timed out"
        );
        
        res.json({
          ok: systemHealth.status === "healthy" && dbOk,
          ...systemHealth,
          version,
          authProvider: getActiveAuthProvider(),
          db: dbOk,
          dbLatencyMs,
          env: envFlags,
          limits: IMPORT_LIMITS,
        });
      } else {
        // Simple health check for load balancers
        const processorHealth = await getProcessorHealth();
        const isHealthy = processorHealth.healthy && dbOk;
        
        res.json({
          ok: isHealthy,
          status: isHealthy ? "healthy" : "degraded",
          timestamp: new Date().toISOString(),
          version,
          authProvider: getActiveAuthProvider(),
          db: dbOk,
          dbLatencyMs,
          env: envFlags,
          processor: processorHealth,
          limits: IMPORT_LIMITS,
        });
      }
    } catch (error) {
      const categorized = categorizeError(error);
      res.status(200).json({ 
        ok: false,
        status: "unhealthy", 
        error: "Health check failed",
        db: false,
        version: getAppVersion(),
        env: getEnvPresenceFlags(),
        category: categorized.category,
        isRecoverable: categorized.isRecoverable,
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

  // Single contact intake with rate limiting and API key validation
  app.post("/api/intake", validateApiKey, rateLimit(30, 60000), async (req: Request, res: Response) => {
    try {
      const { email, phone, firstName, lastName, company, title, linkedinUrl, ghlContactId, leadName, companyName, websiteUrl, city } = req.body;

      // Handle GHL webhook format
      const contactEmail = email?.toLowerCase()?.trim();
      const contactPhone = phone?.trim();
      const contactFirstName = (firstName || (leadName?.split(" ")[0]))?.trim();
      const contactLastName = (lastName || (leadName?.split(" ").slice(1).join(" ")))?.trim();
      const contactCompany = (company || companyName)?.trim();
      const contactCity = city?.trim();

      if (!contactEmail && !contactPhone && !linkedinUrl) {
        return res.status(400).json({ error: "Email, phone, or LinkedIn URL required" });
      }

      // Validate email format if provided
      if (contactEmail && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(contactEmail)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      // Create or update company if provided
      let companyId: string | null = null;
      if (contactCompany) {
        const companyRecord = await storage.upsertCompany({
          name: contactCompany.slice(0, 500),
          domain: websiteUrl?.slice(0, 500) || null,
        });
        companyId = companyRecord.id;
      }

      // Create or update contact
      const contact = await storage.upsertContact({
        email: contactEmail || null,
        phone: contactPhone || null,
        firstName: contactFirstName?.slice(0, 200) || null,
        lastName: contactLastName?.slice(0, 200) || null,
        title: title?.slice(0, 200) || null,
        city: contactCity?.slice(0, 200) ?? null,
        companyId,
        linkedinUrl: linkedinUrl?.slice(0, 500) || null,
      });

      // Create a single-record job for tracking
      const jobName = ghlContactId 
        ? `GHL: ${leadName || contactEmail}` 
        : `Single: ${contactFirstName || contactEmail}`;
      
      const job = await storage.createBulkJob({
        name: jobName.slice(0, 200),
        sourceFormat: ghlContactId ? "ghl_webhook" : "api_single",
        totalRecords: 1,
        status: "complete",
        successful: 1,
        completedAt: new Date(),
      });

      await storage.createBulkJobItems([{
        bulkJobId: job.id,
        rowNumber: 1,
        status: "complete",
        parsedData: JSON.parse(JSON.stringify({ 
          email: contactEmail, 
          firstName: contactFirstName, 
          lastName: contactLastName 
        })),
        contactId: contact.id,
        companyId,
      }]);

      res.json({
        success: true,
        contactId: contact.id,
        jobId: job.id,
        status: "complete",
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
    try {
      const appSettings = await storage.getSettings();
      res.json(appSettings || {
        id: null,
        webhookUrl: null,
        apiKeyEnabled: false,
        emailNotifications: false,
        autoRetryEnabled: true,
        maxRetries: 3,
      });
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { webhookUrl, apiKeyEnabled, emailNotifications, autoRetryEnabled, maxRetries } = req.body;
      const appSettings = await storage.upsertSettings({
        webhookUrl: webhookUrl || null,
        apiKeyEnabled: !!apiKeyEnabled,
        emailNotifications: !!emailNotifications,
        autoRetryEnabled: autoRetryEnabled !== false,
        maxRetries: Math.min(Math.max(parseInt(maxRetries) || 3, 1), 10),
      });
      res.json(appSettings);
    } catch (error) {
      console.error("Error saving settings:", error);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // Export job results (CSV or JSON)
  app.get("/api/jobs/:id/export", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const format = (req.query.format as string) || 'json';
      
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ error: "Invalid job ID format" });
      }

      const job = await storage.getBulkJob(id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }

      const items = await storage.getBulkJobItems(id);
      
      // Build export records with required fields
      const exportRecords = items
        .filter(item => item.status === 'complete')
        .map(item => {
          const parsed = item.parsedData as Record<string, string> | null;
          const enrichment = item.enrichmentData as Record<string, unknown> | null;
          const sources = item.scrapeSources as Array<{ url: string; statusCode: number; success: boolean; error?: string }> | null;
          
          return {
            company_name: enrichment?.companyName || parsed?.company || parsed?.companyName || null,
            website: parsed?.companyDomain || parsed?.websiteUrl || parsed?.website || null,
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
