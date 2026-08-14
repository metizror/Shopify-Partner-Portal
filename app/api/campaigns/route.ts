import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { createCampaign } from '@/services/campaigns'
import { detectEmailColumn } from '@/lib/campaign'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/campaigns — list campaigns (newest first, no recipient rows).
export async function GET() {
  const rows = await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json(rows.map((c) => ({
    id: c.id,
    name: c.name,
    fileName: c.fileName,
    status: c.status,
    totalCount: c.totalCount,
    sentCount: c.sentCount,
    failedCount: c.failedCount,
    scheduledAt: c.scheduledAt?.toISOString() || null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  })))
}

// POST /api/campaigns  body: { name, fileName, sheetName?, headers[], rows[], emailColumn?, createdBy? }
// Persists a parsed sheet as a campaign + recipients so it can be emailed.
export async function POST(req: NextRequest) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth
  try {
    const b = await req.json().catch(() => ({}))
    const headers: string[] = Array.isArray(b.headers) ? b.headers.map(String) : []
    const rows: Record<string, any>[] = Array.isArray(b.rows) ? b.rows : []
    if (!headers.length) return NextResponse.json({ error: 'headers required' }, { status: 400 })
    if (!rows.length) return NextResponse.json({ error: 'rows required' }, { status: 400 })
    if (rows.length > 50000) return NextResponse.json({ error: 'too many rows (max 50,000)' }, { status: 400 })

    const emailColumn = b.emailColumn && headers.includes(b.emailColumn)
      ? b.emailColumn
      : detectEmailColumn(headers)

    const campaign = await createCampaign({
      name: String(b.name || b.fileName || 'Untitled campaign').slice(0, 255),
      fileName: String(b.fileName || 'sheet').slice(0, 255),
      sheetName: b.sheetName ? String(b.sheetName) : undefined,
      headers,
      emailColumn,
      rows,
      createdBy: b.createdBy ? String(b.createdBy) : null,
    })
    return NextResponse.json({ ok: true, id: campaign.id, emailColumn })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
