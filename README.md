# Electrical Leads Engine

Internal sales intelligence tool for electrical distribution reps covering Atlanta metro and North Georgia. Pulls permit filings from county systems, monitors job postings, and enriches company profiles with AI classification to produce a scored, prioritized list of active electrical contractors. The goal is to replace cold outreach with context — knowing what a contractor is working on before you call them.

## Features

### Dashboard
- Territory map — county-level heatmap of contractor density and lead scores
- Permit signals — recent electrical permit activity by county with job values
- Top leads — highest-scoring uncontacted companies
- News feed — Georgia construction news filtered through a three-gate pipeline (blocklist → Georgia geography → construction keywords)
- Stats cards — total companies, signals this week, recent imports, companies needing enrichment, uncontacted leads above threshold

### Companies
- Filterable, sortable table — county, segment, status, lead score, website/email presence
- Lead score and active score (both 0–100) with per-rule breakdown on detail page
- Single and batch enrichment — website scraping → AI classification → rescoring
- Batch website finder — Google Custom Search locates websites for companies that don't have one
- Merge duplicates — combines two company records, reassigning all permits, signals, and contacts
- CSV import — column mapping, preview, deduplication, commit

### Company Detail
- Lead score and active score with a `reasons[]` breakdown (each triggered rule listed)
- Outreach angle — personalized sales pitch derived from detected specialties
- Likely product demand categories and sales motion (MRO / project-based / service)
- Signals timeline — chronological log of all activity (permits, job postings, website content, discovery events)
- Permit history — all linked permits with status, job value, and filed date
- Contact records with phone and email

### Permits
- Browse all ingested permits by county
- Filter by date, status, contractor, and job type
- Detail slide-over with full permit record

### Prospecting
- Google Places search — find electrical contractors by county that aren't in the DB yet
- One-click add with pre-filled data from Places API
- Sync job postings — trigger a CSE search for contractors actively hiring in target counties

### Import
- CSV import with header mapping, preview, and commit
- Deduplicates on normalized name and domain before writing

### Jobs
- Trigger discovery, enrichment, website-finder, and job-postings sync from the UI
- View full job history — source type, status, records found/created/updated, duration
- Quick action cards for common operations

## Tech Stack

- **Framework**: Next.js 15.1.7, React 19, TypeScript
- **Auth**: Clerk
- **Database**: Prisma 5 + PostgreSQL (Supabase)
- **Validation**: Zod
- **AI enrichment**: Anthropic Claude or OpenAI (configurable); falls back to keyword classifier if no API key is set
- **Permit scraping**: playwright-core (headless Chrome for Cobb and Cherokee counties)
- **Maps**: D3-geo for territory visualization
- **Testing**: Vitest

## Permit Data Sources

Each county uses a different system. Contractor data availability varies.

| County | System | Status | Contractor data |
|--------|--------|--------|-----------------|
| Gwinnett | Accela ACA — citizen portal scrape | Live | Yes |
| Atlanta / Fulton | Accela ACA — citizen portal scrape | Live | Yes |
| Cobb | Accela ACA + Playwright (login required) | Live | Yes |
| DeKalb | ArcGIS FeatureServer REST API | Live | Yes |
| Cherokee | Playwright + Cloudflare bypass | Live | Yes |
| Hall | Accela ACA — citizen portal scrape | Live | No — permits sync but contractor name absent from results |
| Forsyth | EnerGov REST API | Live | No — contractor name not returned by search endpoint |
| Jackson | EnerGov REST API | Live | No — contractor name not returned by search endpoint |

**Cobb** requires a free registered account at cobbca.cobbcounty.gov/CitizenAccess. Set `COBB_ACA_USERNAME` and `COBB_ACA_PASSWORD`.

The Accela REST API (OAuth2) is configured in code for Gwinnett, Hall, and Atlanta but is awaiting authorization by those agencies. The ACA portal scraper handles those counties in production.

## Signal Sources

**Permits** — ingested from county adapters. A `PERMIT` signal is created per permit and linked to a matched company by contractor name. Permits with no match are stored and linked when a matching company is later added.

**Job postings** — Google Custom Search queries for electricians hiring in each target county. Company names are extracted from job listing titles by splitting on separator characters and filtering generic words. Matched companies get a `JOB_POSTING` signal; unmatched names are created as stub companies (confidence 0.3) for later enrichment. Signals are deduped — one per company per 7 days. Requires `GOOGLE_CSE_API_KEY` and `GOOGLE_CSE_ENGINE_ID`.

## Getting Started

```bash
git clone https://github.com/teddygcodes/lead-generator
cd lead-generator
pnpm install
```

Copy `.env.example` to `.env.local` and fill in the required values (see table below).

```bash
pnpm db:migrate    # run Prisma migrations against your database
pnpm db:seed       # optional: load demo companies
pnpm dev           # http://localhost:3000
```

`prisma generate` runs automatically via the `postinstall` hook.

## Environment Variables

| Variable | What it's for | Required |
|----------|---------------|----------|
| `DATABASE_URL` | Supabase Postgres connection string (pgbouncer pooled URL) | Yes |
| `DIRECT_URL` | Supabase Postgres direct connection URL (used for migrations) | Yes |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key | Yes |
| `CLERK_SECRET_KEY` | Clerk secret key | Yes |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Sign-in page path | Yes |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Sign-up page path | Yes |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | Redirect after sign-in | Yes |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | Redirect after sign-up | Yes |
| `AI_PROVIDER` | `anthropic` or `openai` (default: `anthropic`) | No |
| `AI_MODEL` | Model ID for enrichment (default: `claude-3-5-sonnet-20241022`) | No |
| `ANTHROPIC_API_KEY` | Anthropic API key — without this, enrichment uses keyword fallback | No |
| `OPENAI_API_KEY` | OpenAI API key — used when `AI_PROVIDER=openai` | No |
| `ENRICHMENT_TIMEOUT_MS` | Per-page scrape timeout in ms (default: `10000`) | No |
| `ENRICHMENT_MAX_PAGES` | Max pages scraped per company (default: `4`) | No |
| `GOOGLE_CSE_API_KEY` | Google Custom Search API key (100 free queries/day) | No |
| `GOOGLE_CSE_ENGINE_ID` | Programmable Search Engine ID | No |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New) — prospecting search and enrichment fallback for companies without a website (server-side only) | No |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Maps JavaScript API — territory map rendering and address geocoding fallback (exposed to browser) | No |
| `OPENCORPORATES_API_KEY` | OpenCorporates API — business registry verification; falls back to demo fixture data if absent | No |
| `COBB_ACA_USERNAME` | Cobb County citizen portal login email | No |
| `COBB_ACA_PASSWORD` | Cobb County citizen portal password | No |
| `PERMIT_BATCH_SIZE` | Records per permit API page (default: `100`) | No |
| `PERMIT_LOOKBACK_DAYS` | Days back to pull permits (default: `90`) | No |
| `ACCELA_APP_ID` | Accela OAuth app ID (not active — awaiting agency authorization) | No |
| `ACCELA_APP_SECRET` | Accela OAuth app secret (not active) | No |
| `ACCELA_ENVIRONMENT` | `PROD` or `TEST` for Accela REST API | No |

## Project Structure

```
app/
  (protected)/          # auth-gated pages (dashboard, companies, jobs, import, permits, prospecting)
  api/                  # route handlers
    companies/          # CRUD, merge, batch-delete, find-websites
    enrich/             # single and batch enrichment
    import/csv/         # preview and commit
    jobs/               # list and trigger
    signals/            # job-postings sync
    permits/            # permit data endpoints
    dashboard/          # dashboard metrics
    health/             # public health check (no auth)

components/
  companies/            # table, filter bar, enrichment buttons, website editor
  dashboard/            # territory map, permit signals, top leads, news feed, county panel
  import/               # CSV import flow
  jobs/                 # job control panel, history list
  layout/               # sidebar, nav link
  permits/              # permit browser, detail slide-over
  prospecting/          # Google Places search view, county map

lib/
  ai/                   # provider-agnostic enrichment (Anthropic / OpenAI)
  enrichment/           # website scraper, keyword classifier, pipeline orchestrator
  jobs/                 # job runner, permit sync, permit value estimation
  normalization/        # name, domain, phone, address normalization; city→county lookup
  permits/              # per-county adapters: accela, accela-aca, cobb, dekalb, cherokee, energov
  scoring/              # scoreCompany() and centralized weight config
  signals/              # job postings CSE fetcher and sync orchestrator
  sources/              # SourceAdapter implementations: website, places, registry, permits
  validation/           # all Zod schemas
  dedupe/               # findExistingCompany(), mergeCompanyData()

prisma/
  schema.prisma         # models: Company, Signal, Contact, CrawlJob, UserNote, Tag, Permit
  seed.ts               # demo data seeder

scripts/                # diagnostics and dev-only job runners
```

## Utility Scripts

Run with `pnpm tsx scripts/<name>.ts`.

| Script | What it does |
|--------|--------------|
| `test-job-postings.ts` | Calls CSE API, prints extracted company names, reports name extraction rate |
| `test-cobb.ts` | Runs Cobb ACA adapter end-to-end, logs per-page row counts and sample permits |
| `test-cherokee.ts` | Runs Cherokee adapter, logs normalized results |
| `test-dekalb.ts` | Hits DeKalb ArcGIS API, logs normalized permit sample |
| `test-energov.ts` | Hits Forsyth and Jackson EnerGov APIs, verifies field mapping |
| `test-accela.ts` | Tests Atlanta Accela REST adapter |
| `test-accela-aca.ts` | Tests Accela ACA portal scraper |
| `test-hallco-90d.ts` | Tests Hall County 90-day lookback via ACA |
| `run-business-registry.ts` | Triggers BUSINESS_REGISTRY job directly, bypassing HTTP auth |
| `run-company-discovery.ts` | Triggers COMPANY_DISCOVERY job directly |
| `run-company-website.ts` | Triggers COMPANY_WEBSITE enrichment job directly |
| `run-permit.ts` | Triggers PERMIT sync job directly |
| `backfill-county-from-city.ts` | Backfills missing county values using the city→county lookup table |
| `db-snapshot.ts` | Captures a DB snapshot for debugging |
