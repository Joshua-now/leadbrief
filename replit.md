# LeadBrief

## Overview

LeadBrief is a production-ready bulk contact enrichment platform that takes input lead lists (CSV/JSON/XLSX), scrapes websites, extracts structured business intelligence, generates grounded personalization notes, and outputs clean exports (JSON/CSV). Features dual authentication (Replit Auth for Replit environment, Supabase Auth for Railway deployment), comprehensive guardrails, and crash-proof logging.

### Enrichment Pipeline
The platform processes leads through a complete enrichment pipeline:
1. **Import**: CSV/JSON/XLSX upload with field mapping and validation
2. **Scrape**: Website scraping with 10s timeout, 2 retries, redirect handling
3. **Parse**: Content extraction (services, industry, signals, contact data)
4. **Personalize**: Grounded personalization bullets and icebreakers
5. **Export**: CSV/JSON output with schema documentation

### Confidence Scoring (0-1 scale)
- **0.8-1.0**: Rich website content, multiple services, business signals
- **0.6-0.8**: Good content, some services extracted
- **0.4-0.6**: Thin content (access denied, minimal data)
- **0.2-0.4**: No website or failed scrape, generic personalization

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state and caching
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Build Tool**: Vite with HMR support for development

The frontend follows a page-based architecture with shared components. Key pages include:
- **Landing Page**: Public landing page for unauthenticated users with feature showcase
- **Import**: Data upload with CSV/JSON/XLSX support
- **Jobs**: Import job tracking with progress and status
- **Contacts**: Contact management with search and filtering  
- **Reports**: Analytics and insights dashboard
- **Settings**: Webhook configuration, API settings, notifications

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Server**: HTTP server with support for both development (Vite middleware) and production (static file serving)
- **API Design**: RESTful endpoints under `/api/*` prefix
- **Request Handling**: JSON body parsing with raw body preservation for webhook compatibility

The backend uses a modular route registration pattern with dedicated storage abstraction for database operations.

### Authentication
- **Provider**: Replit Auth via OpenID Connect
- **Session Management**: Express sessions with PostgreSQL store
- **Protected Routes**: All `/api/*` routes (except `/api/login`, `/api/callback`, `/api/health`) require authentication
- **User Data**: Stored in `users` table with Replit profile information

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` - shared between frontend and backend
- **Schema Push**: Uses `npm run db:push` (no migration files needed)
- **Key Tables**:
  - `users` - User accounts from Replit Auth
  - `sessions` - Session store for authentication
  - `settings` - User settings (webhook, API, notifications, retry)
  - `companies` - Company records with enrichment status
  - `contacts` - Contact information linked to companies
  - `bulk_jobs` - Import job tracking with progress and status
  - `bulk_job_items` - Individual records within bulk jobs

### Input Processing
- **CSV Parsing**: PapaParse library for robust CSV handling
- **Validation**: Zod schemas for data validation with drizzle-zod integration
- **Field Mapping**: Automatic header normalization and field detection
- **Error Handling**: Row-level error tracking with detailed error logs

### Build System
- **Development**: Vite dev server with React plugin and HMR
- **Production Build**: 
  - Client: Vite builds to `dist/public`
  - Server: esbuild bundles to `dist/index.cjs` with selective dependency bundling
  - **Important**: drizzle-orm and drizzle-zod are externalized (not bundled) to prevent migration code from triggering on startup
- **TypeScript**: Shared configuration with path aliases (`@/*` for client, `@shared/*` for shared code)

## External Dependencies

### Database
- **PostgreSQL**: Primary database (connection via `DATABASE_URL` environment variable)
- **Drizzle ORM**: Type-safe database queries and schema management
- **connect-pg-simple**: PostgreSQL session store for Express sessions

### UI Libraries
- **Radix UI**: Headless accessible component primitives
- **shadcn/ui**: Pre-styled component library (new-york style variant)
- **Lucide React**: Icon library
- **date-fns**: Date formatting utilities

### Data Processing
- **PapaParse**: CSV parsing and generation
- **Zod**: Schema validation
- **drizzle-zod**: Automatic Zod schema generation from Drizzle schemas

## Guard Rails & Self-Healing Features

### Input Validation
- **File Size Limits**: Maximum 10MB per import
- **Record Limits**: Maximum 10,000 records per import
- **Email Validation**: Regex validation with length limits (5-254 chars)
- **Field Length Limits**: 500 characters max per field
- **Duplicate Detection**: Within-import deduplication by email

### Rate Limiting
- **Bulk Import**: 10 requests per minute per IP
- **Single Intake**: 30 requests per minute per IP

### Self-Healing
- **Auto-Retry**: Failed items retry up to 3 times with exponential backoff
- **Stale Job Recovery**: Jobs stuck in "processing" for 5+ minutes can be recovered
- **Progress Checkpointing**: Jobs can resume from where they left off
- **Data Quality Scoring**: Automatic scoring based on field completeness

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/import/bulk` | POST | Bulk import CSV/JSON/email list |
| `/api/intake` | POST | Single contact intake (requires X-API-Key when API_INTAKE_KEY is set) |
| `/api/jobs` | GET | List all jobs |
| `/api/jobs/:id` | GET | Get job details with stats |
| `/api/jobs/:id/retry` | POST | Retry failed job |
| `/api/jobs/recover` | POST | Recover stale jobs |
| `/api/contacts` | GET | List contacts (paginated) |
| `/api/contacts/:id` | GET | Get contact details |
| `/api/health` | GET | System health check (liveness) |
| `/api/ready` | GET | Dependency readiness check |
| `/api/finalcheck` | GET | Comprehensive verification (tests health, ready, intake auth, DB write) |
| `/api/config/limits` | GET | Get import limits |
| `/api/auth/user` | GET | Get current authenticated user |
| `/api/settings` | GET/POST | User settings (protected) |
| `/api/login` | GET | Initiate Replit Auth login |
| `/api/logout` | GET | End session and logout |
| `/api/callback` | GET | OIDC callback handler |

### Development Tools
- **Vite**: Development server and build tool
- **esbuild**: Server-side bundling for production
- **TypeScript**: Type checking across the entire codebase

## Deployment Configuration

### Required Environment Variables

**Core (Always Required):**

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Secret key for session encryption (generate with `openssl rand -hex 32`) |
| `NODE_ENV` | Optional | Set to `production` for production builds |
| `PORT` | Optional | Server port (defaults to 5000) |

**Replit Auth (Auto-configured in Replit):**

| Variable | Description |
|----------|-------------|
| `REPL_ID` | Client ID for Replit OIDC (auto-set in Replit environment) |
| `ISSUER_URL` | OIDC issuer URL (defaults to https://replit.com/oidc) |

**Supabase Auth (For Railway/External Deployment):**

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL (e.g., https://xxx.supabase.co) |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `VITE_SUPABASE_URL` | Same as SUPABASE_URL (for frontend) |
| `VITE_SUPABASE_ANON_KEY` | Same as SUPABASE_ANON_KEY (for frontend) |

### Auth Provider Detection

The application automatically detects which auth provider to use:

1. **On Replit** (REPL_ID present): Uses Replit Auth via OIDC
2. **On Railway** (SUPABASE_URL configured): Uses Supabase Auth
3. **Neither configured**: Auth endpoints return 501 "Authentication not configured"

### Graceful Degradation

The application boots successfully even without authentication configured:

- **When no auth provider is available**: Auth endpoints return 501 instead of crashing
- **When SESSION_SECRET is missing**: Falls back to in-memory sessions (not for production)
- **Protected routes**: Return 501 when auth is disabled

### Railway Deployment

1. Create a PostgreSQL database in Railway
2. Create a Supabase project for authentication
3. Set environment variables:
   - `DATABASE_URL` - PostgreSQL connection string from Railway
   - `SESSION_SECRET` - Generate with `openssl rand -hex 32`
   - `SUPABASE_URL` - From Supabase project settings
   - `SUPABASE_ANON_KEY` - From Supabase API settings
   - `SUPABASE_SERVICE_ROLE_KEY` - From Supabase API settings
   - `VITE_SUPABASE_URL` - Same as SUPABASE_URL
   - `VITE_SUPABASE_ANON_KEY` - Same as SUPABASE_ANON_KEY
4. Build command: `npm run build`
5. Start command: `npm run start`