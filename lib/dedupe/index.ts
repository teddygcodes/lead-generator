import { db } from '@/lib/db'
import { normalizeName, normalizeDomain, normalizePhone } from '@/lib/normalization'

export interface DedupeResult {
  found: boolean
  companyId: string | null
  matchedOn: 'domain' | 'name' | 'phone' | null
}

/**
 * Check if a company already exists in the database.
 * Priority: domain → normalizedName → phone
 */
export async function findExistingCompany(params: {
  domain?: string | null
  name?: string | null
  phone?: string | null
}): Promise<DedupeResult> {
  const { domain, name, phone } = params

  // 1. Domain check (most reliable)
  const normalizedDomain = normalizeDomain(domain)
  if (normalizedDomain) {
    const existing = await db.company.findFirst({
      where: { domain: normalizedDomain },
      select: { id: true },
    })
    if (existing) {
      return { found: true, companyId: existing.id, matchedOn: 'domain' }
    }
  }

  // 2. Normalized name check
  const normalizedName = normalizeName(name)
  if (normalizedName) {
    const existing = await db.company.findFirst({
      where: { normalizedName },
      select: { id: true },
    })
    if (existing) {
      return { found: true, companyId: existing.id, matchedOn: 'name' }
    }
  }

  // 3. Phone check
  const normalizedPhoneVal = normalizePhone(phone)
  if (normalizedPhoneVal) {
    const existing = await db.company.findFirst({
      where: { phone: normalizedPhoneVal },
      select: { id: true },
    })
    if (existing) {
      return { found: true, companyId: existing.id, matchedOn: 'phone' }
    }
  }

  return { found: false, companyId: null, matchedOn: null }
}

/**
 * Merge incoming company data with existing, never overwriting non-empty fields with empty ones.
 */
export function mergeCompanyData<T extends Record<string, unknown>>(
  existing: Partial<T>,
  incoming: Partial<T>,
): Partial<T> {
  const merged: Partial<T> = { ...existing }
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    const incomingVal = incoming[key]
    const existingVal = existing[key]
    // Only overwrite if incoming is non-empty and existing is empty
    const isEmpty = (v: unknown) =>
      v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
    if (!isEmpty(incomingVal) && isEmpty(existingVal)) {
      merged[key] = incomingVal
    }
  }
  return merged
}
