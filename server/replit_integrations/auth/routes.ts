import type { Express, Request, Response, NextFunction } from "express";
import { authStorage } from "./storage";
import { getActiveAuthProvider, getIsAuthEnabled } from "./replitAuth";
import { verifySupabaseToken } from "../../lib/supabase";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", async (req: Request, res: Response, next: NextFunction) => {
    const activeAuthProvider = getActiveAuthProvider();
    console.log("[Auth] /api/auth/user request, provider:", activeAuthProvider);
    
    if (!getIsAuthEnabled()) {
      console.log("[Auth] Auth not enabled");
      return res.status(501).json({ 
        error: "Authentication not configured",
        message: "No authentication provider is configured."
      });
    }
    
    // Supabase auth - stateless, Bearer token only (no sessions)
    if (activeAuthProvider === 'supabase') {
      try {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          const result = await verifySupabaseToken(token);
          if (result) {
            // Upsert user to ensure they exist in database
            await authStorage.upsertUser({
              id: result.user.id,
              email: result.user.email,
              firstName: result.user.user_metadata?.first_name || result.user.user_metadata?.full_name?.split(' ')[0] || null,
              lastName: result.user.user_metadata?.last_name || result.user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || null,
              profileImageUrl: result.user.user_metadata?.avatar_url || null,
            });
            
            const user = await authStorage.getUser(result.user.id);
            if (user) {
              return res.json(user);
            }
            return res.json({
              id: result.user.id,
              email: result.user.email,
              firstName: result.user.user_metadata?.first_name || null,
              lastName: result.user.user_metadata?.last_name || null,
              profileImageUrl: result.user.user_metadata?.avatar_url || null,
            });
          }
        }
        
        console.log("[Auth] No valid Bearer token found");
        return res.status(401).json({ message: "Unauthorized" });
      } catch (error) {
        console.error("[Auth] Error fetching Supabase user:", error);
        return res.status(500).json({ message: "Failed to fetch user" });
      }
    }
    
    const user = req.user as any;

    if (!req.isAuthenticated || !req.isAuthenticated() || !user?.expires_at) {
      console.log(`[Auth] /api/auth/user 401 - isAuthenticated fn: ${!!req.isAuthenticated}, isAuthenticated(): ${req.isAuthenticated?.()}, hasUser: ${!!user}, expires_at: ${user?.expires_at}, sessionID: ${(req as any).sessionID?.slice(0, 8)}`);
      return res.status(401).json({ message: "Unauthorized" });
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > user.expires_at && !user.refresh_token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const userId = user?.claims?.sub || user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const dbUser = await authStorage.getUser(userId);
      res.json(dbUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
