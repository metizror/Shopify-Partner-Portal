import { NextRequest, NextResponse } from 'next/server'
import { runJobByName } from '@/services/jobs'
import { requireDashboardPassword } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = requireDashboardPassword(req)
  if (auth) return auth

  const { name } = await params
  const jobName = String(name || '')
  let opts: Record<string, any> | undefined
  try { opts = await req.json() } catch { /* no body — fine */ }
  try {
    const result = await runJobByName(jobName, opts)
    return NextResponse.json({ ok: true, name: jobName, result })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, name: jobName, error: err.message || String(err) },
      { status: 500 },
    )
  }
}
