import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import { isSupabaseConfigured, verifySupabaseToken } from "../../lib/supabase";

// Environment detection
export function isReplitEnvironment(): boolean {
  return !!(process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT || process.env.REPLIT_ENV);
}

export function isRailwayEnvironment(): boolean {
  return !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
}

// Check which auth providers are available
export function checkReplitAuthEnabled(): boolean {
  const replId = process.env.REPL_ID;
  const sessionSecret = process.env.SESSION_SECRET;
  const databaseUrl = process.env.DATABASE_URL;
  
  return !!(replId && sessionSecret && databaseUrl);
}

export function checkSupabaseAuthEnabled(): boolean {
  return isSupabaseConfigured() && !!process.env.SESSION_SECRET;
}

// Determine which auth system to use
export function getActiveAuthProvider(): 'replit' | 'supabase' | 'none' {
  // On Replit, prefer Replit Auth
  if (isReplitEnvironment() && checkReplitAuthEnabled()) {
    return 'replit';
  }
  
  // On Railway or when Supabase is configured, use Supabase
  if (checkSupabaseAuthEnabled()) {
    return 'supabase';
  }
  
  // Fallback: if on Replit with REPL_ID, try Replit Auth
  if (checkReplitAuthEnabled()) {
    return 'replit';
  }
  
  return 'none';
}

export const activeAuthProvider = getActiveAuthProvider();
export const isAuthEnabled = activeAuthProvider !== 'none';

console.log(`[Auth] Environment: ${isReplitEnvironment() ? 'Replit' : isRailwayEnvironment() ? 'Railway' : 'Unknown'}`);
console.log(`[Auth] Active provider: ${activeAuthProvider}`);

const getOidcConfig = memoize(
  async () => {
    if (!process.env.REPL_ID) {
      throw new Error("REPL_ID is required for OIDC configuration");
    }
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret && process.env.NODE_ENV === 'production') {
    console.error('[Auth] SESSION_SECRET is required in production');
    throw new Error('SESSION_SECRET environment variable is required');
  }
  
  // Only use PG store if DATABASE_URL is available
  let store: session.Store | undefined;
  if (process.env.DATABASE_URL) {
    const pgStore = connectPg(session);
    store = new pgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: false,
      ttl: sessionTtl,
      tableName: "sessions",
    });
  }
  
  return session({
    secret: sessionSecret || 'dev-session-secret-change-in-production',
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

async function upsertSupabaseUser(user: any) {
  await authStorage.upsertUser({
    id: user.id,
    email: user.email,
    firstName: user.user_metadata?.first_name || user.user_metadata?.full_name?.split(' ')[0] || null,
    lastName: user.user_metadata?.last_name || user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || null,
    profileImageUrl: user.user_metadata?.avatar_url || null,
  });
}

export async function setupAuth(app: Express) {
  // Always set up session middleware
  app.set("trust proxy", 1);
  
  if (process.env.SESSION_SECRET || process.env.DATABASE_URL) {
    app.use(getSession());
  }
  
  // If no auth is configured, register stub routes
  if (activeAuthProvider === 'none') {
    console.log("[Auth] No auth provider configured - auth endpoints will be disabled");
    
    app.get("/api/login", (_req, res) => {
      res.status(501).json({ 
        error: "Authentication not configured",
        message: "No authentication provider is configured. Set up Supabase or run on Replit."
      });
    });
    
    app.get("/api/callback", (_req, res) => {
      res.status(501).json({ error: "Authentication not configured" });
    });
    
    app.get("/api/logout", (_req, res) => {
      res.status(501).json({ error: "Authentication not configured" });
    });
    
    return;
  }
  
  // Supabase Auth routes
  if (activeAuthProvider === 'supabase') {
    console.log("[Auth] Setting up Supabase Auth routes");
    
    // Login route - redirect to frontend Supabase login
    app.get("/api/login", (_req, res) => {
      // For Supabase, login is handled on the frontend
      res.json({ 
        provider: 'supabase',
        message: 'Use the frontend login form to authenticate with Supabase'
      });
    });
    
    // Supabase session endpoint - frontend posts the access token
    app.post("/api/auth/supabase/session", async (req: Request, res: Response) => {
      try {
        const { access_token } = req.body;
        
        if (!access_token) {
          return res.status(400).json({ error: "Access token required" });
        }
        
        const result = await verifySupabaseToken(access_token);
        if (!result) {
          return res.status(401).json({ error: "Invalid token" });
        }
        
        // Store user in session
        (req.session as any).user = {
          id: result.user.id,
          email: result.user.email,
          provider: 'supabase',
          access_token,
        };
        
        // Upsert user to database
        await upsertSupabaseUser(result.user);
        
        res.json({ success: true, user: result.user });
      } catch (error) {
        console.error("[Auth] Supabase session error:", error);
        res.status(500).json({ error: "Authentication failed" });
      }
    });
    
    app.get("/api/callback", (_req, res) => {
      // Supabase handles callbacks on the frontend
      res.redirect('/');
    });
    
    app.get("/api/logout", (req, res) => {
      req.session.destroy((err) => {
        if (err) {
          console.error("[Auth] Logout error:", err);
        }
        res.redirect('/');
      });
    });
    
    return;
  }
  
  // Replit Auth setup (only runs when activeAuthProvider === 'replit')
  console.log("[Auth] Setting up Replit Auth");
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  const registeredStrategies = new Set<string>();

  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  // If auth is not enabled, return 501
  if (!isAuthEnabled) {
    return res.status(501).json({ 
      error: "Authentication not configured",
      message: "Protected endpoints require authentication which is not configured."
    });
  }
  
  // Supabase auth check
  if (activeAuthProvider === 'supabase') {
    // Check session first
    const sessionUser = (req.session as any)?.user;
    if (sessionUser && sessionUser.provider === 'supabase') {
      // Verify the token is still valid
      const result = await verifySupabaseToken(sessionUser.access_token);
      if (result) {
        (req as any).user = sessionUser;
        return next();
      }
    }
    
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const result = await verifySupabaseToken(token);
      if (result) {
        (req as any).user = {
          id: result.user.id,
          email: result.user.email,
          provider: 'supabase',
        };
        return next();
      }
    }
    
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  // Replit auth check
  const user = req.user as any;

  if (!req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized" });
  }
};
