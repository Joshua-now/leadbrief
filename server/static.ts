import express, { type Express, type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // In production, the bundle is at dist/index.cjs and static files at dist/public
  // Use process.cwd() for Railway compatibility since __dirname may not resolve correctly
  const distPath = path.resolve(process.cwd(), "dist", "public");
  
  console.log(`[Static] Serving static files from: ${distPath}`);
  console.log(`[Static] Directory exists: ${fs.existsSync(distPath)}`);
  
  // SPA fallback middleware - MUST exclude /api/* routes to prevent catching API requests
  const spaFallback = (staticPath: string) => (req: Request, res: Response, next: NextFunction) => {
    // Never serve index.html for API routes - let them 404 properly
    if (req.path.startsWith('/api/') || req.path.startsWith('/api')) {
      return next();
    }
    // Only serve index.html for GET requests (not POST, PUT, DELETE, etc.)
    if (req.method !== 'GET') {
      return next();
    }
    res.sendFile(path.resolve(staticPath, "index.html"));
  };
  
  if (!fs.existsSync(distPath)) {
    // Fallback: try __dirname approach
    const fallbackPath = path.resolve(__dirname, "public");
    console.log(`[Static] Trying fallback path: ${fallbackPath}`);
    if (fs.existsSync(fallbackPath)) {
      console.log(`[Static] Using fallback path`);
      app.use(express.static(fallbackPath));
      app.use("*", spaFallback(fallbackPath));
      return;
    }
    throw new Error(
      `Could not find the build directory at ${distPath} or ${fallbackPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // SPA fallback - serves index.html for client-side routes (excludes /api/*)
  app.use("*", spaFallback(distPath));
}
