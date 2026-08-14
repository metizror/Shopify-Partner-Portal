// The single source of truth for how a template becomes a real email.
//
// Both the client-side Preview (Email → Templates / Layouts) and the server-side
// send path (services/email.ts → Brevo) call composeEmailHtml(), so what you see
// in the preview pane is byte-for-byte what lands in the inbox. Client-safe: no
// prisma, no node imports.

export const SAMPLE_VARS: Record<string, string> = {
  name: 'Acme Store', store: 'Acme Store', storeName: 'Acme Store',
  domain: 'acme-store.myshopify.com', app: 'Store Locator', appName: 'Store Locator',
  country: 'United States', plan: 'Business Plan', mrr: '19.99', ltv: '239.88',
  email: 'owner@acme-store.com',
}

/** Merge tags a template author can use — shown under the editor. */
export const MERGE_TAGS = ['name', 'app', 'domain', 'country', 'plan', 'mrr', 'ltv', 'email'] as const

/** Replace {{ key }} tokens from a flat vars map (unknown keys → ''). */
export function applyVars(str: string, vars: Record<string, string> = {}): string {
  if (!str) return ''
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (k in vars ? String(vars[k] ?? '') : ''))
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Wrap header/body/footer in the email shell. Inline styles only — email
 *  clients strip <style> blocks and classes. */
export function composeEmailHtml(parts: {
  header?: string
  body: string
  footer?: string
  vars?: Record<string, string>
}): string {
  const v = parts.vars
  const header = applyVars(parts.header || '', v)
  const body = applyVars(parts.body || '', v)
  const footer = applyVars(parts.footer || '', v)
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
${header ? `<tr><td>${header}</td></tr>` : ''}
<tr><td style="padding:24px;font-family:${FONT};font-size:15px;line-height:1.6;color:#1f2328;">${body}</td></tr>
${footer ? `<tr><td>${footer}</td></tr>` : ''}
</table>
</td></tr>
</table>
</body></html>`
}
