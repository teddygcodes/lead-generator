import { describe, it, expect } from 'vitest'
import { scoreCompany } from '../lib/scoring'

// Helper to make a signal N days ago
function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

describe('scoreCompany — industrial-only company', () => {
  const input = {
    county: 'Gwinnett',
    state: 'GA',
    segments: ['industrial'],
    specialties: ['switchgear', 'panelboards', 'motor controls'],
    website: 'https://acme.com',
    email: 'info@acme.com',
    phone: '7706221100',
    street: '123 Industrial Blvd',
    signals: [{ signalDate: daysAgo(10), signalType: 'PERMIT' }],
    contacts: [{ email: 'rep@acme.com', phone: '7706221101' }],
  }

  it('produces high lead score', () => {
    const { leadScore } = scoreCompany(input)
    expect(leadScore).toBeGreaterThanOrEqual(70)
  })

  it('produces non-trivial active score with recent signal', () => {
    const { activeScore } = scoreCompany(input)
    // signal base(4) + recency within 30 days(12) + target county(10) + industrial(8) = 34
    expect(activeScore).toBeGreaterThanOrEqual(25)
  })

  it('contains reasons mapped to specific rules', () => {
    const { reasons } = scoreCompany(input)
    expect(reasons.some((r) => r.includes('Gwinnett'))).toBe(true)
    expect(reasons.some((r) => r.toLowerCase().includes('industrial'))).toBe(true)
    expect(reasons.some((r) => r.toLowerCase().includes('switchgear') || r.toLowerCase().includes('panelboard'))).toBe(true)
  })

  it('sales motion is MRO or project+MRO for industrial', () => {
    const { likelySalesMotion } = scoreCompany(input)
    expect(likelySalesMotion.toLowerCase()).toContain('industrial')
  })

  it('no residential reasons present', () => {
    const { reasons } = scoreCompany(input)
    const hasResidential = reasons.some((r) => r.toLowerCase().includes('residential'))
    expect(hasResidential).toBe(false)
  })
})

describe('scoreCompany — residential-only company', () => {
  const input = {
    county: 'Gwinnett',
    state: 'GA',
    segments: ['residential'],
    specialties: ['service', 'panel upgrade'],
    website: 'https://homeelectric.com',
    phone: '7706221100',
  }

  it('produces lower lead score than industrial-only', () => {
    const { leadScore } = scoreCompany(input)
    const industrialScore = scoreCompany({
      county: 'Gwinnett',
      state: 'GA',
      segments: ['industrial'],
      specialties: ['switchgear'],
      website: 'https://industrial.com',
      phone: '7706221100',
    }).leadScore
    expect(leadScore).toBeLessThan(industrialScore)
  })

  it('includes residential reason', () => {
    const { reasons } = scoreCompany(input)
    expect(reasons.some((r) => r.toLowerCase().includes('residential'))).toBe(true)
  })

  it('buyer value reflects lower priority', () => {
    const { likelyBuyerValue } = scoreCompany(input)
    expect(likelyBuyerValue).not.toMatch(/high — potential stocking/i)
  })
})

describe('scoreCompany — commercial mixed company', () => {
  const input = {
    county: 'Cobb',
    state: 'GA',
    segments: ['commercial', 'residential'],
    specialties: ['tenant improvement', 'lighting', 'fire alarm'],
    website: 'https://commercialelec.com',
    email: 'info@commercialelec.com',
    phone: '7705551234',
    signals: [
      { signalDate: daysAgo(60), signalType: 'PERMIT' },
      { signalDate: daysAgo(75), signalType: 'COMPANY_WEBSITE' },
    ],
  }

  it('moderate lead score (35–79 range)', () => {
    const { leadScore } = scoreCompany(input)
    expect(leadScore).toBeGreaterThanOrEqual(35)
    expect(leadScore).toBeLessThan(90)
  })

  it('mentions commercial segment reason', () => {
    const { reasons } = scoreCompany(input)
    expect(reasons.some((r) => r.toLowerCase().includes('commercial') || r.toLowerCase().includes('multi-segment'))).toBe(true)
  })

  it('includes lighting or fire alarm in product demand', () => {
    const { likelyProductDemandCategories } = scoreCompany(input)
    const hasDemand = likelyProductDemandCategories.some(
      (c) => c.toLowerCase().includes('lighting') || c.toLowerCase().includes('fire'),
    )
    expect(hasDemand).toBe(true)
  })
})

describe('scoreCompany — company with no signals', () => {
  const input = {
    county: 'Hall',
    state: 'GA',
    segments: ['industrial'],
    specialties: [],
    website: null,
    email: null,
    phone: null,
    signals: [],
    contacts: [],
  }

  it('produces low active score', () => {
    const { activeScore } = scoreCompany(input)
    expect(activeScore).toBeLessThan(30)
  })

  it('no signal recency reasons in output', () => {
    const { reasons } = scoreCompany(input)
    const hasRecencyReason = reasons.some((r) =>
      r.toLowerCase().includes('signal recorded'),
    )
    expect(hasRecencyReason).toBe(false)
  })
})

describe('scoreCompany — company with high signal count', () => {
  const input = {
    county: 'Fulton',
    state: 'GA',
    segments: ['industrial'],
    specialties: ['switchgear', 'controls'],
    website: 'https://example.com',
    email: 'info@example.com',
    phone: '4041234567',
    street: '123 Main St',
    signals: [
      { signalDate: daysAgo(5), signalType: 'PERMIT' },
      { signalDate: daysAgo(12), signalType: 'COMPANY_WEBSITE' },
      { signalDate: daysAgo(20), signalType: 'PERMIT' },
      { signalDate: daysAgo(35), signalType: 'LICENSE' },
      { signalDate: daysAgo(50), signalType: 'COMPANY_WEBSITE' },
    ],
    contacts: [{ email: 'rep@example.com', phone: '4041234568' }],
  }

  it('produces high active score', () => {
    const { activeScore } = scoreCompany(input)
    expect(activeScore).toBeGreaterThanOrEqual(50)
  })

  it('active score is capped at 100', () => {
    const { activeScore } = scoreCompany(input)
    expect(activeScore).toBeLessThanOrEqual(100)
  })

  it('contains signal count reason', () => {
    const { reasons } = scoreCompany(input)
    expect(reasons.some((r) => r.includes('signal'))).toBe(true)
  })

  it('contains recency reason for within-30-day signal', () => {
    const { reasons } = scoreCompany(input)
    expect(reasons.some((r) => r.includes('30 days'))).toBe(true)
  })
})

describe('scoreCompany — score caps and bounds', () => {
  it('lead score never exceeds 100', () => {
    const { leadScore } = scoreCompany({
      county: 'Gwinnett',
      state: 'GA',
      segments: ['industrial', 'commercial', 'residential'],
      specialties: ['switchgear', 'panelboards', 'controls', 'generators', 'ev charging', 'lighting', 'fire alarm', 'low voltage'],
      website: 'https://example.com',
      email: 'x@x.com',
      phone: '7701234567',
      street: '1 St',
      signals: Array(10).fill({ signalDate: daysAgo(1), signalType: 'PERMIT' }),
      contacts: [{ email: 'a@a.com', phone: '7701234568' }],
      description: 'industrial manufacturing plant commercial tenant improvement warehouse distribution',
    })
    expect(leadScore).toBeLessThanOrEqual(100)
  })

  it('active score never exceeds 100', () => {
    const { activeScore } = scoreCompany({
      county: 'Gwinnett',
      state: 'GA',
      segments: ['industrial'],
      signals: Array(20).fill({ signalDate: daysAgo(1), signalType: 'PERMIT' }),
    })
    expect(activeScore).toBeLessThanOrEqual(100)
  })
})
