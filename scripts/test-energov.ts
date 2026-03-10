/**
 * Diagnostic script — EnerGov API field mapping verification
 * Run: pnpm tsx scripts/test-energov.ts
 *
 * EnerGov is a public API — no credentials needed.
 * Do not delete — kept as reference for adapter field mapping.
 *
 * Verified field mapping (PascalCase):
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

const INSTANCES = {
  FORSYTH: {
    base: 'https://css.forsythco.com/energov_prod/selfservice',
    tenantUrl: 'ForsythCountyGAProd',
    tenantName: 'ForsythCountyGAProd',
    tenantId: '1',
  },
  JACKSON: {
    base: 'https://jacksoncountyga-energovweb.tylerhost.net/apps/selfservice',
    tenantUrl: 'Home',
    tenantName: 'Jackson County, GA',
    tenantId: '1',
  },
} as const

type InstanceKey = keyof typeof INSTANCES

/** Build the full nested EnerGov search body. */
function buildSearchBody(keyword: string, applyDateFrom: string, pageNumber = 1, pageSize = 5) {
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

async function testInstance(name: InstanceKey) {
  const cfg = INSTANCES[name]
  const url = `${cfg.base}/api/energov/search/search`
  const applyDateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  console.log(`\n=== ${name} ===`)
  console.log(`URL: ${url}`)
  console.log(`tenant: ${cfg.tenantUrl} | from: ${applyDateFrom}\n`)

  const headers = {
    'Content-Type': 'application/json;charset=UTF-8',
    Accept: 'application/json, text/plain, */*',
    'tyler-tenanturl': cfg.tenantUrl,
    tenantid: cfg.tenantId,
    'tyler-tenant-culture': 'en-US',
    tenantname: cfg.tenantName,
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildSearchBody('electrical', applyDateFrom)),
    })
  } catch (err) {
    console.log(`  → Network error: ${err}`)
    return null
  }

  if (!res.ok) {
    const text = await res.text()
    console.log(`  → HTTP ${res.status}: ${text.slice(0, 500)}`)
    return null
  }

  const data = (await res.json()) as {
    Result?: { EntityResults?: Record<string, unknown>[]; PermitsFound?: number }
    Success?: boolean
  }

  const results: Record<string, unknown>[] = data.Result?.EntityResults ?? []
  const total = data.Result?.PermitsFound ?? 0

  console.log(`HTTP 200 | PermitsFound: ${total} | page results: ${results.length}`)

  if (results.length === 0) {
    console.log('No results in this date range.')
    return { name, total, results: 0, sample: null }
  }

  const sample = results[0]
  console.log('\nFirst record keys:', Object.keys(sample).join(', '))
  console.log('\nFull first record:\n', JSON.stringify(sample, null, 2))

  // Field checks
  const checks: Record<string, unknown> = {
    externalId: sample['CaseNumber'],
    permitType: sample['CaseType'],
    workClass: sample['CaseWorkclass'],
    status: sample['CaseStatus'],
    address: sample['AddressDisplay'],
    filedAt: sample['ApplyDate'],
    issuedAt: sample['IssueDate'],
    finalAt: sample['FinalDate'],
    description: sample['Description'],
    jobValue: sample['JobValue'] ?? '(not present - expected)',
    contractor: sample['CompanyName'] ?? '(not present - expected)',
  }

  console.log('\n=== Field Mapping Check ===')
  for (const [field, value] of Object.entries(checks)) {
    console.log(`  ${field}: ${JSON.stringify(value)}`)
  }

  return { name, total, results: results.length, sample, checks }
}

async function main() {
  console.log('=== EnerGov API Diagnostic ===')
  console.log('Testing Forsyth + Jackson (public APIs, no auth)\n')

  const forsythResult = await testInstance('FORSYTH')
  const jacksonResult = await testInstance('JACKSON')

  console.log('\n\n=== SUMMARY ===')
  console.log(JSON.stringify(
    {
      FORSYTH: forsythResult ? { total: forsythResult.total, results: forsythResult.results, checks: forsythResult.checks } : null,
      JACKSON: jacksonResult ? { total: jacksonResult.total, results: jacksonResult.results, checks: jacksonResult.checks } : null,
    },
    null,
    2,
  ))
}

main().catch((err) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
