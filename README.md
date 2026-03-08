# Electrical Leads Engine

Internal sales intelligence tool for Atlanta metro and North Georgia electrical contractor leads. Login-protected. Built for distribution reps.

---

## Setup

### Prerequisites
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- PostgreSQL database (Supabase recommended)
- Clerk account

### Install

```bash
pnpm install
```

### Environment

Copy `.env.example` to `.env.local` and fill in all values:

```bash
cp .env.example .env.local
```

Required environment variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string (pooled via pgbouncer for Supabase) |
| `DIRECT_URL` | Direct Postgres connection (used by Prisma migrations) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-in` |
| `AI_PROVIDER` | `anthropic` or `openai` |
| `AI_MODEL` | Model ID (e.g., `claude-3-5-sonnet-20241022`) |
| `ANTHROPIC_API_KEY` | Anthropic API key (if using Anthropic) |
| `OPENAI_API_KEY` | OpenAI API key (if using OpenAI) |
| `ENRICHMENT_TIMEOUT_MS` | Website fetch timeout in ms (default: 8000) |

### Database

```bash
# Run migrations
pnpm db:migrate

# Generate Prisma client
pnpm db:generate

# Seed with demo data (24 companies across 6 counties)
pnpm db:seed
```

### Run locally

```bash
pnpm dev
```

App runs at `http://localhost:3000`. Sign in via Clerk. All routes except `/sign-in` and `/api/health` require auth.

---

## Architecture

```
app/                        Next.js App Router
  (protected)/              Auth-gated routes
    dashboard/              Summary: companies, signals, recent jobs
    companies/              Filterable, sortable company table
    companies/[id]/         Company detail with score + signals
    jobs/                   CrawlJob operational log
    import/                 CSV import flow
  api/                      API routes
    companies/              GET list, GET/PATCH by ID
    jobs/                   GET crawl job list
    import/csv/preview/     POST — parse CSV, no DB write
    import/csv/commit/      POST — validate + persist CSV
    enrich/company/[id]/    POST — enrich one company
    enrich/batch/           POST — enrich batch (≤10)
    health/                 GET — public health check

lib/
  normalization/            Name, domain, phone, address normalization
  dedupe/                   Company deduplication: domain → name → phone
  scoring/                  Lead + active score with transparent reasons
    config.ts               All weights and thresholds (single source of truth)
  enrichment/
    index.ts                Website fetch + extraction service
    keywords.ts             Non-AI keyword classifier (segment + specialties)
  ai/                       Provider-agnostic AI wrapper (raw fetch, no SDK)
  sources/
    base.ts                 SourceAdapter TypeScript interface
    company-site.ts         Company website adapter
    permits.ts              Permit adapter (DEMO MODE — see below)
    licenses.ts             License adapter (DEMO MODE — see below)
  jobs/runner.ts            Job runner: invokes adapters, records CrawlJob
  validation/schemas.ts     Centralized zod schemas (never inline per route)
  pagination.ts             Consistent pagination response builder
  format.ts                 Date/duration/phone formatting utilities
  db.ts                     Prisma client singleton

components/
  layout/                   Sidebar, NavLink
  ui/                       Badge, EmptyState
  companies/                FilterBar, CompaniesTable, EnrichButton
  import/                   ImportFlow (staged CSV import)

prisma/
  schema.prisma             Full schema: Company, Signal, Contact, CrawlJob, Tag
  seed.ts                   24+ demo companies with signals and contacts
```

---

## Commands

```bash
pnpm dev          # Start development server
pnpm build        # Production build
pnpm lint         # ESLint
pnpm test         # Run unit tests (vitest)
pnpm db:migrate   # Run Prisma migrations
pnpm db:generate  # Regenerate Prisma client
pnpm db:seed      # Seed demo data
pnpm db:studio    # Prisma Studio (GUI)
```

---

## Deferred work (honest status)

### Permit adapter (`lib/sources/permits.ts`)
**Status: Demo stub — returns fixture data only.**
To connect a live source, you need one of:
- Georgia SOS permit portal API (no public REST API exists as of build date; scraping or bulk data required)
- County-level permit APIs (Gwinnett, Hall, Cobb, Forsyth, Fulton, Cherokee all have separate portals with varying data access)
- Third-party aggregator (BuildingConnected, ConstructConnect, Dodge Data)

### License adapter (`lib/sources/licenses.ts`)
**Status: Demo stub — returns fixture data only.**
To connect a live source, you need one of:
- Georgia SOS Licensing Division data (EC license lookup at https://sos.ga.gov/index.php/licensing)
- Bulk license data purchase from state
- Third-party license aggregator

### AI enrichment (`lib/ai/index.ts`)
**Status: Implemented but requires live API key to produce real output.**
Without a valid `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, the AI enrichment falls back to the keyword classifier. Set the appropriate key in `.env.local` to activate AI enrichment.

### Website enrichment concurrency
**Status: Bounded at one active run per company.**
Multi-company concurrent enrichment is sequential in batch mode (max 10 per call). No distributed job queue implemented.

### Tests
Unit tests cover: normalization, dedupe merge logic, scoring (5 profiles), keyword classifier (4 text types), API schema validation.
Integration tests with real DB are not implemented. The import flow and enrichment routes are tested manually.

---

## API contract

All business routes require authentication (Clerk session cookie). All errors return `{ error: string, details?: any }`.

### Companies
- `GET /api/companies` → `{ data, total, page, limit, totalPages }` — params: search, county, segment, status, minScore, hasWebsite, hasEmail, sort, order, page, limit
- `GET /api/companies/:id` → full company + scoreDetails
- `PATCH /api/companies/:id` → editable fields only: `status`, `doNotContact`, `notes`

### Jobs
- `GET /api/jobs` → paginated CrawlJob records, newest first

### Import
- `POST /api/import/csv/preview` → parses CSV, returns `{ headers, rows (25), rowCount, suggestedMapping }` — **no DB write**
- `POST /api/import/csv/commit` → `{ created, updated, skipped, invalid, errors[] }`

### Enrichment
- `POST /api/enrich/company/:id` → enriches one company, returns updated score
- `POST /api/enrich/batch` → body: `{ companyIds: string[], limit?: number }` — max 10

### Health
- `GET /api/health` → `{ status: "ok", db: "connected" }` — public, no auth required
