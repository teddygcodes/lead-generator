# ELECTRICAL LEADS ENGINE — Build Checklist

## Checkbox integrity rule
A checkbox may only be marked complete if:
- The code exists and runs without known blocking errors
- The route/page renders or the function executes
- The flow is not scaffolded or placeholder-only
- Related tests pass, if tests exist for that item

Marking incomplete work as done is not permitted.

---

## Mandatory stack
- Next.js App Router
- TypeScript
- Tailwind CSS
- Clerk (auth)
- Prisma (ORM)
- PostgreSQL via Supabase
- zod (validation)
- pnpm (package manager)

Do not add libraries outside this list without a clear reason. See Dependency Discipline.

---

## Dependency discipline
- [x] No unnecessary UI/component/state libraries added
- [x] Prefer native Next.js + Tailwind + small utilities
- [x] Non-obvious dependencies documented in README or a short `docs/dependencies.md` note
- [x] No heavy table frameworks unless needed for real functionality

---

## Phase 1 — Foundation

### Project structure
- [x] Next.js App Router project initialized with TypeScript and pnpm
- [x] Tailwind configured and rendering correctly
- [x] `.env.example` committed with all required var names
- [x] `.env.local` documented in README (not committed)
- [x] ESLint + Prettier configured

### Auth (Clerk)
- [x] Clerk dependency installed
- [x] Clerk provider wired in root layout
- [x] Sign-in page exists at `/sign-in`
- [x] Protected route group `(protected)` exists
- [x] Unauthenticated users are redirected to sign-in
- [x] Authenticated user is readable server-side in at least one route

### Database (Prisma + Supabase Postgres)
- [x] Prisma installed and `schema.prisma` configured
- [x] `DATABASE_URL` env var wired
- [x] Initial migration runs successfully (`pnpm prisma migrate dev`)
- [x] Prisma client generates without error

### Seed
- [x] `prisma/seed.ts` exists
- [x] `pnpm db:seed` (or equivalent) runs without error
- [x] Seed meets the seed data quality standard below

### App shell
- [x] Root protected layout renders
- [x] Navigation renders with links: Dashboard, Companies, Jobs, Import
- [x] Active nav state is visually clear
- [x] Layout is usable at 1280px minimum width

---

## Phase 2 — Data + core logic

### Company model
- [x] Includes every required field: id, createdAt, updatedAt, name, normalizedName, website, domain, phone, email, street, city, state, zip, county, region, territory, description, serviceAreas, segments, specialties, employeeSizeEstimate, sourceConfidence, activeScore, leadScore, status, doNotContact, notes, lastSeenAt, lastEnrichedAt
- [x] Indexes added for `normalizedName` and `domain`
- [x] Unique constraints used only where collision risk is acceptable and intentional (domain may be unique; normalizedName should not be — different companies can share normalized names)
- [x] Relations to Signal, Contact, UserNote, CompanyTag compile cleanly
- [x] Prisma client generates successfully after schema update

### Signal model
- [x] Includes every required field: id, createdAt, updatedAt, companyId, sourceType, sourceName, sourceUrl, title, snippet, rawText, signalType, signalDate, county, city, metadata, relevanceScore
- [x] Relation to Company compiles cleanly

### Contact model
- [x] Includes every required field: id, createdAt, updatedAt, companyId, name, title, email, phone, linkedinUrl, source, confidenceScore, manualOnly
- [x] Relation to Company compiles cleanly

### CrawlJob model
- [x] Includes every required field: id, createdAt, updatedAt, sourceType, status, startedAt, finishedAt, recordsFound, recordsCreated, recordsUpdated, errorMessage, metadata

### UserNote model
- [x] Includes every required field: id, createdAt, updatedAt, companyId, authorUserId, body
- [x] Relation to Company compiles cleanly

### Tag model
- [x] Includes: id, createdAt, updatedAt, name, color

### CompanyTag join table
- [x] Joins Company ↔ Tag
- [x] Compiles and migrates cleanly

### Full schema
- [x] All models in one `schema.prisma` file
- [x] Migration runs cleanly on final schema

### Normalization utilities (`/lib/normalization`)
- [x] Normalizes company name (trim, lowercase, strip common legal suffixes)
- [x] Normalizes domain (strip protocol, www, trailing slash)
- [x] Normalizes phone (standard 10-digit or E.164)
- [x] Normalizes address fields (trim, consistent casing)
- [x] Unit tests cover: name normalization, domain normalization, phone normalization, edge cases

### Dedupe utilities (`/lib/dedupe`)
- [x] Checks domain first, then normalized name, then phone
- [x] Returns existing record ID when match found
- [x] Does not overwrite non-empty fields with empty values on match
- [x] Unit tests cover: domain match, name match, phone match, no match

### Scoring service (`/lib/scoring`)
- [x] All score rules and weights centralized in one config module
- [x] `leadScore` and `activeScore` computed separately
- [x] Score output includes: `leadScore`, `activeScore`, `reasons[]`
- [x] Each reason string maps to a specific triggered rule — no vague/generic reasons
- [x] Also derives: `likelyProductDemandCategories[]`, `likelySalesMotion`, `likelyBuyerValue`, `outreachAngle`
- [x] Score factors include: geography fit, segment fit, website completeness, project/service signals, industrial/commercial language, recency, multiple validating signals, contact availability
- [x] Unit tests cover at least 5 representative profiles:
  - Industrial-only company (high industrial score, no residential signals)
  - Residential-only company (low industrial score)
  - Commercial mixed company (moderate mixed score)
  - Company with no signals (low active score)
  - Company with high signal count (high active score)

---

## Phase 3 — Main app surfaces

### Dashboard page (`/dashboard`)
- [x] Page route exists and renders without error
- [x] Shows dense summary row: total companies, signals this week, recent import count
- [x] Shows recent jobs panel: last 5 CrawlJob records
- [x] Shows recent signals panel: last 10 signals
- [x] No filler charts unless backed by real data
- [x] Useful empty state when no data exists

### Companies page (`/companies`)
- [x] Page route exists and renders seeded company data
- [x] Server-side search by company name and domain
- [x] Server-side county filter
- [x] Server-side segment filter
- [x] Server-side status filter
- [x] Server-side minScore filter
- [x] Server-side hasWebsite filter
- [x] Server-side hasEmail filter
- [x] Pagination works with explicit page/limit params (server-side)
- [x] Sorting by: name, leadScore, lastEnrichedAt, createdAt (server-side)
- [x] Filter bar is sticky and compact
- [x] Table rows are compact and scannable
- [x] Website and phone are directly usable (links/tel:)
- [x] Lead score is visually scannable (badge/indicator — not flashy)
- [x] Empty state explains why no results are shown
- [x] Loading state is clean and unobtrusive

### Company detail page (`/companies/[id]`)
Above the fold must appear in this order:
- [x] Identity band: name, status, domain, phone, city/county, territory
- [x] Contactability: email/phone/website links
- [x] Lead score + active score (numeric + visual indicator)
- [x] Score reasons (listed clearly, all visible — not collapsed)
- [x] Outreach angle (first useful sales takeaway)
- [x] Enrichment status (last enriched, source)

Below the fold:
- [x] AI summary (or "Not yet enriched" state)
- [x] Likely product demand categories
- [x] Likely sales motion + buyer value
- [x] Signals timeline (readable without expanding)
- [x] Contacts list (or empty state)
- [x] Notes/tags placeholder (labeled as "coming later" — not missing-feeling)
- [x] Source links with URL + source type
- [x] All empty/not-enriched states are useful, not blank

### Jobs page (`/jobs`)
- [x] Page route exists and renders
- [x] Job rows sorted newest first
- [x] Each row shows: source type, status, startedAt, finishedAt, duration (if available), recordsFound, recordsCreated, recordsUpdated, error summary
- [x] Failed jobs are visually distinguishable from successful jobs
- [x] Clicking a job (or expanding) reveals full error message and metadata
- [x] Feels like an operational log — not an analytics dashboard
- [x] Empty state is useful

---

## Phase 4 — Import + enrichment

### CSV import flow (`/import`)

Import stages — must be separate:
1. Parse → return preview (no DB write)
2. Preview → show first 25 rows with detected headers
3. Validate → check required fields and format
4. Map → explicit field mapping (required unless headers match known aliases)
5. Commit → write to DB only after validation passes

Rules:
- [x] Upload UI accepts `.csv` files only
- [x] Preview renders first 25 rows before any DB operation
- [x] Field mapping step is shown unless headers match known aliases
- [x] Required fields validated before import proceeds
- [x] Company name, website/domain, and phone normalized before persistence
- [x] Import reports: created / updated / skipped / invalid counts
- [x] Row-level import errors stored and visible in result summary
- [x] Deduplication applied: domain first, normalized name second, phone third
- [x] Non-empty fields are never overwritten with empty imported values
- [x] Invalid rows do not block valid rows unless there is a fatal parsing error
- [x] Preview does not write to DB
- [x] Commit writes only after validation passes
- [x] Result summary shown after completion
- [x] Rejects files above a reasonable size limit with a clear error message
- [x] Rejects malformed/non-CSV uploads with a structured parse error response

### Website enrichment (`/lib/enrichment`)

Enrichment safety limits — all enforced:
- [x] Same-domain requests only (no off-domain following)
- [x] Max 4 fetched pages per company in v1
- [x] Request timeout enforced (reasonable default, configurable via env)
- [x] HTML fetch only in v1 — no browser automation, no JS rendering
- [x] Robots.txt behavior is documented (enforce or explicitly note it is not enforced in v1)

Enrichment behavior:
- [x] Accepts a public website URL as input
- [x] Fetches homepage HTML
- [x] Optionally fetches up to 3 additional same-domain pages (about/services/contact)
- [x] Extracts: visible text, title, meta description, public emails, public phones, address-like strings, service keywords
- [x] Normalizes result into structured payload
- [x] Stores a CrawlJob record (startedAt, finishedAt, status, errorMessage)
- [x] Fails gracefully on blocked/unreadable sites with clear error in CrawlJob
- [x] Does not overclaim enrichment quality beyond what was extracted
- [x] Concurrent enrichment runs for the same company are bounded (no duplicate parallel runs per company)

### AI enrichment wrapper (`/lib/ai`)
- [x] Provider-agnostic wrapper (model/provider configurable via env)
- [x] Calls AI with enrichment payload, returns structured JSON
- [x] Output validated against zod schema before persistence
- [x] Invalid/incomplete AI output triggers fallback, not silent write
- [x] Derives: `primarySegment`, `secondarySegments[]`, `specialties[]`, `summary`, `likelyBuyerProfile`, `confidence`, `recommendedFollowUpAngle`
- [x] "Not yet enriched" states handled gracefully in UI

### Non-AI keyword classifier (`/lib/enrichment/keywords`)
- [x] Classifies extracted text into: industrial, commercial, residential, mixed
- [x] Detects specialty keywords: switchgear, panelboards, lighting, controls, generators, service, multifamily, low voltage, fire alarm, tenant improvement, industrial maintenance, distribution center/warehouse, healthcare, schools, churches, municipal/public work, EV charging
- [x] Returns segment classification + matched specialty keywords
- [x] Works independently (no AI required)
- [x] Unit tests cover: industrial-dominant text, residential-dominant text, mixed text, empty text

---

## Phase 5 — Adapter architecture

### Base adapter interface (`/lib/sources/base`)
- [x] TypeScript interface defines: `discover()`, `fetchDetails()`, `normalize()`, `persist()`
- [x] Interface is exported and reusable across source types

### Adapter layer responsibilities
- Adapter = orchestration boundary for source type
- Enrichment service = fetch/parse/extract logic for websites
- Job runner = executes adapter and records CrawlJob
- Persistence/normalization = separate helpers

### Company-site adapter (`/lib/sources/company-site`)
- [x] Implements base adapter interface
- [x] Delegates fetch/extract to enrichment service (does not duplicate that logic)
- [x] Stores CrawlJob record on execution

### Permit adapter scaffold (`/lib/sources/permits`)
- [x] Adapter file exists implementing the base interface
- [x] Demo mode returns seeded fixture data
- [x] UI labels this source as: "Demo data — live source not connected"
- [x] README documents: exact API/source needed, required credentials, what fields map where

### License adapter scaffold (`/lib/sources/licenses`)
- [x] Adapter file exists implementing the base interface
- [x] Demo mode returns seeded fixture data
- [x] UI labels this source as: "Demo data — live source not connected"
- [x] README documents: exact API/source needed, required credentials, what fields map where

### Job runner (`/lib/jobs`)
- [x] Invokes adapters by source type
- [x] Creates CrawlJob record at start (status: running)
- [x] Updates CrawlJob on completion (status, finishedAt, counts, errorMessage)
- [x] Runnable via API endpoint

### Health endpoint
- [x] `GET /api/health` returns `{ status: "ok", db: "connected" }` with 200
- [x] Returns 500 with error detail if DB is unreachable

---

## API contract

### Companies
- [x] `GET /api/companies` returns `{ data, total, page, limit, totalPages }`
- [x] Supports validated query params: `search`, `county`, `segment`, `status`, `minScore`, `hasWebsite`, `hasEmail`, `sort`, `page`, `limit`
- [x] All query params validated with zod before use
- [x] `GET /api/companies/:id` returns full company detail payload
- [x] `PATCH /api/companies/:id` validates input with zod and updates only: `status`, `doNotContact`, `notes`
- [x] Derived/system fields are not editable via PATCH: scores, normalized fields, enrichment outputs, timestamps, crawl job lineage

### Jobs
- [x] `GET /api/jobs` returns paginated CrawlJob records sorted newest first

### Import
- [x] `POST /api/import/csv/preview` parses CSV and returns preview — no DB write
- [x] `POST /api/import/csv/commit` validates rows, writes to DB, returns `{ created, updated, skipped, invalid, errors[] }`

### Enrichment
- [x] `POST /api/enrich/company/:id` runs enrichment for one company and returns result
- [x] `POST /api/enrich/batch` runs enrichment for a bounded batch size (configurable, default ≤ 10)

### Health
- [x] `GET /api/health` is public (no auth required), returns only `{ status: "ok", db: "connected" }` — no env vars, secrets, or system info

### API consistency rules
- [x] All routes return consistent response shapes
- [x] All errors return `{ error: string, details?: any }` at minimum
- [x] No route trusts raw query params — all validated via zod before use

---

## Phase 6 — Hardening

### Route protection
- [x] All `(protected)` pages redirect unauthenticated users
- [x] All business `/api/*` routes return 401 on unauthenticated request
- [x] `/api/health` is explicitly exempted from auth as documented above

### Input validation
- [x] All API route inputs validated with zod
- [x] Validation schemas are centralized (not inline per route)
- [x] Invalid input returns structured error response, not 500

### Backend cleanliness
- [x] Route handlers are thin — business logic lives in `/lib` helpers
- [x] DB queries live in service or repository helpers, not inline in route handlers
- [x] Pagination contract is consistent: `{ data, total, page, limit, totalPages }`
- [x] Filter params validated before being passed to DB queries

### Error states
- [x] All pages have useful error boundaries (not blank crashes)
- [x] All API routes return consistent error shapes
- [x] CrawlJob errors stored in `errorMessage` field on failure

### Seed data quality standard
The seed must produce:
- [x] 24+ total companies
- [x] At least 6 primarily industrial
- [x] At least 6 primarily commercial
- [x] At least 6 primarily residential
- [x] At least 6 mixed/overlap
- [x] Companies distributed across: Gwinnett, Hall, Forsyth, Cobb, Fulton, Cherokee counties
- [x] Cities align plausibly with their counties (e.g., Duluth/Gwinnett, Gainesville/Hall)
- [x] Company names are not repetitive templates — each name is distinct and believable
- [x] Each company has distinct specialties (not all identical)
- [x] At least half the companies have 2–4 signals with varied source types and wording
- [x] Not all companies have a website (realistic gaps)
- [x] Not all companies have an email (realistic gaps)
- [x] Score distribution varies meaningfully across the set

### Don't overclaim external readiness
- [x] Permit/license adapters labeled clearly as demo stubs in UI
- [x] AI enrichment quality not claimed beyond what seeded/manual validation shows
- [x] No live external integrations presented as complete unless live-tested
- [x] All deferred items documented in README with honest status

### README
- [x] Setup: clone, install, env vars, migrate, seed, run
- [x] All required env vars listed with descriptions
- [x] Architecture overview (app structure, key lib directories)
- [x] Deferred work section: every stub/TODO with honest status

### Final verification
- [x] App boots locally without manual patching
- [x] Auth works end to end
- [x] Database schema and migrations run cleanly
- [x] Seed creates believable, varied demo data
- [x] Companies page: search, filter, sort, paginate all work
- [x] Company detail page: score, reasons, signals, enrichment status all visible above fold
- [x] CSV import: upload, preview, map, import, result summary all work
- [x] Scoring: returns transparent mapped reasons
- [x] AI wrapper: exists, validates output, has graceful fallback
- [x] Keyword classifier: works independently of AI
- [x] Adapter framework: reusable TypeScript interface in place
- [x] Jobs page: shows real CrawlJob records with error visibility
- [x] Tests pass
- [x] README is complete and honest
- [x] `pnpm install` completes without errors
- [x] `pnpm lint` passes
- [x] `pnpm test` passes
- [x] `pnpm prisma migrate dev` succeeds on clean DB
- [x] `pnpm db:seed` succeeds and creates expected records
- [x] `pnpm dev` starts without blocking errors
- [x] Tests cover `GET /api/companies` pagination and filter param validation
- [x] Tests cover CSV preview (no DB write) vs commit (DB write confirmed) behavior
- [x] Return exactly: <promise>COMPLETE</promise>

---

## Explicit non-goals for v1
- No LinkedIn scraping
- No Google Maps scraping
- No CAPTCHA bypasses
- No stealth scraping
- No fake live integrations disguised as complete
- No overbuilt design system
- No mass outbound automation
