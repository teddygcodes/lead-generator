/**
 * Google Places API (New) — business profile lookup.
 * Uses Text Search to find electrical contractors by name + location.
 * Returns structured data: phone, website, rating, categories.
 * Requires GOOGLE_PLACES_API_KEY with "Places API (New)" enabled in Google Cloud Console.
 */

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? ''

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.types',
  'places.businessStatus',
  'places.googleMapsUri',
].join(',')

export interface PlaceResult {
  placeId: string
  name: string
  phone: string | null
  website: string | null
  formattedAddress: string | null
  rating: number | null
  userRatingCount: number | null
  types: string[]
  businessStatus: string | null
  googleMapsUri: string | null
}

export function isGooglePlacesConfigured(): boolean {
  return Boolean(GOOGLE_PLACES_API_KEY)
}

/**
 * Search Google Places for a company by name + location.
 * Returns the top result or null if not found.
 */
export async function findPlaceForCompany(
  name: string,
  city: string | null,
  state: string | null,
): Promise<PlaceResult | null> {
  if (!isGooglePlacesConfigured()) return null

  const location = [city, state].filter(Boolean).join(', ')
  const textQuery = location ? `${name} ${location}` : name

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({ textQuery, maxResultCount: 1 }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) return null
    const data = await res.json()
    const place = data.places?.[0]
    if (!place) return null

    return {
      placeId: place.id ?? '',
      name: place.displayName?.text ?? name,
      phone: place.nationalPhoneNumber ?? null,
      website: place.websiteUri ?? null,
      formattedAddress: place.formattedAddress ?? null,
      rating: place.rating ?? null,
      userRatingCount: place.userRatingCount ?? null,
      types: place.types ?? [],
      businessStatus: place.businessStatus ?? null,
      googleMapsUri: place.googleMapsUri ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Build a plain-text summary of a Places result for AI enrichment.
 */
export function buildPlaceText(place: PlaceResult, companyName: string): string {
  const lines: string[] = [`Company: ${companyName}`]

  if (place.businessStatus) {
    lines.push(`Business status: ${place.businessStatus}`)
  }
  if (place.types.length > 0) {
    const readable = place.types.map((t) => t.replace(/_/g, ' ')).join(', ')
    lines.push(`Business categories: ${readable}`)
  }
  if (place.formattedAddress) {
    lines.push(`Address: ${place.formattedAddress}`)
  }
  if (place.phone) {
    lines.push(`Phone: ${place.phone}`)
  }
  if (place.website) {
    lines.push(`Website: ${place.website}`)
  }
  if (place.rating !== null && place.userRatingCount !== null) {
    lines.push(`Google rating: ${place.rating}/5 (${place.userRatingCount} reviews)`)
  }
  if (place.googleMapsUri) {
    lines.push(`Google Maps: ${place.googleMapsUri}`)
  }

  return lines.join('\n')
}
