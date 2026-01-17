import passport from "passport";
import session from "express-session";
import connectPg from "connect-pg-simple";
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import memoize from "memoizee";
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
  const databaseUrl = process.env.DATABASE_URL;
  return !!(replId && databaseUrl);
}

export function checkSupabaseAuthEnabled(): boolean {
  return isSupabaseConfigured();
}

// Determine which auth system to use - called lazily to ensure env vars are loaded
let _cachedProvider: 'replit' | 'supabase' | 'none' | null = null;

export function getActiveAuthProvider(): 'replit' | 'supabase' | 'none' {
  if (_cachedProvider !== null) {
    return _cachedProvider;
  }
  
  // Log environment detection
  const envType = isReplitEnvironment() ? 'Replit' : isRailwayEnvironment() ? 'Railway' : 'Unknown';
  console.log(`[Auth] Environment: ${envType}`);
  console.log(`[Auth] REPL_ID: ${process.env.REPL_ID ? 'YES' : 'NO'}`);
  console.log(`[Auth] SUPABASE_URL: ${process.env.SUPABASE_URL ? 'YES' : 'NO'}`);
  console.log(`[Auth] SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? 'YES' : 'NO'}`);
  
  // On Replit with valid config, use Replit Auth
  if (isReplitEnvironment() && checkReplitAuthEnabled()) {
    _cachedProvider = 'replit';
    console.log(`[Auth] Active provider: replit`);
    return _cachedProvider;
  }
  
  // If Supabase is configured (Railway or anywhere), use Supabase
  if (checkSupabaseAuthEnabled()) {
    _cachedProvider = 'supabase';
    console.log(`[Auth] Active provider: supabase`);
    return _cachedProvider;
  }
  
  // Fallback for Replit without proper config
  if (checkReplitAuthEnabled()) {
    _cachedProvider = 'replit';
    console.log(`[Auth] Active provider: replit (fallback)`);
    return _cachedProvider;
  }
  
  _cachedProvider = 'none';
  console.log(`[Auth] Active provider: none`);
  return _cachedProvider;
}

// These are now getters that call the lazy function
export function getIsAuthEnabled(): boolean {
  return getActiveAuthProvider() !== 'none';
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
  app.set("trust proxy", 1);
  
  const activeProvider = getActiveAuthProvider();
  
  // No auth configured - stub routes
  if (activeProvider === 'none') {
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
  
  // Supabase Auth routes (Railway, external deployments) - STATELESS, no sessions
  if (activeProvider === 'supabase') {
    console.log("[Auth] Setting up Supabase Auth routes (stateless JWT-only)");
    
    app.get("/api/login", (_req, res) => {
      res.json({ 
        provider: 'supabase',
        message: 'Use the frontend login form to authenticate with Supabase'
      });
    });
    
    // Token verification endpoint - no session storage, just validates and upserts user
    app.post("/api/auth/supabase/verify", async (req: Request, res: Response) => {
      try {
        const { access_token } = req.body;
        
        if (!access_token) {
          return res.status(400).json({ error: "Access token required" });
        }
        
        const result = await verifySupabaseToken(access_token);
        if (!result) {
          return res.status(401).json({ error: "Invalid token" });
        }
        
        // Upsert user to database
        await upsertSupabaseUser(result.user);
        
        res.json({ success: true, user: result.user });
      } catch (error: any) {
        console.error("[Auth] Supabase verify error:", error?.message || error);
        res.status(500).json({ error: "Verification failed" });
      }
    });
    
    app.get("/api/callback", (_req, res) => {
      res.redirect('/');
    });
    
    app.get("/api/logout", (_req, res) => {
      // Stateless - just redirect, client handles Supabase signout
      res.redirect('/');
    });
    
    return;
  }
  
  // Replit Auth setup - ONLY runs when activeProvider === 'replit'
  // This means REPL_ID is guaranteed to be defined
  if (activeProvider === 'replit') {
    console.log("[Auth] Setting up Replit Auth");
    
    // Set up session for Replit Auth (passport requires sessions)
    const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
    const sessionSecret = process.env.SESSION_SECRET;
    
    // Fail fast if SESSION_SECRET not provided in production
    if (!sessionSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('SESSION_SECRET is required for Replit Auth in production');
      }
      console.warn('[Auth] SESSION_SECRET not set - using insecure dev secret (NOT FOR PRODUCTION)');
    }
    const secret = sessionSecret || 'dev-session-secret-not-for-production';
    
    let store: session.Store | undefined;
    if (process.env.DATABASE_URL) {
      const pgStore = connectPg(session);
      store = new pgStore({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: true,
        ttl: sessionTtl,
        tableName: "sessions",
      });
    }
    
    app.use(session({
      secret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: sessionTtl,
      },
    }));
    
    // Dynamic import to avoid loading openid-client on Railway
    const client = await import("openid-client");
    const { Strategy } = await import("openid-client/passport");
    
    app.use(passport.initialize());
    app.use(passport.session());

    const getOidcConfig = memoize(
      async () => {
        return await client.discovery(
          new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
          process.env.REPL_ID!
        );
      },
      { maxAge: 3600 * 1000 }
    );

    const config = await getOidcConfig();

    const updateUserSession = (
      user: any,
      tokens: any
    ) => {
      user.claims = tokens.claims();
      user.access_token = tokens.access_token;
      user.refresh_token = tokens.refresh_token;
      user.expires_at = user.claims?.exp;
    };

    const upsertUser = async (claims: any) => {
      await authStorage.upsertUser({
        id: claims["sub"],
        email: claims["email"],
        firstName: claims["first_name"],
        lastName: claims["last_name"],
        profileImageUrl: claims["profile_image_url"],
      });
    };

    const verify = async (tokens: any, verified: any) => {
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

    app.get("/api/logout", async (req, res) => {
      const cfg = await getOidcConfig();
      req.logout(() => {
        res.redirect(
          client.buildEndSessionUrl(cfg, {
            client_id: process.env.REPL_ID!,
            post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
          }).href
        );
      });
    });
    
    // Store config for middleware use
    (app as any).__replitOidcConfig = getOidcConfig;
    (app as any).__replitClient = client;
    (app as any).__updateUserSession = updateUserSession;
  }
}

export const isAuthenticated: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  if (!getIsAuthEnabled()) {
    return res.status(501).json({ 
      error: "Authentication not configured",
      message: "Protected endpoints require authentication which is not configured."
    });
  }
  
  // Supabase auth check - stateless, Bearer token only
  if (getActiveAuthProvider() === 'supabase') {
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

  if (!req.isAuthenticated || !req.isAuthenticated() || !user?.expires_at) {
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
    const app = req.app;
    const getOidcConfig = (app as any).__replitOidcConfig;
    const client = (app as any).__replitClient;
    const updateUserSession = (app as any).__updateUserSession;
    
    if (!getOidcConfig || !client || !updateUserSession) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized" });
  }
};
