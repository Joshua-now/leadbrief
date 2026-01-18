import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const dbUrl = process.env.DATABASE_URL;

console.log("[DB] DATABASE_URL present:", !!dbUrl);
console.log("[DB] DATABASE_URL starts with:", dbUrl?.substring(0, 30) + "...");

if (!dbUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Parse the connection string to validate and extract components
let poolConfig: pg.PoolConfig;
try {
  const url = new URL(dbUrl);
  poolConfig = {
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  };
  console.log("[DB] Parsed config - host:", poolConfig.host, "port:", poolConfig.port, "database:", poolConfig.database);
} catch (e) {
  console.error("[DB] Failed to parse DATABASE_URL:", e);
  throw new Error("Invalid DATABASE_URL format");
}

export const pool = new Pool(poolConfig);
export const db = drizzle(pool, { schema });
