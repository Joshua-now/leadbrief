// Environment variable validation helper
// Checks required env vars at boot and logs warnings
// SECURITY: Never prints full secrets - only presence + last 4 chars

interface EnvCheckResult {
  isValid: boolean;
  missing: string[];
  warnings: string[];
  present: Record<string, string>;
}

// Secrets that should be redacted (never log full value)
const SECRETS = new Set([
  'DATABASE_URL',
  'SESSION_SECRET',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'API_KEY',
  'API_INTAKE_KEY',
  'DEBUG_KEY',
]);

// Required for Railway/Supabase deployment
const REQUIRED_FOR_RAILWAY = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SESSION_SECRET',
] as const;

// Optional but useful
const OPTIONAL_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'APP_URL',
  'API_KEY',
  'API_INTAKE_KEY',
  'DEBUG_KEY',
] as const;

// Replit-specific (only checked when on Replit)
const REPLIT_VARS = [
  'REPL_ID',
  'REPLIT_DEPLOYMENT',
] as const;

// Redact a secret value - shows "present(...xxxx)" or "NO"
function redactValue(key: string, value: string | undefined): string {
  if (!value) return 'NO';
  
  if (SECRETS.has(key)) {
    // For secrets, show only last 4 chars
    const suffix = value.length > 4 ? value.slice(-4) : '****';
    return `present(...${suffix})`;
  }
  
  // For non-secrets, just show YES
  return 'YES';
}

export function validateEnvironment(): EnvCheckResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const present: Record<string, string> = {};
  
  const isReplit = !!process.env.REPL_ID;
  const isRailway = !isReplit && !!process.env.SUPABASE_URL;
  
  // Check Replit vars if on Replit
  for (const key of REPLIT_VARS) {
    present[key] = redactValue(key, process.env[key]);
  }
  
  // On Railway, check required Supabase vars
  if (!isReplit) {
    for (const key of REQUIRED_FOR_RAILWAY) {
      present[key] = redactValue(key, process.env[key]);
      if (!process.env[key] && isRailway) {
        missing.push(key);
      }
    }
    
    // APP_URL is important for auth redirects
    if (!process.env.APP_URL && isRailway) {
      warnings.push('APP_URL not set - auth redirects may fail');
    }
  }
  
  // Check optional vars
  for (const key of OPTIONAL_VARS) {
    present[key] = redactValue(key, process.env[key]);
  }
  
  // Database URL check (always redacted)
  present['DATABASE_URL'] = redactValue('DATABASE_URL', process.env.DATABASE_URL);
  if (!process.env.DATABASE_URL) {
    warnings.push('DATABASE_URL not set - using default or in-memory storage');
  }
  
  // SESSION_SECRET check (always required for production)
  present['SESSION_SECRET'] = redactValue('SESSION_SECRET', process.env.SESSION_SECRET);
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
    missing.push('SESSION_SECRET');
  }
  
  const isValid = missing.length === 0;
  
  return { isValid, missing, warnings, present };
}

export function logEnvironmentStatus(): void {
  const result = validateEnvironment();
  const isReplit = !!process.env.REPL_ID;
  
  console.log('[Env] Environment:', isReplit ? 'Replit' : 'Railway/External');
  console.log('[Env] NODE_ENV:', process.env.NODE_ENV || 'development');
  
  if (result.missing.length > 0) {
    console.error('[Env] MISSING REQUIRED:', result.missing.join(', '));
  }
  
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.warn('[Env] WARNING:', warning);
    }
  }
  
  // Log presence flags (redacted values)
  const flags = Object.entries(result.present)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  console.log('[Env] Vars:', flags);
}

export function getEnvPresenceFlags(): Record<string, boolean> {
  const result = validateEnvironment();
  // Convert redacted strings back to booleans for API responses
  const flags: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(result.present)) {
    flags[key] = val !== 'NO';
  }
  return flags;
}

// Get app version from package.json or env
export function getAppVersion(): string {
  return process.env.npm_package_version || process.env.APP_VERSION || '1.0.0';
}

// Check if running on Replit
export function isReplit(): boolean {
  return !!process.env.REPL_ID;
}

// Check if Replit deployment mode
export function isReplitDeployment(): boolean {
  return process.env.REPLIT_DEPLOYMENT === 'true';
}

// Fail-fast startup validation
// Call this early in boot - exits process if critical vars are missing
export function validateOrExit(): void {
  const result = validateEnvironment();
  
  logEnvironmentStatus();
  
  if (!result.isValid) {
    console.error('\n========================================');
    console.error('FATAL: Missing required environment variables');
    console.error('========================================');
    console.error('Missing:', result.missing.join(', '));
    console.error('\nSee .env.example for required variables.');
    console.error('See RUNBOOK.md for setup instructions.');
    console.error('========================================\n');
    
    // In production, exit immediately
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    // In development, log warning but continue
    console.warn('[Env] Continuing in development mode with missing vars...');
  }
}

// Check if all critical dependencies are ready
export interface DependencyStatus {
  database: boolean;
  auth: boolean;
  ready: boolean;
  details: Record<string, string>;
}

export async function checkDependencies(): Promise<DependencyStatus> {
  const details: Record<string, string> = {};
  let database = false;
  let auth = false;
  
  // Check database with detailed error handling
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    details.database = 'DATABASE_URL not configured';
  } else {
    try {
      const { storage } = await import('../storage');
      const startTime = Date.now();
      await storage.getBulkJobs(1);
      const latencyMs = Date.now() - startTime;
      database = true;
      details.database = `connected (${latencyMs}ms)`;
    } catch (e: any) {
      const errorMsg = e.message || 'connection failed';
      
      // Categorize database errors for better diagnostics
      if (errorMsg.includes('does not exist')) {
        details.database = `schema_missing: ${errorMsg}`;
      } else if (errorMsg.includes('connection') || errorMsg.includes('ECONNREFUSED')) {
        details.database = `connection_failed: ${errorMsg}`;
      } else if (errorMsg.includes('authentication') || errorMsg.includes('password')) {
        details.database = `auth_failed: credentials invalid`;
      } else {
        details.database = `error: ${errorMsg}`;
      }
      
      console.error('[Ready] Database check failed:', errorMsg);
    }
  }
  
  // Check auth configuration
  const isReplitEnv = !!process.env.REPL_ID;
  const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  
  if (isReplitEnv) {
    auth = true;
    details.auth = 'replit (OIDC)';
  } else if (hasSupabase) {
    auth = true;
    details.auth = 'supabase (JWT)';
  } else {
    details.auth = 'not_configured: set REPL_ID or SUPABASE_URL+SUPABASE_ANON_KEY';
  }
  
  const ready = database && auth;
  
  // Log readiness status for observability
  if (ready) {
    console.log('[Ready] All dependencies ready:', details);
  } else {
    console.warn('[Ready] Not ready:', details);
  }
  
  return {
    database,
    auth,
    ready,
    details,
  };
}
