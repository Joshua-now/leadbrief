# LeadBrief

A bulk contact enrichment platform supporting CSV/JSON/XLSX imports with robust job management and dual authentication.

## Features

- **Bulk Import**: Upload CSV, JSON, or XLSX files with automatic field mapping
- **Job Management**: Track import progress with real-time status updates
- **Contact Management**: Search, filter, and manage enriched contacts
- **Self-Healing**: Auto-retry failed items, recover stale jobs
- **Dual Auth**: Supports Replit Auth (on Replit) and Supabase Auth (on Railway)

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Express.js, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Replit Auth (OIDC) or Supabase Auth

## Quick Start (Replit)

1. Fork or import this project on Replit
2. The DATABASE_URL and SESSION_SECRET are auto-configured
3. Click "Run" to start the development server
4. Visit the app URL to access the landing page

## Railway Deployment

### Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Session encryption key (generate with `openssl rand -hex 32`) |
| `SUPABASE_URL` | Yes | Supabase project URL (e.g., `https://xxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | Supabase service role key (for server operations) |
| `VITE_SUPABASE_URL` | Yes | Same as SUPABASE_URL (required for client-side auth) |
| `VITE_SUPABASE_ANON_KEY` | Yes | Same as SUPABASE_ANON_KEY (required for client-side auth) |
| `APP_URL` | Recommended | Your app URL (e.g., `https://myapp.up.railway.app`) |
| `API_KEY` | Optional | API key for `/api/intake` endpoint protection |
| `DEBUG_KEY` | Recommended | Secret key for `/api/debug/lastlog` endpoint access |
| `NODE_ENV` | Optional | Set to `production` for production builds |

### Deploy Steps

1. **Create PostgreSQL database** in Railway

2. **Create Supabase project** for authentication:
   - Go to [supabase.com](https://supabase.com)
   - Create a new project
   - Copy the URL and keys from Project Settings > API
   - **Configure Supabase Dashboard**:
     - Go to Authentication > URL Configuration
     - Set Site URL: `https://your-app.up.railway.app`
     - Add Redirect URLs: `https://your-app.up.railway.app/*`

3. **Set environment variables** in Railway:
   ```bash
   DATABASE_URL=<railway-postgres-url>
   SESSION_SECRET=<openssl rand -hex 32>
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_ANON_KEY=<your-anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
   VITE_SUPABASE_URL=https://xxx.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-anon-key>
   APP_URL=https://your-app.up.railway.app
   DEBUG_KEY=<openssl rand -hex 16>
   NODE_ENV=production
   ```
   
   > **Important**: The `VITE_` prefixed variables are required for the browser-side Supabase client. They must be set BEFORE the build step runs (Vite bakes them into the bundle).

4. **Initialize database** (BEFORE first deploy):
   
   Use the Railway CLI or shell to run db:push BEFORE starting the app:
   ```bash
   # From Railway shell or CLI with DATABASE_URL set
   npm run db:push
   ```
   
   > **Critical**: The database tables MUST exist before the app starts. If you skip this step, the app will crash on startup.

5. **Build and start commands** (Railway service settings):
   - Build command: `npm run build`
   - Start command: `npm run start`

6. **Redeploy** if db:push was run after initial deploy

### Auth Provider Detection

The app automatically detects which auth provider to use:

- **On Replit** (REPL_ID present): Uses Replit Auth via OIDC
- **On Railway** (SUPABASE_URL configured): Uses Supabase Auth
- **Neither configured**: Auth endpoints return 501 "not configured"

## API Endpoints

### Public Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check (add `?detailed=true` for full info) |
| `/api/config/limits` | GET | Get import limits |
| `/api/auth/config` | GET | Get auth provider info |
| `/api/debug/lastlog` | GET | Get last N log lines (requires `X-DEBUG-KEY` header) |

### Protected Endpoints (require auth)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jobs` | GET | List all jobs |
| `/api/jobs/:id` | GET | Get job details |
| `/api/jobs/:id/retry` | POST | Retry failed job |
| `/api/contacts` | GET | List contacts (paginated) |
| `/api/contacts/:id` | GET | Get contact details |
| `/api/settings` | GET/POST | User settings |

### Webhook Endpoints (API key protected)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/intake` | POST | Single contact intake (GHL compatible) |
| `/api/import/bulk` | POST | Bulk import endpoint |

Use `X-API-KEY` header for webhook endpoints when `API_KEY` env var is set.

## Import Limits

- Max file size: 10MB
- Max records per import: 10,000
- Email length: 5-254 characters
- Field length: 500 characters max

## Development

```bash
# Install dependencies
npm install

# Push database schema
npm run db:push

# Start development server
npm run dev

# Type check
npm run check

# Build for production
npm run build

# Run verification tests
npx tsx scripts/verify.ts
```

## Node Version

This project requires Node.js 20.x. See `.nvmrc` for the pinned version.

## License

MIT
