// Crash-proof logging module
// Captures uncaught exceptions, unhandled rejections, and writes to rolling file
import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = '/tmp/app.log';
const MAX_LOG_LINES = 2000;
const logBuffer: string[] = [];

function timestamp(): string {
  return new Date().toISOString();
}

function writeToFile(message: string): void {
  try {
    // Add to buffer
    logBuffer.push(message);
    
    // Keep only last MAX_LOG_LINES
    while (logBuffer.length > MAX_LOG_LINES) {
      logBuffer.shift();
    }
    
    // Write to file (append mode, but we manage rotation ourselves)
    fs.appendFileSync(LOG_FILE, message + '\n');
    
    // Truncate file if too large (> 1MB)
    try {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > 1024 * 1024) {
        // Rewrite with only recent lines
        fs.writeFileSync(LOG_FILE, logBuffer.join('\n') + '\n');
      }
    } catch {
      // Ignore stat errors
    }
  } catch (err) {
    // Fallback: just log to console
    console.error('[CrashLogger] Failed to write to file:', err);
  }
}

export function crashLog(level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL', message: string, meta?: any): void {
  const logLine = `[${timestamp()}] [${level}] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  
  // Always write to stdout/stderr
  if (level === 'ERROR' || level === 'FATAL') {
    console.error(logLine);
  } else {
    console.log(logLine);
  }
  
  // Also write to file
  writeToFile(logLine);
}

export function getLastLogs(lines: number = 100): string[] {
  // Try to read from buffer first
  if (logBuffer.length > 0) {
    return logBuffer.slice(-lines);
  }
  
  // Fallback: read from file
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const allLines = content.split('\n').filter(l => l.trim());
    return allLines.slice(-lines);
  } catch {
    return ['[No logs available]'];
  }
}

export function setupCrashHandlers(): void {
  crashLog('INFO', 'Setting up crash handlers');
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    crashLog('FATAL', 'Uncaught Exception', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
    
    // Give time for logs to flush
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    crashLog('FATAL', 'Unhandled Rejection', {
      reason: reason instanceof Error ? {
        name: reason.name,
        message: reason.message,
        stack: reason.stack,
      } : reason,
    });
  });
  
  // Handle SIGTERM (Railway sends this before killing)
  process.on('SIGTERM', () => {
    crashLog('WARN', 'Received SIGTERM - shutting down gracefully');
  });
  
  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    crashLog('WARN', 'Received SIGINT - shutting down');
  });
  
  crashLog('INFO', 'Crash handlers registered');
}

// Clear old log file on startup
export function initLogFile(): void {
  try {
    // Create /tmp if it doesn't exist (shouldn't be needed but just in case)
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Read existing logs into buffer (for persistence across restarts)
    if (fs.existsSync(LOG_FILE)) {
      const content = fs.readFileSync(LOG_FILE, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      logBuffer.push(...lines.slice(-MAX_LOG_LINES));
    }
    
    crashLog('INFO', 'Log file initialized', { path: LOG_FILE });
  } catch (err) {
    console.error('[CrashLogger] Failed to init log file:', err);
  }
}
