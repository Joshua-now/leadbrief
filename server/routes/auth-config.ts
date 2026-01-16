import type { Express } from "express";
import { activeAuthProvider, isAuthEnabled, isReplitEnvironment, isRailwayEnvironment } from "../replit_integrations/auth";
import { isSupabaseConfigured } from "../lib/supabase";

export function registerAuthConfigRoutes(app: Express) {
  // Public endpoint to tell the frontend which auth provider to use
  app.get("/api/auth/config", (_req, res) => {
    res.json({
      provider: activeAuthProvider,
      isEnabled: isAuthEnabled,
      environment: isReplitEnvironment() ? 'replit' : isRailwayEnvironment() ? 'railway' : 'unknown',
      supabaseConfigured: isSupabaseConfigured(),
    });
  });
}
