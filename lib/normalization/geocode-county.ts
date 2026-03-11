/**
 * Geocoding API fallback: resolve county for a GA company whose city is not in the static map.
 * Uses the Google Maps Geocoding API.
 * Returns null if the API is not configured, address is insufficient, or county is not found.
 *
 * Key: GOOGLE_MAPS_API_KEY or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (already in .env.local).
 * IMPORTANT: Ensure "Geocoding API" is enabled in Google Cloud Console — it's a separate
 * toggle from the Places API, even on the same key.
 */
export async function geocodeCountyFromAddress(params: {
  city: string | null | undefined
  state: string | null | undefined
  street?: string | null
  zip?: string | null
}): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey || !params.city) return null

  const addressParts = [
    params.street,
    params.city,
    params.state ?? 'GA',
    params.zip,
    'USA',
  ].filter(Boolean).join(', ')

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressParts)}&key=${apiKey}`
    const res = await fetch(url)
    if (!res.ok) return null

    const data = (await res.json()) as {
      results: Array<{
        address_components: Array<{ long_name: string; types: string[] }>
      }>
    }

    const result = data.results[0]
    if (!result) return null

    const countyComponent = result.address_components.find((c) =>
      c.types.includes('administrative_area_level_2'),
    )
    if (!countyComponent) return null

    // Google returns "Fulton County" — strip the " County" suffix to match our convention
    const county = countyComponent.long_name.replace(/\s+County$/i, '').trim()
    return county || null
  } catch (err) {
    console.warn('[geocodeCountyFromAddress] failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}
