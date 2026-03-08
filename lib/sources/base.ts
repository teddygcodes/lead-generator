/**
 * Base source adapter interface.
 * All data source adapters must implement this interface.
 *
 * Adapter layer responsibilities:
 * - Adapter = orchestration boundary for a source type
 * - Enrichment service = fetch/parse/extract logic for websites
 * - Job runner = executes adapter and records CrawlJob
 * - Persistence/normalization = separate helpers
 */

export interface DiscoverResult {
  sourceId: string
  name: string
  metadata: Record<string, unknown>
}

export interface DetailResult {
  sourceId: string
  rawData: Record<string, unknown>
}

export interface NormalizedRecord {
  name: string
  normalizedName?: string
  /**
   * Internal DB company ID — set when adapter already knows the target company
   * (e.g. enrichment/identity adapters that select candidates from the DB).
   * Not set for permit/discovery adapters that create new companies.
   */
  companyId?: string
  domain?: string
  website?: string
  phone?: string
  email?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  county?: string
  segments?: string[]
  specialties?: string[]
  description?: string
  sourceType: string
  sourceName: string
  sourceUrl?: string
}

export interface PersistResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

export interface SourceAdapter {
  /** Source type identifier (matches SourceType enum) */
  sourceType: string

  /** Whether this adapter is running in demo mode (no live source) */
  isDemoMode: boolean

  /**
   * Actual current reason this adapter is in demo mode.
   * Set by the adapter at initialization time; reflects real adapter state.
   * Undefined when isDemoMode = false.
   * Runner uses this as the primary source of truth; falls back to a static
   * DEMO_REASONS table only when the adapter does not provide its own reason.
   */
  demoReason?: string

  /**
   * Discover available records from the source.
   * May return paginated results in real implementations.
   */
  discover(params?: Record<string, unknown>): Promise<DiscoverResult[]>

  /**
   * Fetch detail for a specific record.
   */
  fetchDetails(sourceId: string): Promise<DetailResult | null>

  /**
   * Normalize raw source data into a standard company-like record.
   */
  normalize(raw: DetailResult): NormalizedRecord

  /**
   * Persist normalized records to the database.
   */
  persist(records: NormalizedRecord[]): Promise<PersistResult>
}
