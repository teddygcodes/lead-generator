# Electrical Leads Engine

An internal sales intelligence tool for electrical distribution reps covering Atlanta metro and North Georgia. It aggregates electrical contractor data from public permit portals and Google Places, scores each company by geography, segment fit, and permit activity, and presents it as a searchable, filterable lead database. The difference from a spreadsheet or generic CRM is that data is actively pulled from live permit systems, enriched via website scraping and AI, and scored with transparent reasons — so a rep can open the dashboard and immediately know which contractors are working, where, and how to open the conversation.

---

## Features

### Dashboard
- Five summary cards: total companies, signals this week, CSV imports this week, uncontacted companies with lead score ≥ 60, companies not yet enriched
- Territory map: D3-geo SVG of North Georgia/Atlanta metro counties color-coded by lead density, clickable to filter
- Permit signals: recent permits matched to companies, with status and job value
- Top leads: highest-scoring un-contacted companies
- Construction news feed: Georgia construction articles pulled from Google News RSS, filtered through a three-gate relevance check (blocklist, Georgia location match, construction keyword match), deduped and sorted by date

### Companies
- Paginated, sortable table of all contractor records (real data only by default; toggle to include demo seed data)
- Filter by: free-text search, county, segment, status (NEW / QUALIFYING / ACTIVE / INACTIVE / DO\_NOT\_CONTACT), minimum lead score, has website, has email
- Find Websites: bulk Google CSE lookup to populate missing website URLs (100 free queries/day)
- Enrich All: batch website enrichment for up to 10 companies at once

### Company detail
- Lead score (0–100) and active score with a plain-English `reasons[]` list explaining every rule that fired
- AI-generated outreach angle, likely product demand categories, estimated sales motion, and buyer value tier
- Editable website URL
- Segments (industrial / commercial / residential / mixed) and specialties extracted by AI or keyword classifier
- AI summary (2–3 sentences from website content)
- Signals timeline (permit activity, website enrichment, discovery events)
- Contacts list with phone and email
- Permits list linked to this company (number, type, status, address, filed date)
- Enrich button triggers single-company website crawl

### Permits
- Per-county permit browser: Gwinnett, Hall, Fulton, DeKalb, Cherokee
- Sync per county (triggers the full ingest → dedupe → upsert → match → rescore pipeline)
- Rematch: re-run company matching for a county using the current algorithm (useful after algorithm fixes)
- Stats: permit count, last synced, newest permit date per county

### Prospecting
- Split-pane view: clickable county map on the left, search results on the right
- Google Places Text Search for free-text or preset queries (e.g. "Electricians Gwinnett County GA")
- Preset queries update when you click a county on the map
- Each result shows phone, address, rating, website, and whether it's already in the database
- Add individual companies or "Add All New" in bulk

### Import
- Upload a CSV file, preview parsed rows, map columns, then commit
- Validated against Zod schemas before any DB write
- Recognized columns: `name`, `website`, `phone`, `email`, `city`, `county`, `state`, `zip`, `street`, `segments`, `specialties`

### Jobs
- Manual trigger panel for: Company Discovery, Website Enrichment, Business Registry
- Displays last run time and record counts for each source
- Full CrawlJob history table (status, records found/created/updated, error messages)

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 App Router, TypeScript |
| Styling | Tailwind CSS v3 |
| Auth | Clerk v6 |
| ORM | Prisma v5 |
| Database | PostgreSQL (Supabase) |
| Validation | Zod |
| Testing | Vitest |
| Package manager | pnpm |
| Maps | D3-geo (SVG, no tile service) |
| HTML scraping | node-html-parser |
| CSV parsing | csv-parse |
| News | rss-parser |
| Icons | lucide-react |

---

## Data sources

### Permit adapters

| County | Adapter | Status | Contractor name available |
|---|---|---|---|
| Gwinnett | ACA citizen portal scraper (`accela-aca.ts`) | Active | Yes |
| Hall | ACA citizen portal scraper (`accela-aca.ts`) | Active | Yes (assigned at permit issuance) |
| Fulton / Atlanta | ACA citizen portal scraper (`accela-aca.ts`) | Active | Yes |
| DeKalb | ArcGIS FeatureServer REST API (`dekalb.ts`) | Active | Yes |
| Cherokee | PHP portal HTML scraper (`cherokee.ts`) | Active | Yes |
| Gwinnett / Hall / Fulton | Accela REST API (`accela.ts`) | Inactive — app registered, county authorization not yet granted | Would be yes |
| Cobb | — | No adapter — Cobb County not found in Accela developer system | — |
| Forsyth / Jackson | EnerGov REST API | Removed — search results do not include contractor names, so permits cannot be matched to companies | No |

The ACA scraper works against the public ASP.NET WebForms portal at `aca-prod.accela.com`. It manages session cookies and VIEWSTATE automatically, paginates through all result pages, and fetches each permit's detail page to extract the contractor business name, phone, and license number. No API key required.

The Accela REST API adapter (`accela.ts`) is fully implemented with OAuth2 client\_credentials auth but returns empty results because each county must separately authorize the developer app in their Accela admin portal. Once a county grants access, it activates automatically — no code changes needed.

### Google Places
Used for:
- **Prospecting** (`/api/places/search`): Text Search to discover new contractors by category + location
- **Company enrichment fallback** (`/api/places/check`, `/api/places/add`): profile lookup for companies without a website

Requires `GOOGLE_PLACES_API_KEY` with the "Places API (New)" enabled in Google Cloud Console.

### Google Custom Search (website finder)
Used to locate a company's website when the record has no URL. Tries up to three query variations; filters out directory sites (Yelp, YellowPages, BBB, etc.). Free tier: 100 queries/day.

Requires `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ENGINE_ID`.

### AI enrichment
Calls the configured provider (Anthropic or OpenAI) with extracted website text and a structured prompt. Returns segment classification, specialties, service areas, employee size estimate, a summary, buyer profile, confidence score, and an outreach angle. Output is validated with Zod. Falls back to a keyword classifier if the API key is absent or the call fails.

Default provider: Anthropic (`claude-3-5-sonnet-20241022`).

### Construction news feed
Fetches Google News RSS for eight Georgia construction queries on each dashboard load. Applies a three-gate filter: hard blocklist (obituaries, sports, crime), Georgia location check, construction keyword check. Dedupes by normalized title and returns the 15 most recent articles. Cached by Next.js revalidation.

---

## Getting started

### Prerequisites

- Node.js 18+
- pnpm (`npm install -g pnpm`)
- A [Supabase](https://supabase.com) project (free tier works)
- A [Clerk](https://clerk.com) application (free tier works)

### 1. Clone and install

```bash
git clone <repo-url>
cd lead-generator
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials. See the env vars table below.

### 3. Migrate and seed

```bash
pnpm db:migrate   # Apply schema
pnpm db:seed      # Load demo companies (optional)
```

### 4. Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in via Clerk. You'll land on the dashboard.

---

## Environment variables

| Variable | What it's for | Required |
|---|---|---|
| `DATABASE_URL` | Supabase Postgres connection string with pgbouncer (pooled) | Yes |
| `DIRECT_URL` | Supabase Postgres direct connection string (used by Prisma migrations) | Yes |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key | Yes |
| `CLERK_SECRET_KEY` | Clerk secret key | Yes |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Clerk sign-in route (default: `/sign-in`) | Yes |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Clerk sign-up route (default: `/sign-in`) | Yes |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | Redirect after sign-in (default: `/dashboard`) | Yes |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | Redirect after sign-up (default: `/dashboard`) | Yes |
| `AI_PROVIDER` | AI provider: `anthropic` (default) or `openai` | No |
| `AI_MODEL` | Model ID (default: `claude-3-5-sonnet-20241022`) | No |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI enrichment | No — falls back to keyword classifier |
| `OPENAI_API_KEY` | OpenAI API key (used when `AI_PROVIDER=openai`) | No |
| `ENRICHMENT_TIMEOUT_MS` | Per-page fetch timeout in ms (default: `10000`) | No |
| `ENRICHMENT_MAX_PAGES` | Max pages to crawl per company (default: `4`) | No |
| `GOOGLE_CSE_API_KEY` | Google Custom Search JSON API key (website finder) | No — feature disabled without it |
| `GOOGLE_CSE_ENGINE_ID` | Programmable Search Engine ID (website finder) | No — feature disabled without it |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New) key (prospecting + enrichment fallback) | No — Prospecting page disabled without it |
| `OPENCORPORATES_API_KEY` | OpenCorporates API key (business registry adapter) | No — adapter returns nothing without it |
| `ACCELA_APP_ID` | Accela developer app ID (REST API permit adapter) | No — adapter returns [] without it or without county authorization |
| `ACCELA_APP_SECRET` | Accela developer app secret | No |
| `PERMIT_BATCH_SIZE` | ArcGIS result record count per page (default: `100`, max: `1000`) | No |
| `PERMIT_LOOKBACK_DAYS` | Days back for permit queries (default: `90`) | No |

---

## Project structure

```
app/
  (protected)/              Auth-gated pages (Clerk middleware)
    dashboard/              Stats, territory map, permit signals, top leads, news feed
    companies/              Filterable contractor table
    companies/[id]/         Company detail: score, signals, contacts, permits
    permits/                Per-county permit browser with sync and rematch
    prospecting/            Google Places discovery with county map
    import/                 Staged CSV import
    jobs/                   Job control panel and history
    settings/               Placeholder (no functionality yet)
  api/
    companies/              GET list, POST (internal), GET/PATCH/DELETE by id
    companies/find-websites POST — bulk Google CSE website lookup
    companies/merge         POST — merge two company records
    companies/batch-delete  POST — delete multiple companies
    enrich/company/[id]     POST — single-company website enrichment
    enrich/batch            POST — batch enrichment (max 10)
    import/csv/preview      POST — parse CSV, return preview (no DB write)
    import/csv/commit       POST — validate and persist CSV rows
    permits/list            GET — paginated permit list with filters
    permits/sync            POST — trigger permit ingest for one or all counties
    permits/bulk-sync       POST — sync all counties in sequence
    permits/rematch         POST — re-run company matching for a county
    permits/signals         GET — recent permits with matched company data (dashboard widget)
    permits/stats           GET — per-county permit counts and last-sync timestamps
    permits/[id]            GET — single permit detail
    places/search           GET — Google Places Text Search
    places/check            GET — check which places are already in the DB
    places/add              POST — add Places results to the DB
    jobs/                   GET — CrawlJob history
    jobs/run                POST — trigger a job manually
    dashboard/top-leads     GET — top uncontacted companies
    dashboard/news          GET — Georgia construction news (RSS)
    dashboard/map-data      GET — county-level stats for territory map
    dashboard/county/[c]    GET — company list for a specific county
    dashboard/company/[id]/contact  GET — company contact info
    rescore                 POST — recompute scores for all or selected companies
    health                  GET — public health check

lib/
  scoring/
    config.ts               All score weights (single source of truth)
    index.ts                scoreCompany() — returns leadScore, activeScore, reasons[], outreachAngle
  enrichment/
    index.ts                enrichFromWebsite(), enrichCompany() — crawls up to 4 pages, respects robots.txt
    keywords.ts             classifyText() — keyword-based segment/specialty classifier (AI fallback)
    pipeline.ts             runFullEnrichment() — orchestrates website + AI enrichment
  ai/
    index.ts                enrichWithAI() — provider-agnostic wrapper, Zod-validated output
  permits/
    base.ts                 NormalizedPermit type, normalizeStatus(), isResidential()
    accela.ts               Accela REST API adapter (inactive — pending county auth)
    accela-aca.ts           ACA citizen portal scraper — Gwinnett, Hall, Fulton
    dekalb.ts               DeKalb County ArcGIS FeatureServer adapter
    cherokee.ts             Cherokee County PHP portal scraper
    energov.ts              EnerGov adapter (implemented but not in active sources)
  jobs/
    sync-permits.ts         Full permit pipeline: fetch → dedupe → upsert → match → rescore
    runner.ts               Job runner for company discovery and enrichment jobs
    estimate-permit-value.ts  Estimates job value bucket from permit description text
  sources/
    company-site.ts         Company website enrichment adapter
    google-places.ts        Google Places API (New) adapter
    website-finder.ts       Google Custom Search website finder
    business-registry.ts    OpenCorporates business registry adapter
    company-discovery.ts    Company discovery source
    base.ts                 SourceAdapter interface
  normalization/
    index.ts                normalizeName(), normalizeDomain(), normalizePhone()
    geocode-county.ts       City → county inference for Georgia
    georgia-cities.ts       Georgia city/county lookup table
  dedupe/
    index.ts                findExistingCompany() — domain → normalized name → phone
  companies/
    merge.ts                mergeCompanyData() — combine two company records
  validation/
    schemas.ts              All Zod schemas (CompanyFiltersSchema, ImportRowSchema, etc.)
  pagination.ts             buildPaginatedResponse()
  format.ts                 formatDate(), formatPhone()
  db.ts                     Prisma client singleton

components/
  layout/                   Sidebar, NavLink
  ui/                       Badge, EmptyState
  companies/                CompaniesTable, FilterBar, EnrichButton, EnrichAllButton,
                            FindWebsitesButton, WebsiteEditor
  dashboard/                TerritoryMap, PermitSignals, TopLeads, NewsFeed, CountyPanel
  permits/                  PermitsBrowser, PermitSlideOver
  prospecting/              ProspectingView, CountyMap
  import/                   ImportFlow
  jobs/                     JobControlPanel, JobHistoryList

prisma/
  schema.prisma             Company, Signal, Contact, CrawlJob, UserNote, Tag, CompanyTag, Permit
```

---

## Scoring

Every company gets two scores:

**Lead score (0–100):** long-term sales potential. Inputs:
- Geography: +15 if in a primary target county (Gwinnett, Hall, Forsyth, Cobb, Fulton, Cherokee), +5 if in Georgia
- Segment: +20 industrial, +15 commercial-only, +10 mixed non-industrial, +5 residential
- Specialties: high-value keywords (switchgear, panelboards, controls, generators, EV charging, industrial maintenance) earn 6 pts each, capped at 15; standard keywords earn 2 pts each, capped at 6
- Completeness: website (+5), email (+5), phone (+3), street address (+2)
- Signals: each signal adds 1 pt to lead score, capped at 5
- Contacts: +5 if any contact, +5 if contact has email, +3 if contact has phone
- Description language: industrial terms +4, commercial terms +4
- Permit signal score: up to 25 pts based on permit volume and job value in the last 30 days
- AI confidence: +3 if confidence ≥ 0.75, +1 if ≥ 0.50

**Active score:** current engagement based on signal recency (within 30/90/180 days) and volume.

Every score includes a `reasons[]` array — a plain-English list of which rules contributed. The company detail page displays this alongside an AI-generated outreach angle.

Weights are centralized in `lib/scoring/config.ts`.

---

## Commands

```bash
pnpm dev          # Development server (Next.js)
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # ESLint
pnpm test         # Vitest unit tests
pnpm test:watch   # Vitest in watch mode
pnpm db:migrate   # Run Prisma migrations
pnpm db:generate  # Regenerate Prisma client after schema changes
pnpm db:seed      # Seed demo companies
pnpm db:studio    # Open Prisma Studio
```

---

## Known gaps

- **Cobb County permits:** No working adapter. Cobb is not registered in the Accela developer system under any known agency name variation.
- **Forsyth / Jackson permits:** EnerGov REST API is accessible but doesn't return contractor names in search results, so permits can't be matched to companies. Not in active sources.
- **Accela REST API (Gwinnett / Hall / Fulton):** Fully implemented. Returns empty results until each county authorizes the developer app in their Accela admin portal — no code changes needed on this side.
- **Notes and tags on company detail:** Schema and models exist; the UI shows a "coming later" placeholder.
- **Settings page:** Placeholder only. No configuration is persisted through it.
- **Job queue:** Enrichment runs sequentially on demand. No background worker or distributed queue.
- **Integration tests:** Unit tests cover scoring, normalization, dedupe, keyword classification, and API schema validation. No tests against a live database.
