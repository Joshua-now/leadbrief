# LeadBrief

## Overview

LeadBrief is a bulk contact enrichment platform that allows users to import, validate, and manage contact data. The application supports CSV, JSON, and email list imports with automatic field mapping and validation. Users can track import jobs, view enriched contacts, and access analytics reports.

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

The frontend follows a page-based architecture with shared components. Key pages include Import (data upload), Jobs (tracking), Contacts (management), and Reports (analytics).

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Server**: HTTP server with support for both development (Vite middleware) and production (static file serving)
- **API Design**: RESTful endpoints under `/api/*` prefix
- **Request Handling**: JSON body parsing with raw body preservation for webhook compatibility

The backend uses a modular route registration pattern with dedicated storage abstraction for database operations.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` - shared between frontend and backend
- **Migrations**: Drizzle Kit for schema migrations stored in `/migrations`
- **Key Tables**:
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
| `/api/intake` | POST | Single contact intake (GHL webhook compatible) |
| `/api/jobs` | GET | List all jobs |
| `/api/jobs/:id` | GET | Get job details with stats |
| `/api/jobs/:id/retry` | POST | Retry failed job |
| `/api/jobs/recover` | POST | Recover stale jobs |
| `/api/contacts` | GET | List contacts (paginated) |
| `/api/contacts/:id` | GET | Get contact details |
| `/api/health` | GET | System health check |
| `/api/config/limits` | GET | Get import limits |

### Development Tools
- **Vite**: Development server and build tool
- **esbuild**: Server-side bundling for production
- **TypeScript**: Type checking across the entire codebase