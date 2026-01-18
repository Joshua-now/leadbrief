import { storage } from "../storage";
import { recoverStaleJobs, getProcessorHealth } from "./job-processor";
import * as fs from "fs";
import * as os from "os";

// Prevent concurrent health checks and job recovery
let isHealthCheckRunning = false;
let isRecoveryRunning = false;

// Circuit breaker state
interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
  successCount: number;
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  halfOpenSuccesses: 2,
} as const;

// Health check intervals
let healthCheckInterval: NodeJS.Timeout | null = null;
let staleJobRecoveryInterval: NodeJS.Timeout | null = null;

// Circuit breaker for external calls
export function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  fallback?: () => T
): Promise<T> {
  const state = circuitBreakers.get(name) || {
    failures: 0,
    lastFailure: 0,
    isOpen: false,
    successCount: 0,
  };

  const now = Date.now();

  // If circuit is open, check if we should try half-open
  if (state.isOpen) {
    if (now - state.lastFailure > CIRCUIT_BREAKER_CONFIG.resetTimeout) {
      // Try half-open state
      state.isOpen = false;
      state.successCount = 0;
    } else {
      // Circuit is open, return fallback or throw
      if (fallback) {
        return Promise.resolve(fallback());
      }
      return Promise.reject(new Error(`Circuit breaker open for: ${name}`));
    }
  }

  return fn()
    .then((result) => {
      state.failures = 0;
      state.successCount++;
      
      // Reset circuit breaker after enough successes
      if (state.successCount >= CIRCUIT_BREAKER_CONFIG.halfOpenSuccesses) {
        state.isOpen = false;
        state.failures = 0;
      }
      
      circuitBreakers.set(name, state);
      return result;
    })
    .catch((error) => {
      state.failures++;
      state.lastFailure = now;
      state.successCount = 0;
      
      if (state.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
        state.isOpen = true;
        console.error(`[CircuitBreaker] Circuit opened for: ${name} after ${state.failures} failures`);
      }
      
      circuitBreakers.set(name, state);
      
      if (fallback) {
        return fallback();
      }
      throw error;
    });
}

// Request timeout wrapper
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = "Operation timed out"
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

// Database health check
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    // Simple query to check connection
    await storage.getBulkJobs(1);
    return {
      healthy: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Container memory limit detection
// Caches the detected limit to avoid repeated filesystem reads
let cachedContainerMemoryLimitMB: number | null = null;

/**
 * Detects the actual container memory limit from cgroup files.
 * - cgroup v2: /sys/fs/cgroup/memory.max
 * - cgroup v1: /sys/fs/cgroup/memory/memory.limit_in_bytes
 * - Fallback: os.totalmem() (physical RAM)
 * 
 * Returns limit in MB, cached after first detection.
 */
function getContainerMemoryLimitMB(): number {
  if (cachedContainerMemoryLimitMB !== null) {
    return cachedContainerMemoryLimitMB;
  }
  
  const cgroupV2Path = "/sys/fs/cgroup/memory.max";
  const cgroupV1Path = "/sys/fs/cgroup/memory/memory.limit_in_bytes";
  
  try {
    // Try cgroup v2 first (modern containers like Railway)
    if (fs.existsSync(cgroupV2Path)) {
      const content = fs.readFileSync(cgroupV2Path, "utf8").trim();
      if (content !== "max") {
        const bytes = parseInt(content, 10);
        if (!isNaN(bytes) && bytes > 0) {
          cachedContainerMemoryLimitMB = Math.round(bytes / 1024 / 1024);
          console.log(`[MemoryMonitor] Detected cgroup v2 limit: ${cachedContainerMemoryLimitMB}MB`);
          return cachedContainerMemoryLimitMB;
        }
      }
      // "max" means unlimited - fall through to os.totalmem()
    }
    
    // Try cgroup v1
    if (fs.existsSync(cgroupV1Path)) {
      const content = fs.readFileSync(cgroupV1Path, "utf8").trim();
      const bytes = parseInt(content, 10);
      // Very large values (close to max int64) indicate "no limit"
      if (!isNaN(bytes) && bytes > 0 && bytes < 9223372036854771712) {
        cachedContainerMemoryLimitMB = Math.round(bytes / 1024 / 1024);
        console.log(`[MemoryMonitor] Detected cgroup v1 limit: ${cachedContainerMemoryLimitMB}MB`);
        return cachedContainerMemoryLimitMB;
      }
    }
  } catch (err) {
    // Cgroup access failed - fall through to OS total
  }
  
  // Fallback to OS total memory
  cachedContainerMemoryLimitMB = Math.round(os.totalmem() / 1024 / 1024);
  console.log(`[MemoryMonitor] Using OS total memory: ${cachedContainerMemoryLimitMB}MB`);
  return cachedContainerMemoryLimitMB;
}

// Memory usage check
// Note: Memory percentage is INFORMATIONAL ONLY - does NOT affect liveness
// RSS is compared against container memory limit (cgroup), not V8 heap
export function getMemoryUsage(): {
  used: number;
  total: number;
  rss: number;
  percentUsed: number;
  isHealthy: boolean;
  warning: boolean;
  limitSource: string;
} {
  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const containerLimitMB = getContainerMemoryLimitMB();
  
  // Calculate percentage based on RSS vs container limit
  const percentUsed = Math.round((rssMB / containerLimitMB) * 100);
  
  // Memory is only critically unhealthy if:
  // - RSS is at 95%+ of container limit (imminent OOM kill)
  // Warning at 80%+ of container limit
  const isHealthy = percentUsed < 95;
  const warning = percentUsed >= 80;
  
  // Determine limit source for debugging
  let limitSource = "os_total";
  if (fs.existsSync("/sys/fs/cgroup/memory.max")) {
    limitSource = "cgroup_v2";
  } else if (fs.existsSync("/sys/fs/cgroup/memory/memory.limit_in_bytes")) {
    limitSource = "cgroup_v1";
  }
  
  return {
    used: rssMB, // MB (RSS is actual memory footprint)
    total: containerLimitMB, // MB (container limit, not heap)
    rss: rssMB, // MB
    percentUsed,
    isHealthy,
    warning,
    limitSource,
  };
}

// Comprehensive system health check
// IMPORTANT: Memory does NOT affect health status for liveness probes
// Only database connectivity determines if system is "unhealthy"
export async function getSystemHealth(): Promise<{
  status: "healthy" | "degraded" | "unhealthy";
  checks: {
    database: { healthy: boolean; latencyMs: number; error?: string };
    memory: { used: number; total: number; rss: number; percentUsed: number; isHealthy: boolean; warning: boolean; limitSource: string };
    processor: { healthy: boolean; pendingJobs: number; processingJobs: number; staleJobs: number };
    circuitBreakers: { name: string; isOpen: boolean; failures: number }[];
  };
  timestamp: string;
}> {
  const [dbHealth, processorHealth] = await Promise.all([
    checkDatabaseHealth(),
    getProcessorHealth(),
  ]);
  
  const memory = getMemoryUsage();
  
  const circuitBreakerStatus = Array.from(circuitBreakers.entries()).map(
    ([name, state]) => ({
      name,
      isOpen: state.isOpen,
      failures: state.failures,
    })
  );
  
  // Health status is determined by DATABASE and PROCESSOR only
  // Memory is informational - small containers run at 90%+ normally
  const coreHealthy = dbHealth.healthy && processorHealth.healthy;
  
  // Degraded only if memory is at critical levels (99%+) but DB is fine
  const memoryDegraded = !memory.isHealthy && coreHealthy;
  
  return {
    status: !coreHealthy ? "unhealthy" : memoryDegraded ? "degraded" : "healthy",
    checks: {
      database: dbHealth,
      memory,
      processor: processorHealth,
      circuitBreakers: circuitBreakerStatus,
    },
    timestamp: new Date().toISOString(),
  };
}

// Serialized recovery to prevent overlapping executions
async function safeRecoverStaleJobs(): Promise<number> {
  if (isRecoveryRunning) {
    console.log("[SelfHealing] Recovery already in progress, skipping");
    return 0;
  }
  
  isRecoveryRunning = true;
  try {
    const recovered = await recoverStaleJobs();
    return recovered;
  } finally {
    isRecoveryRunning = false;
  }
}

// Start periodic health checks and self-healing
export function startHealthMonitoring(intervalMs = 60000): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  healthCheckInterval = setInterval(async () => {
    // Skip if previous health check is still running
    if (isHealthCheckRunning) {
      return;
    }
    
    isHealthCheckRunning = true;
    try {
      const health = await getSystemHealth();
      
      // Only log unhealthy for actual critical issues (DB down)
      if (health.status === "unhealthy") {
        console.error("[HealthMonitor] System unhealthy:", JSON.stringify({
          database: health.checks.database,
          processor: health.checks.processor,
        }));
      } else if (health.status === "degraded") {
        // Degraded is just a warning (e.g., high memory but still functional)
        console.warn("[HealthMonitor] System degraded:", JSON.stringify({
          memory: health.checks.memory,
        }));
      }
      // Don't spam logs when healthy - only log if there are issues
      
      // Self-healing: Trigger stale job recovery if needed (serialized)
      if (health.checks.processor.staleJobs > 0) {
        console.log("[HealthMonitor] Triggering stale job recovery");
        await safeRecoverStaleJobs();
      }
    } catch (error) {
      console.error("[HealthMonitor] Health check failed:", error);
    } finally {
      isHealthCheckRunning = false;
    }
  }, intervalMs);
  
  // Also run stale job recovery every 5 minutes (serialized)
  if (staleJobRecoveryInterval) {
    clearInterval(staleJobRecoveryInterval);
  }
  
  staleJobRecoveryInterval = setInterval(async () => {
    try {
      const recovered = await safeRecoverStaleJobs();
      if (recovered > 0) {
        console.log(`[SelfHealing] Recovered ${recovered} stale jobs`);
      }
    } catch (error) {
      console.error("[SelfHealing] Stale job recovery failed:", error);
    }
  }, 5 * 60 * 1000);
  
  console.log("[HealthMonitor] Started health monitoring");
}

// Stop health monitoring
export function stopHealthMonitoring(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  if (staleJobRecoveryInterval) {
    clearInterval(staleJobRecoveryInterval);
    staleJobRecoveryInterval = null;
  }
  console.log("[HealthMonitor] Stopped health monitoring");
}

// Graceful shutdown handler
export function setupGracefulShutdown(cleanup?: () => Promise<void>): void {
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGUSR2"];
  
  signals.forEach((signal) => {
    process.on(signal, async () => {
      console.log(`[Shutdown] Received ${signal}, shutting down gracefully...`);
      
      try {
        stopHealthMonitoring();
        
        if (cleanup) {
          await cleanup();
        }
        
        console.log("[Shutdown] Cleanup complete, exiting");
        process.exit(0);
      } catch (error) {
        console.error("[Shutdown] Error during cleanup:", error);
        process.exit(1);
      }
    });
  });
  
  console.log("[Shutdown] Graceful shutdown handlers registered");
}

// Request validation helpers
export function validateRequestSize(contentLength: number, maxSizeMB: number): boolean {
  return contentLength <= maxSizeMB * 1024 * 1024;
}

// Safe JSON parse with size limit
export function safeJsonParse<T>(
  content: string,
  maxSizeMB = 10
): { success: true; data: T } | { success: false; error: string } {
  if (!validateRequestSize(Buffer.byteLength(content, "utf8"), maxSizeMB)) {
    return { success: false, error: `Content exceeds ${maxSizeMB}MB limit` };
  }
  
  try {
    const data = JSON.parse(content) as T;
    return { success: true, data };
  } catch {
    return { success: false, error: "Invalid JSON syntax" };
  }
}

// Retry helper with exponential backoff
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    onRetry,
  } = options;
  
  let lastError: Error = new Error("Unknown error");
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
        
        if (onRetry) {
          onRetry(lastError, attempt + 1);
        }
        
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Error categorization for better logging
export function categorizeError(error: unknown): {
  category: "validation" | "database" | "network" | "auth" | "unknown";
  message: string;
  isRecoverable: boolean;
} {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    if (message.includes("validation") || message.includes("invalid") || message.includes("required")) {
      return { category: "validation", message: error.message, isRecoverable: false };
    }
    
    if (message.includes("database") || message.includes("connection") || message.includes("pg") || message.includes("sql")) {
      return { category: "database", message: error.message, isRecoverable: true };
    }
    
    if (message.includes("network") || message.includes("timeout") || message.includes("fetch")) {
      return { category: "network", message: error.message, isRecoverable: true };
    }
    
    if (message.includes("unauthorized") || message.includes("auth") || message.includes("token")) {
      return { category: "auth", message: error.message, isRecoverable: false };
    }
  }
  
  return {
    category: "unknown",
    message: error instanceof Error ? error.message : String(error),
    isRecoverable: true,
  };
}
