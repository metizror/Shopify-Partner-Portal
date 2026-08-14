import { NextRequest, NextResponse } from 'next/server'
import { markOpenedByToken } from '@/services/sequences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 1x1 transparent GIF.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

// GET /api/track/open?t=<token> — the open-tracking pixel embedded in every
// sequence email. Unauthenticated by design (email clients fetch it); the
// token is a 48-char random secret unique per contact, so it can't be guessed
// or enumerated. Always returns the pixel, even for unknown tokens.
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('t') || ''
  try { await markOpenedByToken(token) } catch { /* never block the pixel */ }
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
