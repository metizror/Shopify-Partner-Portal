import { NextRequest, NextResponse } from 'next/server'
import { listCustomers, customerFacets } from '@/services/customers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET /api/customers?search=&status=&appId=&tag=&country=&minMrr=&sort=&dir=&page=&pageSize=&facets=1
export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams
    const result = await listCustomers({
      search: q.get('search'),
      status: q.get('status'),
      appId: q.get('appId'),
      tag: q.get('tag'),
      country: q.get('country'),
      minMrr: q.get('minMrr') ? Number(q.get('minMrr')) : null,
      sort: q.get('sort'),
      dir: (q.get('dir') as 'asc' | 'desc') || null,
      page: q.get('page') ? Number(q.get('page')) : 1,
      pageSize: q.get('pageSize') ? Number(q.get('pageSize')) : 25,
    })
    const facets = q.get('facets') ? await customerFacets() : undefined
    return NextResponse.json({ ...result, facets })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
