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
