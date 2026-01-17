import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  // In production, the bundle is at dist/index.cjs and static files at dist/public
  // Use process.cwd() for Railway compatibility since __dirname may not resolve correctly
  const distPath = path.resolve(process.cwd(), "dist", "public");
  
  console.log(`[Static] Serving static files from: ${distPath}`);
  console.log(`[Static] Directory exists: ${fs.existsSync(distPath)}`);
  
  if (!fs.existsSync(distPath)) {
    // Fallback: try __dirname approach
    const fallbackPath = path.resolve(__dirname, "public");
    console.log(`[Static] Trying fallback path: ${fallbackPath}`);
    if (fs.existsSync(fallbackPath)) {
      console.log(`[Static] Using fallback path`);
      app.use(express.static(fallbackPath));
      app.use("*", (_req, res) => {
        res.sendFile(path.resolve(fallbackPath, "index.html"));
      });
      return;
    }
    throw new Error(
      `Could not find the build directory at ${distPath} or ${fallbackPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
