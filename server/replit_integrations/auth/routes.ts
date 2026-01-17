import type { Express, Request, Response, NextFunction } from "express";
import { authStorage } from "./storage";
import { activeAuthProvider, isAuthEnabled } from "./replitAuth";
import { verifySupabaseToken } from "../../lib/supabase";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", async (req: Request, res: Response, next: NextFunction) => {
    console.log("[Auth] /api/auth/user request, provider:", activeAuthProvider);
    
    if (!isAuthEnabled) {
      console.log("[Auth] Auth not enabled");
      return res.status(501).json({ 
        error: "Authentication not configured",
        message: "No authentication provider is configured."
      });
    }
    
    if (activeAuthProvider === 'supabase') {
      try {
        const sessionUser = (req.session as any)?.user;
        console.log("[Auth] Session user:", sessionUser ? { id: sessionUser.id, provider: sessionUser.provider } : null);
        
        if (sessionUser && sessionUser.provider === 'supabase') {
          console.log("[Auth] Verifying stored access token...");
          const result = await verifySupabaseToken(sessionUser.access_token);
          if (result) {
            console.log("[Auth] Token valid, returning user data");
            const user = await authStorage.getUser(sessionUser.id);
            if (user) {
              return res.json(user);
            }
            return res.json({
              id: sessionUser.id,
              email: sessionUser.email,
              firstName: null,
              lastName: null,
              profileImageUrl: null,
            });
          } else {
            console.log("[Auth] Token verification failed, clearing session");
            (req.session as any).user = null;
          }
        }
        
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
          console.log("[Auth] Trying Bearer token from header...");
          const token = authHeader.slice(7);
          const result = await verifySupabaseToken(token);
          if (result) {
            console.log("[Auth] Bearer token valid");
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
        
        console.log("[Auth] No valid session or token found");
        return res.status(401).json({ message: "Unauthorized" });
      } catch (error) {
        console.error("[Auth] Error fetching Supabase user:", error);
        return res.status(500).json({ message: "Failed to fetch user" });
      }
    }
    
    const user = req.user as any;

    if (!req.isAuthenticated || !req.isAuthenticated() || !user?.expires_at) {
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
