import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { searchPlaces, isGooglePlacesConfigured } from '@/lib/sources/google-places'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isGooglePlacesConfigured()) {
    return NextResponse.json(
      { error: 'GOOGLE_PLACES_NOT_CONFIGURED' },
      { status: 503 },
    )
  }

  const { searchParams } = new URL(req.url)
  const query = searchParams.get('query')?.trim()
  const pageToken = searchParams.get('pageToken') ?? undefined

  if (!query) {
    return NextResponse.json({ error: 'query parameter is required' }, { status: 400 })
  }

  try {
    const { results, nextPageToken } = await searchPlaces(query, pageToken)
    return NextResponse.json({ results, nextPageToken })
  } catch (err) {
    console.error('[places/search] error:', err)
    return NextResponse.json({ error: 'Failed to search Google Places' }, { status: 500 })
  }
}
