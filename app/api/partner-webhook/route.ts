import { NextRequest, NextResponse } from 'next/server'
import { appInfoForAsync, persistAppEvent, sendInstallEmails, sendUninstallEmails } from '@/services/partner-notify'
import { runFlowsForTrigger } from '@/services/flow-engine'
import { enrollTriggeredSequences } from '@/services/sequences'
import { captureUninstallSnapshot } from '@/services/uninstall-enrichment'

// Fire schedule-less automation flows for a real event. Best-effort: a flow
// failure must never fail the webhook. A reinstall is just an install — it fires
// customer_installs like any other, so a returning store gets exactly one email.
async function fireFlows(
  kind: 'installed' | 'uninstalled',
  appId: string,
  domain: string,
  name: string,
  occurredAt: string,
) {
  try {
    const trigger = kind === 'uninstalled' ? 'customer_uninstalls' : 'customer_installs'
    await runFlowsForTrigger({ trigger, appId, domain, storeName: name, occurredAt })
  } catch (e) {
    console.error('Webhook flow error:', e)
  }
  // Same event also feeds any armed merchant sequence.
  try {
    await enrollTriggeredSequences({
      trigger: kind === 'uninstalled' ? 'uninstall' : 'install',
      appId, domain, storeName: name, occurredAt,
    })
  } catch (e) {
    console.error('Webhook sequence error:', e)
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Inbound install/uninstall webhook. Each Shopify app's backend may POST here
// (see docs/webhook-integration.md). Events are also picked up automatically by
// the token-based poller (services/partner-event-poller.ts) — both paths share
// the same persist + email logic in services/partner-notify.ts and dedupe on a
// deterministic event key, so a store is never double-counted or double-mailed.
/**
 * Shared-secret gate. This endpoint has to stay reachable without a session —
 * each app's backend posts here and has no cookie jar — so a secret in the URL
 * or a header is the only thing standing between a stranger and injecting fake
 * install/uninstall events, which persist to the DB and mail real merchants.
 *
 * Unset means accept-all, matching the Brevo webhook's posture so setting it is
 * a rollout choice rather than a breaking change: deploy first, update each app
 * backend to send the token, then set PARTNER_WEBHOOK_SECRET to start enforcing.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.PARTNER_WEBHOOK_SECRET || ''
  if (!secret) return true
  const token = req.nextUrl.searchParams.get('token') || req.headers.get('x-webhook-token') || ''
  return token === secret
}

export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'partner-webhook' })
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))

    const eventType = body.type || body.event || ''
    const appId = String(body.app_id || body.app?.id || '')
    const storeDomain = body.store_domain || body.myshopify_domain || body.shop?.myshopify_domain || ''
    const storeName = body.store_name || body.shop_name || body.shop?.name || storeDomain
    const occurredAt = body.occurred_at || new Date().toISOString()
    const info = await appInfoForAsync(appId)

    const isInstall = eventType.toLowerCase().includes('install') && !eventType.toLowerCase().includes('uninstall')
    const isUninstall = eventType.toLowerCase().includes('uninstall')

    if (isInstall) {
      // Only email on the first delivery for this exact event.
      const isNew = await persistAppEvent('installed', appId, storeDomain, storeName, occurredAt, 'webhook')
      let email_found = false
      if (isNew) {
        const r = await sendInstallEmails(appId, storeDomain, storeName, occurredAt)
        email_found = !!r.emailFound
        await fireFlows('installed', appId, storeDomain, storeName, occurredAt)
      }
      return NextResponse.json({ status: 'ok', event: 'install', app: info.name, store: storeDomain, new: isNew, email_found })
    }

    if (isUninstall) {
      const isNew = await persistAppEvent('uninstalled', appId, storeDomain, storeName, occurredAt, 'webhook')
      if (isNew) {
        // Same enrichment as the poller path, so both ingest routes give Flow
        // emails identical merge-tag data. Best-effort — never fail the webhook.
        try {
          await captureUninstallSnapshot({
            appId,
            domain: storeDomain,
            occurredAt,
            reason: body.reason || body.uninstall_reason || null,
            description: body.description || body.reason_detail || null,
          })
        } catch (e) {
          console.error('Webhook enrichment error:', e)
        }
        await sendUninstallEmails(appId, storeDomain, storeName, occurredAt)
        await fireFlows('uninstalled', appId, storeDomain, storeName, occurredAt)
      }
      return NextResponse.json({ status: 'ok', event: 'uninstall', app: info.name, store: storeDomain, new: isNew })
    }

    return NextResponse.json({ status: 'ignored', event: eventType })
  } catch (err: any) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 })
  }
}
