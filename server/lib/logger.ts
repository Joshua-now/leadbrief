import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

export interface LogContext {
  requestId: string;
  leadId?: string;
  jobId?: string;
  stage?: string;
  userId?: string;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  leadId?: string;
  jobId?: string;
  stage?: string;
  userId?: string;
  duration?: number;
  error?: string;
  data?: Record<string, unknown>;
}

function formatLog(log: StructuredLog): string {
  return JSON.stringify(log);
}

function getContext(): Partial<LogContext> {
  return asyncLocalStorage.getStore() || {};
}

export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const ctx = getContext();
  const logEntry: StructuredLog = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...ctx,
    ...(data && { data }),
  };
  
  const formatted = formatLog(logEntry);
  
  switch (level) {
    case 'ERROR':
      console.error(formatted);
      break;
    case 'WARN':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

export const logger = {
  debug: (message: string, data?: Record<string, unknown>) => log('DEBUG', message, data),
  info: (message: string, data?: Record<string, unknown>) => log('INFO', message, data),
  warn: (message: string, data?: Record<string, unknown>) => log('WARN', message, data),
  error: (message: string, data?: Record<string, unknown>) => log('ERROR', message, data),
};

export function withContext<T>(context: Partial<LogContext>, fn: () => T): T {
  const existingContext = getContext();
  const newContext: LogContext = {
    requestId: context.requestId || existingContext.requestId || randomUUID(),
    leadId: context.leadId || existingContext.leadId,
    jobId: context.jobId || existingContext.jobId,
    stage: context.stage || existingContext.stage,
    userId: context.userId || existingContext.userId,
  };
  
  return asyncLocalStorage.run(newContext, fn);
}

export async function withContextAsync<T>(context: Partial<LogContext>, fn: () => Promise<T>): Promise<T> {
  const existingContext = getContext();
  const newContext: LogContext = {
    requestId: context.requestId || existingContext.requestId || randomUUID(),
    leadId: context.leadId || existingContext.leadId,
    jobId: context.jobId || existingContext.jobId,
    stage: context.stage || existingContext.stage,
    userId: context.userId || existingContext.userId,
  };
  
  return asyncLocalStorage.run(newContext, fn);
}

export function setStage(stage: string): void {
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    ctx.stage = stage;
  }
}

export function setLeadId(leadId: string): void {
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    ctx.leadId = leadId;
  }
}

export function setJobId(jobId: string): void {
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    ctx.jobId = jobId;
  }
}

export function generateRequestId(): string {
  return randomUUID().slice(0, 8);
}

export function getRequestId(): string | undefined {
  return getContext().requestId;
}

export function createRequestMiddleware() {
  return (req: any, res: any, next: () => void) => {
    const requestId = req.headers['x-request-id'] as string || generateRequestId();
    
    res.setHeader('X-Request-Id', requestId);
    
    withContextAsync({ requestId }, async () => {
      next();
    });
  };
}

export function logStage(stage: string, message: string, data?: Record<string, unknown>): void {
  const ctx = getContext();
  const logEntry: StructuredLog = {
    timestamp: new Date().toISOString(),
    level: 'INFO',
    message,
    stage,
    ...ctx,
    ...(data && { data }),
  };
  
  console.log(formatLog(logEntry));
}

export function logError(message: string, error: unknown, data?: Record<string, unknown>): void {
  const ctx = getContext();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const logEntry: StructuredLog = {
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    message,
    error: errorMessage,
    ...ctx,
    ...(data && { data }),
  };
  
  console.error(formatLog(logEntry));
}
