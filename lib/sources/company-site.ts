/**
 * Company website adapter.
 * Orchestrates website enrichment for a specific company record.
 * Delegates fetch/parse/extract to the enrichment service.
 */

import type { SourceAdapter, DiscoverResult, DetailResult, NormalizedRecord, PersistResult } from './base'
import { enrichFromWebsite } from '@/lib/enrichment'
import { normalizeName, normalizeDomain, extractDomain } from '@/lib/normalization'
import { db } from '@/lib/db'

export class CompanySiteAdapter implements SourceAdapter {
  sourceType = 'COMPANY_WEBSITE'
  isDemoMode = false

  /**
   * Discover: return companies that have a website but haven't been enriched recently.
   */
  async discover(params?: { limit?: number; staleDays?: number }): Promise<DiscoverResult[]> {
    const limit = params?.limit ?? 10
    const staleDays = params?.staleDays ?? 30
    const staleDate = new Date()
    staleDate.setDate(staleDate.getDate() - staleDays)

    const companies = await db.company.findMany({
      where: {
        website: { not: null },
        OR: [{ lastEnrichedAt: null }, { lastEnrichedAt: { lt: staleDate } }],
      },
      select: { id: true, name: true, website: true },
      take: limit,
      orderBy: { leadScore: 'desc' },
    })

    return companies.map((c) => ({
      sourceId: c.id,
      name: c.name,
      metadata: { website: c.website },
    }))
  }

  /**
   * Fetch details for a company by running website enrichment.
   */
  async fetchDetails(companyId: string): Promise<DetailResult | null> {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, website: true },
    })
    if (!company?.website) return null

    const result = await enrichFromWebsite(company.website)
    if (!result.success || !result.payload) return null

    return {
      sourceId: companyId,
      rawData: { ...result.payload, companyName: company.name },
    }
  }

  /**
   * Normalize enrichment payload into a standard record shape.
   */
  normalize(raw: DetailResult): NormalizedRecord {
    const data = raw.rawData as Record<string, unknown>
    const url = (data.url as string) ?? ''
    const domain = extractDomain(url)
    return {
      name: (data.companyName as string) ?? '',
      normalizedName: normalizeName(data.companyName as string),
      domain: normalizeDomain(domain),
      website: url,
      email: (data.emails as string[])?.[0] ?? undefined,
      phone: (data.phones as string[])?.[0] ?? undefined,
      description: (data.description as string) ?? undefined,
      specialties: (data.serviceKeywords as string[]) ?? [],
      sourceType: this.sourceType,
      sourceName: 'Company Website',
      sourceUrl: url,
    }
  }

  /**
   * Persist normalized records — update existing companies with enrichment data.
   */
  async persist(records: NormalizedRecord[]): Promise<PersistResult> {
    let updated = 0
    const errors: string[] = []

    for (const record of records) {
      try {
        // Find company by domain or name
        const existing = await db.company.findFirst({
          where: {
            OR: [
              record.domain ? { domain: record.domain } : {},
              { normalizedName: record.normalizedName },
            ].filter((c) => Object.keys(c).length > 0),
          },
        })
        if (!existing) {
          errors.push(`Company not found for: ${record.name}`)
          continue
        }
        await db.company.update({
          where: { id: existing.id },
          data: {
            lastEnrichedAt: new Date(),
            description: record.description || existing.description || undefined,
            email: record.email || existing.email || undefined,
            phone: record.phone || existing.phone || undefined,
            specialties:
              record.specialties && record.specialties.length > 0
                ? record.specialties
                : existing.specialties,
          },
        })
        updated++
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }

    return { created: 0, updated, skipped: 0, errors }
  }
}

export const companySiteAdapter = new CompanySiteAdapter()
