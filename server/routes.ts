import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { BulkInputHandler, IMPORT_LIMITS } from "./lib/input-handler";
import { processJobItems, recoverStaleJobs, getProcessorHealth } from "./lib/job-processor";

// Rate limiting store (in-memory for MVP)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

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
  
  // Health check endpoint
  app.get("/api/health", async (_req: Request, res: Response) => {
    try {
      const processorHealth = await getProcessorHealth();
      res.json({
        status: processorHealth.healthy ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        processor: processorHealth,
        limits: IMPORT_LIMITS,
      });
    } catch (error) {
      res.status(500).json({ status: "unhealthy", error: "Health check failed" });
    }
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

  // Get all jobs
  app.get("/api/jobs", async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const jobs = await storage.getBulkJobs(limit);
      res.json(jobs);
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  // Get single job with stats
  app.get("/api/jobs/:id", async (req: Request, res: Response) => {
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

  // Single contact intake with rate limiting
  app.post("/api/intake", rateLimit(30, 60000), async (req: Request, res: Response) => {
    try {
      const { email, phone, firstName, lastName, company, title, linkedinUrl, ghlContactId, leadName, companyName, websiteUrl } = req.body;

      // Handle GHL webhook format
      const contactEmail = email?.toLowerCase()?.trim();
      const contactPhone = phone?.trim();
      const contactFirstName = (firstName || (leadName?.split(" ")[0]))?.trim();
      const contactLastName = (lastName || (leadName?.split(" ").slice(1).join(" ")))?.trim();
      const contactCompany = (company || companyName)?.trim();

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

  // Get all contacts with pagination
  app.get("/api/contacts", async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const contacts = await storage.getContacts(limit);
      res.json(contacts);
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  // Get single contact
  app.get("/api/contacts/:id", async (req: Request, res: Response) => {
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

  return httpServer;
}
