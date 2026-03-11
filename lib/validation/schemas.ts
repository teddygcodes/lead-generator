/**
 * Centralized zod validation schemas.
 * All API route inputs validated here — not inline per route.
 */

import { z } from 'zod'

// ---- Pagination ----
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

// ---- Company list filters ----
export const CompanyFiltersSchema = z.object({
  search: z.string().optional(),
  county: z.string().optional(),
  segment: z.string().optional(),
  status: z
    .enum(['NEW', 'QUALIFYING', 'ACTIVE', 'INACTIVE', 'DO_NOT_CONTACT'])
    .optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  hasWebsite: z.enum(['true', 'false']).optional(),
  hasEmail: z.enum(['true', 'false']).optional(),
  sort: z
    .enum(['name', 'leadScore', 'lastEnrichedAt', 'createdAt'])
    .default('leadScore'),
  order: z.enum(['asc', 'desc']).default('desc'),
  // showDemo=true reveals demo seed data; default false hides it from the normal lead view
  showDemo: z.enum(['true', 'false']).default('false'),
  ...PaginationSchema.shape,
})

export type CompanyFilters = z.infer<typeof CompanyFiltersSchema>

// ---- Company PATCH ----
export const CompanyPatchSchema = z.object({
  status: z.enum(['NEW', 'QUALIFYING', 'ACTIVE', 'INACTIVE', 'DO_NOT_CONTACT']).optional(),
  doNotContact: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
  website: z.string().url().nullable().optional(),
})

export type CompanyPatch = z.infer<typeof CompanyPatchSchema>

// ---- Jobs list filters ----
export const JobFiltersSchema = z.object({
  sourceType: z.string().optional(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']).optional(),
  ...PaginationSchema.shape,
})

// ---- CSV import commit ----
export const ImportRowSchema = z.object({
  name: z.string().min(1, 'Company name required'),
  website: z.string().url().optional().or(z.literal('')),
  domain: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  county: z.string().optional(),
})

export type ImportRow = z.infer<typeof ImportRowSchema>

// ---- Enrich batch ----
export const EnrichBatchSchema = z.object({
  companyIds: z.array(z.string()).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(25),
})

// ---- Delete batch ----
export const DeleteBatchSchema = z.object({
  companyIds: z.array(z.string()).min(1).max(50),
})

// ---- Run job ----
// Note: "LICENSE" is the internal adapter registry key for the Business Registry adapter.
// It is never exposed as a user-facing label — product surfaces use "Business Registry".
export const RunJobSchema = z.object({
  sourceType: z.enum(['COMPANY_WEBSITE', 'PERMIT', 'LICENSE', 'COMPANY_DISCOVERY']),
  params: z.record(z.unknown()).optional(),
})

// ---- Google Places prospecting ----
export const PlaceAddItemSchema = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  website: z.string().nullable().optional(),
})

export const PlacesAddSchema = z.object({
  places: z.array(PlaceAddItemSchema).min(1).max(50),
})

export type PlaceAddItem = z.infer<typeof PlaceAddItemSchema>

// ---- Permit PATCH ----
export const PermitPatchSchema = z.object({
  companyId: z.string().nullable(),
})

export type PermitPatch = z.infer<typeof PermitPatchSchema>

// ---- Permit bulk-sync (propagate existing links to unlinked permits by contractor name) ----
export const PermitBulkSyncSchema = z.object({
  county: z.string().optional(),
})

export type PermitBulkSync = z.infer<typeof PermitBulkSyncSchema>

// ---- Merge two companies ----
export const MergeCompaniesSchema = z
  .object({
    primaryId: z.string().min(1),
    secondaryId: z.string().min(1),
  })
  .refine((d) => d.primaryId !== d.secondaryId, {
    message: 'Cannot merge a company with itself',
  })

export type MergeCompanies = z.infer<typeof MergeCompaniesSchema>

// ---- Company create (from permit or other quick-create flows) ----
export const CompanyCreateSchema = z.object({
  name: z.string().min(1),
  county: z.string().optional(),
  phone: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  status: z.enum(['NEW', 'QUALIFYING', 'ACTIVE', 'INACTIVE', 'DO_NOT_CONTACT']).default('NEW'),
  recordOrigin: z.enum(['DISCOVERED', 'IMPORTED', 'MANUAL']).default('MANUAL'),
})

export type CompanyCreate = z.infer<typeof CompanyCreateSchema>
