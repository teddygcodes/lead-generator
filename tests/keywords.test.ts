import { describe, it, expect } from 'vitest'
import { classifyText } from '../lib/enrichment/keywords'

describe('classifyText — empty/null input', () => {
  it('returns mixed with zero confidence for empty string', () => {
    const result = classifyText('')
    expect(result.segment).toBe('mixed')
    expect(result.confidence).toBe(0)
    expect(result.segments).toHaveLength(0)
    expect(result.matchedSpecialties).toHaveLength(0)
  })

  it('returns mixed with zero confidence for null', () => {
    const result = classifyText(null)
    expect(result.segment).toBe('mixed')
    expect(result.confidence).toBe(0)
  })

  it('returns mixed with zero confidence for undefined', () => {
    const result = classifyText(undefined)
    expect(result.segment).toBe('mixed')
    expect(result.confidence).toBe(0)
  })
})

describe('classifyText — industrial-dominant text', () => {
  const text = `
    We specialize in industrial electrical work including manufacturing plants,
    distribution centers, and production facilities. Our team installs switchgear,
    motor control centers (MCC), and VFD drives for plant automation and industrial maintenance.
  `

  it('classifies as industrial', () => {
    const result = classifyText(text)
    expect(result.segment).toBe('industrial')
    expect(result.segments).toContain('industrial')
  })

  it('detects switchgear specialty', () => {
    const result = classifyText(text)
    expect(result.matchedSpecialties).toContain('switchgear')
  })

  it('detects controls specialty via MCC/VFD', () => {
    const result = classifyText(text)
    expect(result.matchedSpecialties).toContain('controls')
  })

  it('detects industrial maintenance specialty', () => {
    const result = classifyText(text)
    expect(result.matchedSpecialties).toContain('industrial maintenance')
  })

  it('has non-zero confidence', () => {
    const result = classifyText(text)
    expect(result.confidence).toBeGreaterThan(0)
  })
})

describe('classifyText — residential-dominant text', () => {
  const text = `
    Family-owned electrical contractor serving residential homeowners.
    We handle single family new construction, home rewires, panel upgrades,
    and emergency service calls for houses and townhomes in Gwinnett County.
  `

  it('classifies as residential', () => {
    const result = classifyText(text)
    expect(result.segment).toBe('residential')
    expect(result.segments).toContain('residential')
  })

  it('does not classify as industrial', () => {
    const result = classifyText(text)
    expect(result.segments).not.toContain('industrial')
  })

  it('detects service specialty', () => {
    const result = classifyText(text)
    expect(result.matchedSpecialties).toContain('service')
  })
})

describe('classifyText — mixed text (commercial + industrial)', () => {
  const text = `
    We serve commercial office buildings, retail centers, and industrial facilities.
    Our services include tenant improvement, fire alarm systems, and distribution center
    electrical for clients across metro Atlanta.
  `

  it('classifies as mixed when multiple segments match', () => {
    const result = classifyText(text)
    expect(result.segment).toBe('mixed')
  })

  it('includes both commercial and industrial in segments', () => {
    const result = classifyText(text)
    expect(result.segments).toContain('commercial')
    expect(result.segments).toContain('industrial')
  })

  it('detects tenant improvement specialty', () => {
    const result = classifyText(text)
    expect(result.matchedSpecialties).toContain('tenant improvement')
  })

  it('detects fire alarm specialty', () => {
    const result = classifyText(text)
    expect(result.matchedSpecialties).toContain('fire alarm')
  })

  it('detects distribution center specialty', () => {
    const result = classifyText(text)
    expect(result.matchedSpecialties).toContain('distribution center')
  })
})

describe('classifyText — specialty detection', () => {
  it('detects generators from "standby power"', () => {
    const result = classifyText('We install standby power systems and backup generators.')
    expect(result.matchedSpecialties).toContain('generators')
  })

  it('detects EV charging', () => {
    const result = classifyText('We install level 2 EV charging stations and electric vehicle infrastructure.')
    expect(result.matchedSpecialties).toContain('EV charging')
  })

  it('detects healthcare specialty', () => {
    const result = classifyText('Electrical services for hospital and medical clinic facilities.')
    expect(result.matchedSpecialties).toContain('healthcare')
  })

  it('detects schools specialty', () => {
    const result = classifyText('K-12 school electrical renovations and elementary school new construction.')
    expect(result.matchedSpecialties).toContain('schools')
  })

  it('detects low voltage specialty', () => {
    const result = classifyText('Structured cabling, access control, and CCTV installation.')
    expect(result.matchedSpecialties).toContain('low voltage')
  })

  it('detects panelboards', () => {
    const result = classifyText('Panelboard installation and load center upgrades.')
    expect(result.matchedSpecialties).toContain('panelboards')
  })
})
