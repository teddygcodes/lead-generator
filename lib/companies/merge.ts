/**
 * merge.ts
 *
 * Pure helper for computing merged Company scalar fields.
 * Rule: primary (survivor) wins on every field it already has.
 * Secondary fills in only what primary is missing.
 */

import type { Prisma } from '@prisma/client'

type CompanyRow = {
  website: string | null
  domain: string | null
  phone: string | null
  email: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  region: string | null
  territory: string | null
  description: string | null
  employeeSizeEstimate: string | null
  googlePlaceId: string | null
  googleRating: number | null
  sourceConfidence: number | null
  notes: string | null
  lastSeenAt: Date | null
  lastEnrichedAt: Date | null
  lastContactedAt: Date | null
  serviceAreas: string[]
  segments: string[]
  specialties: string[]
  doNotContact: boolean
}

/**
 * Compute the Prisma update payload to apply to the primary company
 * after merging in data from the secondary.
 *
 * Only fills fields that are null/empty on the primary.
 * Arrays are unioned and deduplicated.
 * doNotContact becomes true if either company has it set.
 * Notes are concatenated if both exist.
 * Timestamps take the most recent value.
 * sourceConfidence takes the higher value.
 */
export function buildMergedFields(
  primary: CompanyRow,
  secondary: CompanyRow,
): Prisma.CompanyUpdateInput {
  const update: Prisma.CompanyUpdateInput = {}

  // ── Nullable string fields: fill primary's blank from secondary ──
  const nullableStrings = [
    'website', 'domain', 'phone', 'email',
    'street', 'city', 'state', 'zip',
    'county', 'region', 'territory',
    'description', 'employeeSizeEstimate', 'googlePlaceId',
  ] as const

  for (const field of nullableStrings) {
    if (!primary[field] && secondary[field]) {
      ;(update as Record<string, unknown>)[field] = secondary[field]
    }
  }

  // ── googleRating ──
  if (primary.googleRating == null && secondary.googleRating != null) {
    update.googleRating = secondary.googleRating
  }

  // ── sourceConfidence: take the higher value ──
  const primaryConf = primary.sourceConfidence ?? 0
  const secondaryConf = secondary.sourceConfidence ?? 0
  if (secondaryConf > primaryConf) {
    update.sourceConfidence = secondaryConf
  }

  // ── notes: concatenate if both exist, else take whichever exists ──
  if (primary.notes && secondary.notes) {
    update.notes = `${primary.notes}\n---\n${secondary.notes}`
  } else if (!primary.notes && secondary.notes) {
    update.notes = secondary.notes
  }

  // ── timestamps: take the most recent ──
  const mergeTimestamp = (
    a: Date | null,
    b: Date | null,
  ): Date | null => {
    if (!a && !b) return null
    if (!a) return b
    if (!b) return a
    return a > b ? a : b
  }

  const latestSeen = mergeTimestamp(primary.lastSeenAt, secondary.lastSeenAt)
  if (latestSeen && latestSeen !== primary.lastSeenAt) update.lastSeenAt = latestSeen

  const latestEnriched = mergeTimestamp(primary.lastEnrichedAt, secondary.lastEnrichedAt)
  if (latestEnriched && latestEnriched !== primary.lastEnrichedAt) update.lastEnrichedAt = latestEnriched

  const latestContacted = mergeTimestamp(primary.lastContactedAt, secondary.lastContactedAt)
  if (latestContacted && latestContacted !== primary.lastContactedAt) update.lastContactedAt = latestContacted

  // ── arrays: union and deduplicate ──
  const mergeArray = (a: string[], b: string[]): string[] =>
    [...new Set([...a, ...b])]

  const mergedSegments = mergeArray(primary.segments, secondary.segments)
  if (mergedSegments.length > primary.segments.length) update.segments = mergedSegments

  const mergedSpecialties = mergeArray(primary.specialties, secondary.specialties)
  if (mergedSpecialties.length > primary.specialties.length) update.specialties = mergedSpecialties

  const mergedServiceAreas = mergeArray(primary.serviceAreas, secondary.serviceAreas)
  if (mergedServiceAreas.length > primary.serviceAreas.length) update.serviceAreas = mergedServiceAreas

  // ── doNotContact: true if either is true ──
  if (!primary.doNotContact && secondary.doNotContact) {
    update.doNotContact = true
  }

  return update
}
