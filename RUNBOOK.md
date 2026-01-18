# LeadBrief Operations Runbook

## Overview

LeadBrief is a bulk contact enrichment platform that processes lead lists (CSV/JSON/XLSX), scrapes websites, extracts business intelligence, generates personalized outreach, and exports clean data.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                        │
│  - Import Page → Jobs Page → Contacts → Reports → Settings     │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express.js Backend                           │
│  - /api/import/bulk  - Bulk CSV/JSON import                    │
│  - /api/intake       - Single lead intake (webhook)            │
│  - /api/jobs         - Job management                          │
│  - /api/contacts     - Contact CRUD                            │
│  - /api/auth/*       - Authentication (Replit or Supabase)     │
│  - /api/health       - Health checks                           │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                          │
│  - users, sessions, bulk_jobs, bulk_job_items                  │
│  - companies, contacts, enrichment_errors, reports             │
└─────────────────────────────────────────────────────────────────┘
```

## Enrichment Pipeline

```
1. IMPORT → CSV/JSON/XLSX upload with field mapping
2. PARSE  → Extract and normalize fields
3. SCRAPE → Website scraping (10s timeout, 2 retries)
4. ENRICH → Extract services, industry, signals
5. PERSONALIZE → Generate icebreakers and bullets
6. EXPORT → CSV/JSON output
```

---

## Running Locally (Replit)

### Prerequisites
- Replit workspace with Node.js 20+
- PostgreSQL database (auto-provisioned)

### Steps

1. **Start the application:**
   ```bash
   npm run dev
   ```

2. **Access the app:**
   - Opens at https://your-repl.replit.app
   - Login via Replit Auth (automatic)

3. **Check health:**
   ```bash
   curl http://localhost:5000/api/health
   ```

### Environment Variables (Replit)

These are automatically set by Replit:
- `REPL_ID` - Auto-set, enables Replit Auth
- `DATABASE_URL` - Auto-set when PostgreSQL is provisioned
- `SESSION_SECRET` - Set manually in Secrets tab

---

## Running in Production (Railway + Supabase)

### Prerequisites
- Railway account with project
- Supabase project for auth and database
- GitHub repo connected to Railway

### Deployment Steps

1. **Create Supabase Project:**
   - Go to https://supabase.com/dashboard
   - Create new project, note the password

2. **Get Supabase Credentials:**
   - Settings → API → Copy `URL` and `anon public` key
   - Settings → Database → Copy Session Pooler connection string

3. **Set Railway Environment Variables:**
   ```
   DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
   SUPABASE_URL=https://[ref].supabase.co
   SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   SESSION_SECRET=[generate with: openssl rand -hex 32]
   APP_URL=https://your-app.railway.app
   NODE_ENV=production
   ```

4. **Push Database Schema:**
   ```bash
   # From local machine with Railway DATABASE_URL
   DATABASE_URL="your-supabase-url" npx drizzle-kit push
   
   # OR paste migration SQL in Supabase SQL Editor
   # (see migrations/*.sql)
   ```

5. **Deploy:**
   ```bash
   git push origin main
   # Railway auto-deploys from GitHub
   ```

6. **Verify:**
   ```bash
   curl https://your-app.railway.app/api/health
   ```

---

## Required Environment Variables

| Variable | Required | Environment | Description |
|----------|----------|-------------|-------------|
| `DATABASE_URL` | Yes | Both | PostgreSQL connection string |
| `SESSION_SECRET` | Yes (prod) | Both | Session encryption key (32+ chars) |
| `SUPABASE_URL` | Yes | Railway | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Railway | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | Railway | Supabase service role key |
| `APP_URL` | Recommended | Railway | App URL for auth redirects |
| `API_KEY` | Optional | Both | API key for /api/intake endpoint |
| `DEBUG_KEY` | Optional | Both | Key for /debug/lastlog endpoint |
| `REPL_ID` | Auto | Replit | Auto-set by Replit |
| `NODE_ENV` | Optional | Both | `production` or `development` |
| `PORT` | Optional | Both | Server port (default: 5000) |

---

## Health Checks

### Basic Health
```bash
curl /api/health
# Returns: {"ok":true,"version":"1.0.0",...}
```

### Detailed Health
```bash
curl /api/health?detailed=true
# Returns: database status, memory usage, processor status
```

### Health Response Codes
- `200` - Healthy
- `503` - Unhealthy (check response body for details)

---

## Common Failure Modes

### 1. "relation 'users' does not exist"

**Cause:** Database schema not pushed to Supabase.

**Fix:**
```bash
DATABASE_URL="your-url" npx drizzle-kit push
# OR paste SQL from migrations/*.sql into Supabase SQL Editor
```

### 2. "Tenant or user not found"

**Cause:** Wrong database password or connection string.

**Fix:**
1. Go to Supabase → Settings → Database
2. Copy Session Pooler URI (not Transaction)
3. Make sure password is URL-encoded if it has special chars

### 3. Login redirects back to landing page

**Cause:** Supabase config not loaded on frontend.

**Fix:**
1. Check SUPABASE_URL and SUPABASE_ANON_KEY are set
2. Verify /api/auth/config returns `supabaseConfigured: true`
3. Clear browser cache/localStorage

### 4. "ENOTFOUND" or connection errors

**Cause:** Invalid hostname in DATABASE_URL.

**Fix:**
1. Use Session Pooler (port 5432), not Transaction Pooler (port 6543)
2. Verify URL format: `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`

### 5. Auth works but logout doesn't

**Cause:** Frontend not clearing Supabase session.

**Fix:** Already fixed in codebase - logout calls `signOut()` before redirect.

### 6. Memory unhealthy warnings

**Cause:** Node.js memory usage above threshold.

**Fix:** Normal in constrained environments. Increase memory allocation if persistent.

---

## Debugging

### View Server Logs

**Replit:**
- Check console in Replit workspace

**Railway:**
- Railway Dashboard → Deployments → View Logs

### Debug Endpoint
```bash
curl -H "X-DEBUG-KEY: your-debug-key" /debug/lastlog
# Returns last 100 lines of crash log
```

### Check Environment
```bash
curl /api/health?detailed=true
# Shows which env vars are configured
```

---

## Database Operations

### Push Schema Changes
```bash
npm run db:push
```

### View Schema
```bash
npx drizzle-kit studio
```

### Direct SQL (Supabase)
Use Supabase Dashboard → SQL Editor

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/health` | GET | No | Health check |
| `/api/auth/config` | GET | No | Auth provider info |
| `/api/auth/user` | GET | Yes | Current user |
| `/api/import/bulk` | POST | Yes | Bulk import |
| `/api/intake` | POST | API Key | Single lead intake |
| `/api/jobs` | GET | Yes | List jobs |
| `/api/jobs/:id` | GET | Yes | Job details |
| `/api/jobs/:id/retry` | POST | Yes | Retry failed job |
| `/api/contacts` | GET | Yes | List contacts |
| `/api/contacts/:id` | GET | Yes | Contact details |
| `/api/settings` | GET/POST | Yes | User settings |

---

## Verification Checklist

Before going live, verify:

- [ ] `curl /api/health` returns `{"ok":true}`
- [ ] `curl /api/health?detailed=true` shows `database.healthy: true`
- [ ] Login works (redirects to app after auth)
- [ ] Logout works (returns to landing page)
- [ ] Can upload CSV and see job created
- [ ] Can view contacts list
- [ ] Settings page loads

---

## Support

If issues persist:
1. Check Railway/Replit logs
2. Verify all environment variables are set
3. Ensure database schema is pushed
4. Clear browser cache and try again
