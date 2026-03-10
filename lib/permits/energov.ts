/**
 * EnerGov REST API adapter — fetches permit records from EnerGov-powered county portals.
 *
 * Supported instances: Forsyth County, Jackson County
 *
 * Auth: None required — public REST API.
 *
 * Verified field mapping (PascalCase response):
 *   externalId  → CaseNumber
 *   permitType  → CaseType / CaseWorkclass
 *   status      → CaseStatus
 *   address     → AddressDisplay
 *   filedAt     → ApplyDate
 *   issuedAt    → IssueDate
 *   closedAt    → FinalDate
 *   description → Description
 *   jobValue    → not present in search results (null)
 *   contractor  → not present in search results (Unknown)
 *
 * Response envelope: data.Result.EntityResults[]
 */

import { type NormalizedPermit, isResidential, normalizeStatus } from '@/lib/permits/base'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const INSTANCE_CONFIG = {
  FORSYTH: {
    base: 'https://css.forsythco.com/energov_prod/selfservice',
    county: 'Forsyth',
    source: 'ENERGOV_FORSYTH',
    tenantUrl: 'ForsythCountyGAProd',
    tenantName: 'ForsythCountyGAProd',
    tenantId: '1',
  },
  JACKSON: {
    base: 'https://jacksoncountyga-energovweb.tylerhost.net/apps/selfservice',
    county: 'Jackson',
    source: 'ENERGOV_JACKSON',
    tenantUrl: 'Home',
    tenantName: 'Jackson County, GA',
    tenantId: '1',
  },
} as const

type InstanceName = keyof typeof INSTANCE_CONFIG
type InstanceConfig = (typeof INSTANCE_CONFIG)[InstanceName]

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface EnerGovEntityResult {
  CaseId?: string
  CaseNumber?: string
  CaseType?: string
  CaseWorkclass?: string
  CaseStatus?: string
  Description?: string | null
  ApplyDate?: string | null
  IssueDate?: string | null
  FinalDate?: string | null
  AddressDisplay?: string | null
  Address?: {
    FullAddress?: string | null
    AddressLine1?: string | null
    City?: string | null
    StateName?: string | null
    PostalCode?: string | null
  } | null
  [key: string]: unknown
}

interface EnerGovSearchResponse {
  Result?: {
    EntityResults?: EnerGovEntityResult[]
    PermitsFound?: number
    TotalPages?: number
  }
  Success?: boolean
  StatusCode?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as YYYY-MM-DD for EnerGov query params.
 */
function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Derive a normalized permit type from raw EnerGov CaseType / CaseWorkclass fields.
 */
function derivePermitType(
  caseType: string | undefined | null,
  caseWorkclass: string | undefined | null,
): NormalizedPermit['permitType'] {
  const combined = `${caseType ?? ''} ${caseWorkclass ?? ''}`.toUpperCase()
  if (combined.includes('ELECTRICAL') || combined.includes('ELECTRIC')) return 'ELECTRICAL'
  if (combined.includes('BUILDING')) return 'BUILDING'
  if (combined.includes('MECHANICAL') || combined.includes('HVAC') || combined.includes('PLUMBING')) return 'MECHANICAL'
  return 'OTHER'
}

/**
 * Build the full EnerGov search request body.
 * All criteria objects must be present (even as nulls) — the API rejects simplified bodies.
 */
function buildSearchBody(keyword: string, applyDateFrom: string, pageNumber: number, pageSize: number) {
  return {
    Keyword: keyword,
    ExactMatch: false,
    SearchModule: 1,
    FilterModule: 2, // 2 = Permits only
    SearchMainAddress: false,
    PlanCriteria: { PlanNumber: null, PlanTypeId: null, PlanWorkclassId: null, PlanStatusId: null, ProjectName: null, ApplyDateFrom: null, ApplyDateTo: null, ExpireDateFrom: null, ExpireDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Address: null, Description: null, SearchMainAddress: false, ContactId: null, ParcelNumber: null, TypeId: null, WorkClassIds: null, ExcludeCases: null, EnableDescriptionSearch: false, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    PermitCriteria: { PermitNumber: null, PermitTypeId: 'none', PermitWorkclassId: null, PermitStatusId: 'none', ProjectName: null, IssueDateFrom: null, IssueDateTo: null, Address: null, Description: null, ExpireDateFrom: null, ExpireDateTo: null, FinalDateFrom: null, FinalDateTo: null, ApplyDateFrom: applyDateFrom, ApplyDateTo: null, SearchMainAddress: false, ContactId: null, TypeId: null, WorkClassIds: null, ParcelNumber: null, ExcludeCases: null, EnableDescriptionSearch: false, PageNumber: 0, PageSize: 0, SortBy: 'PermitNumber.keyword', SortAscending: false },
    InspectionCriteria: { Keyword: null, ExactMatch: false, Complete: null, InspectionNumber: null, InspectionTypeId: null, InspectionStatusId: null, RequestDateFrom: null, RequestDateTo: null, ScheduleDateFrom: null, ScheduleDateTo: null, Address: null, SearchMainAddress: false, ContactId: null, TypeId: [], WorkClassIds: [], ParcelNumber: null, DisplayCodeInspections: false, ExcludeCases: [], ExcludeFilterModules: [], HiddenInspectionTypeIDs: null, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    CodeCaseCriteria: { CodeCaseNumber: null, CodeCaseTypeId: null, CodeCaseStatusId: null, ProjectName: null, OpenedDateFrom: null, OpenedDateTo: null, ClosedDateFrom: null, ClosedDateTo: null, Address: null, ParcelNumber: null, Description: null, SearchMainAddress: false, RequestId: null, ExcludeCases: null, ContactId: null, EnableDescriptionSearch: false, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    RequestCriteria: { RequestNumber: null, RequestTypeId: null, RequestStatusId: null, ProjectName: null, EnteredDateFrom: null, EnteredDateTo: null, DeadlineDateFrom: null, DeadlineDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Address: null, ParcelNumber: null, SearchMainAddress: false, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    BusinessLicenseCriteria: { LicenseNumber: null, LicenseTypeId: null, LicenseClassId: null, LicenseStatusId: null, BusinessStatusId: null, LicenseYear: null, ApplicationDateFrom: null, ApplicationDateTo: null, IssueDateFrom: null, IssueDateTo: null, ExpirationDateFrom: null, ExpirationDateTo: null, SearchMainAddress: false, CompanyTypeId: null, CompanyName: null, BusinessTypeId: null, Description: null, CompanyOpenedDateFrom: null, CompanyOpenedDateTo: null, CompanyClosedDateFrom: null, CompanyClosedDateTo: null, LastAuditDateFrom: null, LastAuditDateTo: null, ParcelNumber: null, Address: null, TaxID: null, DBA: null, ExcludeCases: null, TypeId: null, WorkClassIds: null, ContactId: null, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    ProfessionalLicenseCriteria: { LicenseNumber: null, HolderFirstName: null, HolderMiddleName: null, HolderLastName: null, HolderCompanyName: null, LicenseTypeId: null, LicenseClassId: null, LicenseStatusId: null, IssueDateFrom: null, IssueDateTo: null, ExpirationDateFrom: null, ExpirationDateTo: null, ApplicationDateFrom: null, ApplicationDateTo: null, Address: null, MainParcel: null, SearchMainAddress: false, ExcludeCases: null, TypeId: null, WorkClassIds: null, ContactId: null, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    LicenseCriteria: { LicenseNumber: null, LicenseTypeId: null, LicenseClassId: null, LicenseStatusId: null, BusinessStatusId: null, ApplicationDateFrom: null, ApplicationDateTo: null, IssueDateFrom: null, IssueDateTo: null, ExpirationDateFrom: null, ExpirationDateTo: null, SearchMainAddress: false, CompanyTypeId: null, CompanyName: null, BusinessTypeId: null, Description: null, CompanyOpenedDateFrom: null, CompanyOpenedDateTo: null, CompanyClosedDateFrom: null, CompanyClosedDateTo: null, LastAuditDateFrom: null, LastAuditDateTo: null, ParcelNumber: null, Address: null, TaxID: null, DBA: null, ExcludeCases: null, TypeId: null, WorkClassIds: null, ContactId: null, HolderFirstName: null, HolderMiddleName: null, HolderLastName: null, MainParcel: null, EnableDescriptionSearchForBLicense: false, EnableDescriptionSearchForPLicense: false, EnableDescriptionSearchForOperationalPermit: false, IsOperationalPermit: false, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    ProjectCriteria: { ProjectNumber: null, ProjectName: null, Address: null, ParcelNumber: null, StartDateFrom: null, StartDateTo: null, ExpectedEndDateFrom: null, ExpectedEndDateTo: null, CompleteDateFrom: null, CompleteDateTo: null, Description: null, SearchMainAddress: false, ContactId: null, TypeId: null, ExcludeCases: null, EnableDescriptionSearch: false, PageNumber: 0, PageSize: 0, SortBy: null, SortAscending: false },
    ExcludeCases: null,
    HiddenInspectionTypeIDs: null,
    PageNumber: pageNumber,
    PageSize: pageSize,
    SortBy: 'PermitNumber.keyword',
    SortAscending: false,
  }
}

// ---------------------------------------------------------------------------
// Pagination — single keyword pass
// ---------------------------------------------------------------------------

/**
 * Fetch all pages for a single keyword search against the EnerGov search endpoint.
 * Paginates until an empty EntityResults array is returned.
 */
async function fetchKeywordPages(
  config: InstanceConfig,
  instance: InstanceName,
  keyword: string,
  startDate: string,
  hasLoggedRawRef: { value: boolean },
): Promise<EnerGovEntityResult[]> {
  const url = `${config.base}/api/energov/search/search`
  const headers = {
    'Content-Type': 'application/json;charset=UTF-8',
    Accept: 'application/json, text/plain, */*',
    'tyler-tenanturl': config.tenantUrl,
    tenantid: config.tenantId,
    'tyler-tenant-culture': 'en-US',
    tenantname: config.tenantName,
  }

  const all: EnerGovEntityResult[] = []
  let pageNumber = 1
  const pageSize = 50

  while (true) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildSearchBody(keyword, startDate, pageNumber, pageSize)),
      signal: AbortSignal.timeout(20_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(
        `[energov] ${instance} keyword="${keyword}" page=${pageNumber}: HTTP ${res.status} ${text}`,
      )
    }

    const data = (await res.json()) as EnerGovSearchResponse
    const results: EnerGovEntityResult[] = data.Result?.EntityResults ?? []

    console.log(
      `[energov] ${instance} keyword="${keyword}" page=${pageNumber} results=${results.length}`,
    )

    if (!hasLoggedRawRef.value && results.length > 0) {
      console.log(
        `[energov] ${instance} raw result sample:`,
        JSON.stringify(results[0], null, 2),
      )
      hasLoggedRawRef.value = true
    }

    if (results.length === 0) break

    all.push(...results)
    pageNumber++
  }

  return all
}

// ---------------------------------------------------------------------------
// Main adapter
// ---------------------------------------------------------------------------

async function energovAdapter(instance: InstanceName): Promise<NormalizedPermit[]> {
  const config = INSTANCE_CONFIG[instance]
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000)
  const startDate = formatDate(thirtyDaysAgo)

  // Shared raw-log gate across both passes
  const hasLoggedRawRef = { value: false }

  // Run two keyword passes sequentially to avoid rate limiting
  let rawElectrical: EnerGovEntityResult[] = []
  let rawCommercial: EnerGovEntityResult[] = []

  try {
    rawElectrical = await fetchKeywordPages(
      config,
      instance,
      'electrical',
      startDate,
      hasLoggedRawRef,
    )
  } catch (err) {
    console.warn(`[energov] ${instance} keyword="electrical" fetch failed:`, err)
  }

  try {
    rawCommercial = await fetchKeywordPages(
      config,
      instance,
      'commercial',
      startDate,
      hasLoggedRawRef,
    )
  } catch (err) {
    console.warn(`[energov] ${instance} keyword="commercial" fetch failed:`, err)
  }

  // Dedupe by externalId (same permit may appear in both keyword passes)
  const seen = new Set<string>()
  const combined: EnerGovEntityResult[] = []
  for (const record of [...rawElectrical, ...rawCommercial]) {
    const externalId = record.CaseNumber ?? record.CaseId ?? ''
    if (!externalId || seen.has(externalId)) continue
    seen.add(externalId)
    combined.push(record)
  }

  const permits: NormalizedPermit[] = []

  for (const result of combined) {
    try {
      // External ID / permit number — CaseNumber is the human-readable permit number
      const externalId = result.CaseNumber ?? result.CaseId ?? ''

      if (!externalId) {
        console.warn(`[energov] ${instance}: skipping record with no CaseNumber/CaseId`)
        continue
      }

      // Permit type
      const permitType = derivePermitType(result.CaseType, result.CaseWorkclass)

      // Description
      const description = result.Description ?? null

      // Status
      const status = normalizeStatus(result.CaseStatus ?? '')

      // Address — prefer AddressDisplay, fall back to nested Address.FullAddress
      const jobAddress =
        result.AddressDisplay ??
        result.Address?.FullAddress ??
        null

      // Job value — not available in EnerGov search results
      const jobValue: number | null = null

      // Filed date (ApplyDate) — skip records with no valid filedAt
      const rawFiledDate = result.ApplyDate ?? null

      if (!rawFiledDate) {
        console.warn(`[energov] ${instance}: skipping ${externalId} — no ApplyDate`)
        continue
      }

      const filedAt = new Date(rawFiledDate)
      if (Number.isNaN(filedAt.getTime())) {
        console.warn(`[energov] ${instance}: skipping ${externalId} — invalid ApplyDate "${rawFiledDate}"`)
        continue
      }

      const issuedAt = result.IssueDate ? new Date(result.IssueDate) : null
      const closedAt = result.FinalDate ? new Date(result.FinalDate) : null

      // Contractor — not available in EnerGov search results
      const contractorName = 'Unknown'

      permits.push({
        source: config.source,
        externalId,
        permitNumber: externalId,
        permitType,
        description,
        status,
        jobAddress,
        county: config.county,
        jobValue,
        isResidential: isResidential(description) || isResidential(result.CaseType ?? null),
        filedAt,
        issuedAt,
        inspectionAt: null,
        closedAt,
        contractorName,
        contractorPhone: null,
        contractorLicense: null,
      })
    } catch (err) {
      const id = result.CaseNumber ?? result.CaseId ?? 'unknown'
      console.warn(`[energov] ${instance}: failed to map record ${id}:`, err)
      // Never throw — skip and continue
    }
  }

  return permits
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { energovAdapter }
export type { InstanceName }
