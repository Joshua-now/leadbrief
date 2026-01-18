import { storage } from "../storage";
import { scrapeWebsite, type ScrapeResult, type ScrapeSource } from "./scraper";
import { extractBusinessIntelligence, calculateConfidenceScore } from "./content-parser";
import { generatePersonalization } from "./personalization";

// Track jobs currently being processed to prevent concurrent execution
const processingJobs = new Set<string>();

// Configuration for self-healing
const PROCESSOR_CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  BATCH_SIZE: 50,
  STALE_JOB_THRESHOLD_MS: 5 * 60 * 1000, // 5 minutes
} as const;

// Exponential backoff helper
function getRetryDelay(retryCount: number): number {
  return PROCESSOR_CONFIG.RETRY_DELAY_MS * Math.pow(2, retryCount);
}

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate data quality score - includes all tracked dimensions
function calculateDataQualityScore(data: Record<string, string | null | undefined>): number {
  let score = 0;
  const weights = {
    email: 20,           // Primary contact method
    phone: 15,           // Secondary contact method
    website: 15,         // Critical for enrichment
    companyName: 10,     // Business identification
    company: 10,         // Alias for companyName
    websiteUrl: 15,      // Alias for website
    city: 5,             // Location part 1
    state: 5,            // Location part 2
    linkedinUrl: 5,      // Professional profile
    title: 5,            // Job role
    firstName: 3,        // Name parts
    lastName: 2,         // Name parts
    address: 3,          // Full address
    category: 2,         // Business category
  };

  // Avoid double counting aliases
  const counted = new Set<string>();
  
  for (const [field, weight] of Object.entries(weights)) {
    if (data[field] && data[field]!.trim()) {
      // Dedup aliases: website/websiteUrl and company/companyName
      if (field === 'websiteUrl' && counted.has('website')) continue;
      if (field === 'website' && counted.has('websiteUrl')) continue;
      if (field === 'company' && counted.has('companyName')) continue;
      if (field === 'companyName' && counted.has('company')) continue;
      
      score += weight;
      counted.add(field);
    }
  }

  // Cap at 100
  return Math.min(score, 100);
}

// Process a single job item with retry logic and full enrichment pipeline
async function processItem(
  item: {
    id: string;
    parsedData: Record<string, string> | null;
    retryCount: number | null;
  }
): Promise<{ success: boolean; isDuplicate: boolean; error?: string }> {
  const data = item.parsedData;
  
  if (!data) {
    return { success: false, isDuplicate: false, error: "No parsed data available" };
  }

  // Validate we have at least one identifier
  if (!data.email && !data.phone && !data.linkedinUrl) {
    return { success: false, isDuplicate: false, error: "Missing required identifier (email, phone, or LinkedIn URL)" };
  }

  const companyName = data.company || data.companyName;

  // STEP 1: Scrape website if available
  const websiteUrl = data.companyDomain || data.websiteUrl || data.website || data.url;
  let scrapeResult: ScrapeResult = {
    success: false,
    sources: [],
    error: 'No website URL provided',
  };
  
  if (websiteUrl) {
    console.log(`[Enrichment] Scraping website for item ${item.id}: ${websiteUrl}`);
    scrapeResult = await scrapeWebsite(websiteUrl);
  }

  // STEP 2: Extract business intelligence from scraped content
  const businessIntel = extractBusinessIntelligence(scrapeResult, data);
  
  // STEP 3: Generate personalization based on scraped content
  const personalization = generatePersonalization(businessIntel, scrapeResult, data);
  
  // STEP 4: Calculate confidence score
  const { score: confidenceScore, rationale: confidenceRationale } = calculateConfidenceScore(
    scrapeResult,
    businessIntel,
    data
  );

  // Create company if needed (enrich with scraped data)
  let companyId: string | null = null;
  const finalCompanyName = businessIntel.companyName || companyName;
  if (finalCompanyName) {
    const company = await storage.upsertCompany({
      name: finalCompanyName,
      domain: websiteUrl || null,
    });
    companyId = company.id;
  }

  // Calculate data quality score
  const qualityScore = calculateDataQualityScore(data);

  // Handle name parsing if leadName is provided but firstName/lastName are not
  let firstName: string | null = data.firstName || null;
  let lastName: string | null = data.lastName || null;
  if (!firstName && !lastName && data.leadName) {
    const nameParts = data.leadName.trim().split(/\s+/);
    firstName = nameParts[0] || null;
    lastName = nameParts.slice(1).join(" ") || null;
  }

  // Merge location from enrichment if not in input
  const finalCity = data.city || businessIntel.city || null;
  const finalState = data.state || businessIntel.state || null;
  const finalAddress = data.address || null;
  const finalCategory = data.category || businessIntel.industry || null;
  const finalWebsite = websiteUrl || data.websiteUrl || null;

  // Create or merge contact with validated data (including new fields)
  const mergeResult = await storage.mergeContact({
    email: data.email || null,
    phone: data.phone || businessIntel.contactInfo.phone || null,
    firstName: firstName || null,
    lastName: lastName || null,
    title: data.title || null,
    companyName: finalCompanyName || null,
    website: finalWebsite,
    city: finalCity,
    state: finalState,
    address: finalAddress,
    category: finalCategory,
    companyId,
    linkedinUrl: data.linkedinUrl || null,
    dataQualityScore: String(qualityScore),
  }, 'import');
  
  const contact = mergeResult.contact;
  const isDuplicate = !mergeResult.isNew;

  // Build enrichment data object
  const enrichmentData = {
    companyName: businessIntel.companyName,
    city: businessIntel.city,
    state: businessIntel.state,
    services: businessIntel.services,
    signals: businessIntel.signals,
    industry: businessIntel.industry,
    foundedYear: businessIntel.foundedYear,
    contactInfo: businessIntel.contactInfo,
    websiteTitle: scrapeResult.content?.title || null,
    websiteDescription: scrapeResult.content?.description || null,
  };

  // Update job item with full enrichment data
  await storage.updateBulkJobItem(item.id, {
    status: "complete",
    contactId: contact.id,
    companyId,
    fitScore: String(qualityScore),
    enrichmentData: JSON.parse(JSON.stringify(enrichmentData)),
    scrapeSources: JSON.parse(JSON.stringify(scrapeResult.sources)),
    personalizationBullets: personalization.bullets,
    icebreaker: personalization.icebreaker,
    confidenceScore: String(confidenceScore),
    confidenceRationale,
    matchedContactId: isDuplicate ? contact.id : null,
    matchConfidence: isDuplicate ? (mergeResult.matchedBy === 'email' ? "100" : mergeResult.matchedBy === 'domain' ? "90" : "80") : null,
  });

  const matchInfo = isDuplicate 
    ? `merged (matched by ${mergeResult.matchedBy}, updated: ${mergeResult.fieldsUpdated.join(',')})`
    : 'new';
  console.log(`[Enrichment] Completed item ${item.id}: ${matchInfo}, confidence=${confidenceScore}, bullets=${personalization.bullets.length}`);

  return { success: true, isDuplicate };
}

// Main job processor with self-healing
export async function processJobItems(jobId: string): Promise<void> {
  // Prevent concurrent processing of the same job
  if (processingJobs.has(jobId)) {
    console.log(`[JobProcessor] Job ${jobId} is already being processed, skipping`);
    return;
  }
  
  processingJobs.add(jobId);
  
  try {
    const items = await storage.getBulkJobItems(jobId);
    let successful = 0;
    let failed = 0;
    let duplicates = 0;
    let processed = 0;

    // Update job to processing state
    await storage.updateBulkJob(jobId, { 
      status: "processing",
      startedAt: new Date(),
    });

    for (const item of items) {
      // Skip already completed items (self-healing for resumed jobs)
      if (item.status === "complete") {
        successful++;
        processed++;
        continue;
      }

      // Skip permanently failed items
      if (item.status === "failed" && (item.retryCount || 0) >= PROCESSOR_CONFIG.MAX_RETRIES) {
        failed++;
        processed++;
        continue;
      }

      // Update item status to processing
      await storage.updateBulkJobItem(item.id, { status: "processing" });

      let lastError: string | undefined;
      let itemSucceeded = false;
      const currentRetries = item.retryCount || 0;

      // Retry loop with exponential backoff
      for (let attempt = currentRetries; attempt < PROCESSOR_CONFIG.MAX_RETRIES; attempt++) {
        try {
          const result = await processItem({
            id: item.id,
            parsedData: item.parsedData as Record<string, string> | null,
            retryCount: attempt,
          });

          if (result.success) {
            itemSucceeded = true;
            if (result.isDuplicate) {
              duplicates++;
            }
            successful++;
            break;
          } else if (result.error) {
            lastError = result.error;
            // Persist retry count after each failed attempt for recovery
            await storage.updateBulkJobItem(item.id, {
              retryCount: attempt + 1,
              lastError: result.error,
            });
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : "Unknown error";
          
          // Persist retry count after each failed attempt for recovery
          await storage.updateBulkJobItem(item.id, {
            retryCount: attempt + 1,
            lastError,
          });
          
          // Wait before retry with exponential backoff
          if (attempt < PROCESSOR_CONFIG.MAX_RETRIES - 1) {
            await sleep(getRetryDelay(attempt));
          }
        }
      }

      if (!itemSucceeded) {
        failed++;
        await storage.updateBulkJobItem(item.id, {
          status: "failed",
          lastError: lastError || "Max retries exceeded",
          retryCount: PROCESSOR_CONFIG.MAX_RETRIES,
        });
      }

      processed++;

      // Update progress periodically
      if (processed % 10 === 0 || processed === items.length) {
        const progress = Math.round((processed / items.length) * 100);
        await storage.updateBulkJob(jobId, {
          progress,
          successful,
          failed,
          duplicatesFound: duplicates,
        });
      }
    }

    // Update job status to complete
    await storage.updateBulkJob(jobId, {
      status: "complete",
      successful,
      failed,
      duplicatesFound: duplicates,
      completedAt: new Date(),
      progress: 100,
    });

  } catch (error) {
    console.error("Error processing job:", error);
    await storage.updateBulkJob(jobId, {
      status: "failed",
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    // Always remove from processing set when done
    processingJobs.delete(jobId);
  }
}

// Self-healing: Recover stale jobs that got stuck in processing
export async function recoverStaleJobs(): Promise<number> {
  try {
    const jobs = await storage.getBulkJobs(100);
    let recovered = 0;

    for (const job of jobs) {
      if (job.status === "processing") {
        const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : 0;
        const now = Date.now();
        
        // If job has been processing for too long, attempt recovery
        if (now - startedAt > PROCESSOR_CONFIG.STALE_JOB_THRESHOLD_MS) {
          console.log(`Recovering stale job: ${job.id}`);
          
          // Re-process the job (will skip completed items due to self-healing)
          processJobItems(job.id).catch(console.error);
          recovered++;
        }
      }
    }

    return recovered;
  } catch (error) {
    console.error("Error recovering stale jobs:", error);
    return 0;
  }
}

// Health check for job processor
export async function getProcessorHealth(): Promise<{
  healthy: boolean;
  pendingJobs: number;
  processingJobs: number;
  staleJobs: number;
}> {
  try {
    const jobs = await storage.getBulkJobs(100);
    const now = Date.now();
    
    const pendingJobs = jobs.filter(j => j.status === "pending").length;
    const processingJobs = jobs.filter(j => j.status === "processing").length;
    const staleJobs = jobs.filter(j => {
      if (j.status !== "processing") return false;
      const startedAt = j.startedAt ? new Date(j.startedAt).getTime() : 0;
      return now - startedAt > PROCESSOR_CONFIG.STALE_JOB_THRESHOLD_MS;
    }).length;

    return {
      healthy: staleJobs === 0,
      pendingJobs,
      processingJobs,
      staleJobs,
    };
  } catch (error) {
    return {
      healthy: false,
      pendingJobs: 0,
      processingJobs: 0,
      staleJobs: 0,
    };
  }
}
