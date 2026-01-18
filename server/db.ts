import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const dbUrl = process.env.DATABASE_URL;

console.log("[DB] DATABASE_URL present:", !!dbUrl);
console.log("[DB] DATABASE_URL starts with:", dbUrl?.substring(0, 50) + "...");

if (!dbUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// For Supabase pooler, use connectionString directly to preserve special username format
const isSupabasePooler = dbUrl.includes('pooler.supabase.com');

let poolConfig: pg.PoolConfig;

if (isSupabasePooler) {
  // Use connection string directly for Supabase pooler
  // This preserves the username format like "postgres.PROJECT_REF"
  poolConfig = {
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  };
  console.log("[DB] Using Supabase pooler with connection string, ssl: true");
} else {
  // Parse URL for other databases
  try {
    const url = new URL(dbUrl);
    const isExternalDb = url.hostname.includes('supabase');
    
    poolConfig = {
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: decodeURIComponent(url.password),
      ...(isExternalDb && { ssl: { rejectUnauthorized: false } }),
    };
    console.log("[DB] Parsed config - host:", poolConfig.host, "port:", poolConfig.port, "database:", poolConfig.database, "ssl:", isExternalDb);
  } catch (e) {
    console.error("[DB] Failed to parse DATABASE_URL:", e);
    throw new Error("Invalid DATABASE_URL format");
  }
}

export const pool = new Pool(poolConfig);
export const db = drizzle(pool, { schema });
