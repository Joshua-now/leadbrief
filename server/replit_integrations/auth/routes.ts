import type { Express, Request, Response, NextFunction } from "express";
import { authStorage } from "./storage";
import { activeAuthProvider, isAuthEnabled } from "./replitAuth";
import { verifySupabaseToken } from "../../lib/supabase";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", async (req: Request, res: Response, next: NextFunction) => {
    if (!isAuthEnabled) {
      return res.status(501).json({ 
        error: "Authentication not configured",
        message: "No authentication provider is configured."
      });
    }
    
    if (activeAuthProvider === 'supabase') {
      try {
        const sessionUser = (req.session as any)?.user;
        
        if (sessionUser && sessionUser.provider === 'supabase') {
          const result = await verifySupabaseToken(sessionUser.access_token);
          if (result) {
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
            (req.session as any).user = null;
          }
        }
        
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          const result = await verifySupabaseToken(token);
          if (result) {
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
        
        return res.status(401).json({ message: "Unauthorized" });
      } catch (error) {
        console.error("Error fetching Supabase user:", error);
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
