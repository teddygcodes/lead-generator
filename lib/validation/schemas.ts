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
  ...PaginationSchema.shape,
})

export type CompanyFilters = z.infer<typeof CompanyFiltersSchema>

// ---- Company PATCH ----
export const CompanyPatchSchema = z.object({
  status: z.enum(['NEW', 'QUALIFYING', 'ACTIVE', 'INACTIVE', 'DO_NOT_CONTACT']).optional(),
  doNotContact: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
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
  companyIds: z.array(z.string()).max(10).optional(),
  limit: z.coerce.number().int().min(1).max(10).default(5),
})

// ---- Run job ----
// Note: "LICENSE" is the internal adapter registry key for the Business Registry adapter.
// It is never exposed as a user-facing label — product surfaces use "Business Registry".
export const RunJobSchema = z.object({
  sourceType: z.enum(['COMPANY_WEBSITE', 'PERMIT', 'LICENSE']),
  params: z.record(z.unknown()).optional(),
})
