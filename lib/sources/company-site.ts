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
      // companyId carried through so normalize() → persist() can do exact ID lookup
      rawData: { ...result.payload, companyName: company.name, companyId },
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
      // companyId carries the DB company ID through to persist() for exact lookup
      companyId: (data.companyId as string) ?? undefined,
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
   * Persist normalized records — update existing companies and create WEBSITE_CONTENT signals.
   *
   * Guards:
   * - Thin-extraction guard: skip if no meaningful content extracted (no description, no
   *   specialties, no email, no phone) — avoids noisy signals for empty enrichments.
   * - Domain dedup: skip if a WEBSITE_CONTENT signal already exists for the same company +
   *   canonical domain within the last 30 days (exact hostname match, not substring).
   */
  async persist(records: NormalizedRecord[]): Promise<PersistResult> {
    let updated = 0
    let skipped = 0
    const errors: string[] = []

    for (const record of records) {
      try {
        // Thin-extraction guard — don't create signal noise for empty enrichments
        const isThin =
          !record.description &&
          (!record.specialties || record.specialties.length === 0) &&
          !record.email &&
          !record.phone
        if (isThin) {
          skipped++
          continue
        }

        // Prefer exact ID lookup when known (set by fetchDetails); fall back to domain/name
        const existing = record.companyId
          ? await db.company.findUnique({ where: { id: record.companyId } })
          : await db.company.findFirst({
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

        // Canonical domain: lowercase hostname, www. stripped (e.g. "example.com")
        const rawUrl = record.website ?? record.sourceUrl ?? ''
        const canonicalDomain = extractDomain(rawUrl)

        // Domain-level dedup: skip if a WEBSITE_CONTENT signal for this company + domain exists
        // in the last 30 days. Exact hostname compare — "notexample.com" ≠ "example.com".
        // JSON-path dedup for canonicalDomain confirmed working in this repo's Prisma v5 + Postgres
        // setup for this specific query shape; Signal.externalId fallback not needed here.
        if (canonicalDomain) {
          const thirtyDaysAgo = new Date()
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
          const dupSignal = await db.signal.findFirst({
            where: {
              companyId: existing.id,
              signalType: 'WEBSITE_CONTENT',
              createdAt: { gte: thirtyDaysAgo },
              metadata: {
                path: ['canonicalDomain'],
                equals: canonicalDomain,
              },
            },
          })
          if (dupSignal) {
            skipped++
            continue
          }
        }

        // Update company with enriched data
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

        // Normalize URL for signal: lowercase host, strip www., strip trailing slash
        let normalizedUrl: string | undefined
        if (rawUrl) {
          try {
            const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
            const host = u.hostname.replace(/^www\./i, '').toLowerCase()
            const path = u.pathname.replace(/\/+$/, '')
            normalizedUrl = `${u.protocol}//${host}${path}`
          } catch {
            normalizedUrl = rawUrl
          }
        }

        // Create WEBSITE_CONTENT signal
        await db.signal.create({
          data: {
            companyId: existing.id,
            sourceType: 'COMPANY_WEBSITE',
            sourceName: 'Company Website',
            sourceUrl: normalizedUrl ?? undefined,
            signalType: 'WEBSITE_CONTENT',
            signalDate: new Date(),
            title: `Website enriched — ${canonicalDomain}`,
            snippet: (record.description ?? '').slice(0, 200),
            relevanceScore: 0.5,
            metadata: {
              canonicalDomain,
              liveMode: true,
            },
          },
        })

        updated++
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }

    return { created: 0, updated, skipped, errors }
  }
}

export const companySiteAdapter = new CompanySiteAdapter()
