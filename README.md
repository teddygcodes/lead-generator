# Electrical Leads Engine

> Internal sales intelligence tool for Atlanta metro and North Georgia electrical contractor leads.

Built for electrical distribution reps who need to know which contractors are active, what they're working on, and who to call next. Login-protected. Data stays yours.

---

## What it does

- **Company database** — stores electrical contractor records with scoring, segments, and contact info
- **Lead scoring** — transparent scores with mapped reasons (geography, segment fit, signals, contacts)
- **CSV import** — staged import flow: parse → preview → map → validate → commit
- **Website enrichment** — fetches contractor websites, extracts emails/phones/service keywords
- **AI enrichment** — Anthropic or OpenAI wrapper with structured output validation and keyword fallback
- **Signal tracking** — permit activity, license data, website signals all feed into scores
- **Jobs log** — full visibility into crawl history, errors, and source run status

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 App Router + TypeScript |
| Styling | Tailwind CSS v3 |
| Auth | Clerk v6 |
| ORM | Prisma v5 |
| Database | PostgreSQL (Supabase) |
| Validation | zod |
| Testing | vitest |
| Package manager | pnpm |

---

## Getting started

### Prerequisites

- Node.js 18+
- pnpm — `npm install -g pnpm`
- [Supabase](https://supabase.com) project (free tier works)
- [Clerk](https://clerk.com) application (free tier works)

### 1. Clone and install

```bash
git clone https://github.com/teddygcodes/lead-generator.git
cd lead-generator
pnpm install
```

### 2. Set up environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (pooled) |
| `DIRECT_URL` | Supabase → Project Settings → Database → Connection string (direct) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard → API Keys |
| `CLERK_SECRET_KEY` | Clerk Dashboard → API Keys |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) (optional — falls back to keyword classifier) |

### 3. Migrate and seed

```bash
pnpm db:migrate   # Apply schema to your database
pnpm db:seed      # Load 24 demo companies across 6 counties
```

### 4. Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in via Clerk. You'll land on the dashboard.

---

## Commands

```bash
pnpm dev          # Development server
pnpm build        # Production build
pnpm lint         # ESLint
pnpm test         # Unit tests (91 passing)
pnpm db:migrate   # Run Prisma migrations
pnpm db:generate  # Regenerate Prisma client
pnpm db:seed      # Seed demo data
pnpm db:studio    # Prisma Studio (database GUI)
```

---

## Project structure

```
app/
  (protected)/          Auth-gated pages
    dashboard/          Summary stats, recent signals, job log
    companies/          Filterable, sortable contractor table
    companies/[id]/     Detail: identity, score, reasons, signals, contacts
    jobs/               CrawlJob operational log
    import/             Staged CSV import flow
  api/
    companies/          GET list + filters, GET/PATCH by ID
    jobs/               GET paginated job history
    import/csv/         POST preview (no DB write), POST commit
    enrich/             POST single company, POST batch (≤10)
    health/             GET public health check

lib/
  normalization/        Name, domain, phone, address normalization
  dedupe/               Dedup strategy: domain → normalized name → phone
  scoring/              Lead score + active score with transparent reasons[]
    config.ts           All weights in one place (single source of truth)
  enrichment/
    index.ts            Website fetch + HTML extraction (same-domain, 4 pages max)
    keywords.ts         Keyword classifier — works without AI
  ai/                   Provider-agnostic wrapper (raw fetch, zod-validated output)
  sources/
    base.ts             SourceAdapter interface
    company-site.ts     Website enrichment adapter
    permits.ts          Permit adapter (demo mode — see below)
    licenses.ts         License adapter (demo mode — see below)
  jobs/runner.ts        Job runner: invokes adapters, records CrawlJob
  validation/schemas.ts Centralized zod schemas (never inline)

components/
  layout/               Sidebar, NavLink
  ui/                   Badge, EmptyState
  companies/            FilterBar, CompaniesTable, EnrichButton
  import/               ImportFlow (5-stage CSV import)

prisma/
  schema.prisma         Company, Signal, Contact, CrawlJob, UserNote, Tag
  seed.ts               24 demo companies across Gwinnett, Hall, Forsyth, Cobb, Fulton, Cherokee
```

---

## Adding real contractor data

**CSV import** is the fastest path. Go to `/import` and upload any `.csv` with at minimum a `name` column. Recognized headers: `name`, `website`, `phone`, `email`, `city`, `county`, `state`, `zip`, `segments`, `specialties`, `street`.

Free data sources for Georgia electrical contractors:
- [Georgia Secretary of State — Business Search](https://ecorp.sos.ga.gov)
- [Georgia Secretary of State — License Lookup](https://sos.ga.gov/index.php/licensing)
- Your existing spreadsheet or CRM export

After import, use `/api/enrich/batch` or the Enrich button on individual company pages to pull data from their websites.

---

## Scoring

Every company gets two scores:

- **Lead score** — long-term potential based on geography, segment fit, and specialties
- **Active score** — current engagement based on recent signals, website presence, and contact availability

Both scores come with `reasons[]` — a plain-English list of exactly which rules fired. No black boxes.

Score weights live in `lib/scoring/config.ts` — edit them to match your territory priorities.

---

## Deferred work

### Permit adapter
**Status: Demo stub.** Returns fixture data. To connect live permits you need:
- County-level permit portal APIs (Gwinnett, Hall, Cobb, Forsyth, Fulton, Cherokee each have separate portals)
- Or a third-party aggregator: BuildingConnected, ConstructConnect, Dodge Data

### License adapter
**Status: Demo stub.** Returns fixture data. To connect live license data:
- Georgia SOS Licensing Division bulk data or scrape of [sos.ga.gov/licensing](https://sos.ga.gov/index.php/licensing)

### Integration tests
Unit tests cover normalization, dedupe, scoring, keywords, and API schema validation (91 tests). Integration tests with a live DB are not implemented.

### Job queue
Enrichment runs are sequential. No distributed queue or background workers — suitable for manual/on-demand enrichment at current scale.

---

## API reference

All business routes require a valid Clerk session. Errors return `{ error: string, details?: any }`.

| Method | Route | Description |
|---|---|---|
| GET | `/api/companies` | List with filters: `search`, `county`, `segment`, `status`, `minScore`, `hasWebsite`, `hasEmail`, `sort`, `page`, `limit` |
| GET | `/api/companies/:id` | Full company detail + score breakdown |
| PATCH | `/api/companies/:id` | Update `status`, `doNotContact`, `notes` only |
| GET | `/api/jobs` | Paginated CrawlJob history, newest first |
| POST | `/api/import/csv/preview` | Parse CSV → return preview (no DB write) |
| POST | `/api/import/csv/commit` | Validate + persist → `{ created, updated, skipped, invalid, errors[] }` |
| POST | `/api/enrich/company/:id` | Enrich one company from its website |
| POST | `/api/enrich/batch` | Enrich batch: `{ companyIds[], limit? }` — max 10 |
| GET | `/api/health` | Public health check → `{ status: "ok", db: "connected" }` |

---

## License

Apache 2.0 — see [LICENSE](./LICENSE)
