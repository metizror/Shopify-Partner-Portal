import { brandName, bookingUrl } from '@/services/brand'

export interface InstallEvent {
  app_id: string
  app_name: string
  org: string
  store_name: string
  store_url: string
  email: string
  time: string
  welcome_status?: 'sent' | 'failed' | 'no_email'
  /**
   * App Store handle, e.g. "easy-shipping-bar", from the ShopifyApp row. Used
   * only to link the listing; omitted means no link, which is why this is
   * optional rather than a hardcoded slug table keyed by app id.
   */
  app_handle?: string | null
}

export interface UninstallEvent extends InstallEvent {
  plan_name?: string
  plan_amount?: number
  installed_at?: string
  reason?: string
  description?: string
}

// 1:1 port of send_install_email in Python
export function buildInstallEmail(event: InstallEvent): { subject: string; html: string } {
  const subject = `🟢 New Install — ${event.app_name} — ${event.store_name}`

  const slug = event.app_handle
  const appStoreLink = slug
    ? `<a href="https://apps.shopify.com/${slug}" style="color:#1d4ed8">View on App Store</a>`
    : ''

  let welcomeRow = '<span style="color:#9ca3af">—</span>'
  if (event.welcome_status === 'sent') {
    welcomeRow = `<span style="color:#059669;font-weight:bold">✅ Sent</span> to ${event.email || ''}`
  } else if (event.welcome_status === 'failed') {
    welcomeRow = '<span style="color:#dc2626">❌ Failed</span> — Brevo send error'
  } else if (event.welcome_status === 'no_email') {
    welcomeRow = '<span style="color:#9ca3af">⚠ Skipped</span> — store email not available'
  }

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#111827;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#ecfdf5;border:2px solid #059669;border-radius:12px;padding:20px;margin-bottom:20px">
    <h2 style="color:#059669;margin:0 0 4px">🟢 New App Install</h2>
    <p style="color:#6b7280;margin:0;font-size:12px">${event.time}</p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold;width:140px">App Name</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.app_name}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Organisation</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.org}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store Name</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.store_name}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store URL</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb"><a href="https://${event.store_url}" style="color:#1d4ed8">${event.store_url}</a></td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store Email</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.email || '<span style="color:#9ca3af">Not available</span>'}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Installed At</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.time}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Welcome Email</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${welcomeRow}</td></tr>
  </table>

  ${appStoreLink ? `<p style="font-size:12px">${appStoreLink}</p>` : ''}

  ${bookingUrl() ? `<div style="background:#f0f9ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:20px 0">
    <h3 style="color:#1e40af;margin:0 0 8px;font-size:15px">📅 Action: Send Demo Invitation</h3>
    <p style="color:#374151;margin:0 0 12px;font-size:13px">
      This merchant just installed <b>${event.app_name}</b>. Consider reaching out with a personalized demo.
    </p>
    <div style="text-align:center">
      <a href="${bookingUrl()}"
         style="display:inline-block;background:#1d4ed8;color:#ffffff;
                padding:10px 24px;border-radius:8px;text-decoration:none;
                font-weight:bold;font-size:13px">
        Book a Demo
      </a>
    </div>
  </div>` : ''}

  <p style="color:#9ca3af;font-size:11px;margin-top:20px">Auto-generated · Shopify Partner API · ${brandName()}</p>
</body>
</html>`

  return { subject, html }
}

// 1:1 port of send_uninstall_email in Python
export function buildUninstallEmail(event: UninstallEvent): { subject: string; html: string } {
  const subject = `🔴 Uninstall — ${event.app_name} — ${event.store_name}`

  const planInfo = event.plan_name || 'Free'
  const planAmount = event.plan_amount || 0

  let duration = ''
  if (event.installed_at) {
    try {
      const inst = new Date(event.installed_at)
      const days = Math.floor((Date.now() - inst.getTime()) / (1000 * 60 * 60 * 24))
      if (days > 365) {
        duration = `${Math.floor(days / 365)} year(s), ${Math.floor((days % 365) / 30)} month(s)`
      } else if (days > 30) {
        duration = `${Math.floor(days / 30)} month(s), ${days % 30} day(s)`
      } else {
        duration = `${days} day(s)`
      }
    } catch {
      duration = 'Unknown'
    }
  }

  const feedbackRow = event.description
    ? `<tr><td style="padding:8px 12px;background:#fef2f2;border:1px solid #e5e7eb;font-weight:bold;color:#dc2626">Feedback</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-style:italic;color:#374151">${event.description}</td></tr>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#111827;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#fef2f2;border:2px solid #dc2626;border-radius:12px;padding:20px;margin-bottom:20px">
    <h2 style="color:#dc2626;margin:0 0 4px">🔴 App Uninstalled</h2>
    <p style="color:#6b7280;margin:0;font-size:12px">${event.time}</p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold;width:140px">App Name</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.app_name}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Organisation</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.org}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store Name</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.store_name}</td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store URL</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb"><a href="https://${event.store_url}" style="color:#1d4ed8">${event.store_url}</a></td></tr>
    <tr><td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:bold">Store Email</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.email || '<span style="color:#9ca3af">Not available</span>'}</td></tr>
    <tr><td style="padding:8px 12px;background:#fef2f2;border:1px solid #e5e7eb;font-weight:bold;color:#dc2626">Plan Used</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb"><b>${planInfo}</b>${planAmount > 0 ? ` ($${planAmount}/mo)` : ''}</td></tr>
    <tr><td style="padding:8px 12px;background:#fef2f2;border:1px solid #e5e7eb;font-weight:bold;color:#dc2626">Duration Used</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${duration || 'Unknown'}</td></tr>
    <tr><td style="padding:8px 12px;background:#fef2f2;border:1px solid #e5e7eb;font-weight:bold;color:#dc2626">Uninstalled At</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.time}</td></tr>
    <tr><td style="padding:8px 12px;background:#fef2f2;border:1px solid #e5e7eb;font-weight:bold;color:#dc2626">Reason</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${event.reason || '<span style="color:#9ca3af">Not provided</span>'}</td></tr>
    ${feedbackRow}
  </table>

  <p style="color:#9ca3af;font-size:11px;margin-top:20px">Auto-generated · Shopify Partner API · ${brandName()}</p>
</body>
</html>`

  return { subject, html }
}

// 1:1 port of send_welcome_email in Python
export function buildWelcomeEmail(appName: string): { subject: string; html: string } {
  const subject = `Welcome to ${appName} - Book Onboarding Session`
  const html = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;margin:0 auto;padding:20px">

<p>Hello,</p>

<p>Welcome onboard! We are excited to have you with us.</p>

<p>Thank you for choosing our <b>${appName}</b>. To help you get started smoothly and make the most of all available features, we would be happy to walk you through a quick demo of the setup and functionality.</p>

<p><b>During the demo, we will cover:</b></p>
<ul>
  <li>Complete setup process</li>
  <li>Key features and how to use them effectively</li>
  <li>Best practices to optimise your experience</li>
  <li>Answers to any questions you may have</li>
</ul>

<p>Please feel free to let us know a convenient time for you, and we will schedule the session accordingly.</p>

<p>We look forward to supporting you and ensuring a seamless experience.</p>

${bookingUrl() ? `<p style="margin:24px 0">
  <a href="${bookingUrl()}"
     style="background:#1d4ed8;color:#ffffff;padding:12px 28px;border-radius:6px;
            text-decoration:none;font-weight:bold;font-size:14px">Book Onboarding Session</a>
</p>` : ''}

<p>Best regards,<br>${brandName()}<br>Shopify App Partner</p>

</body>
</html>`
  return { subject, html }
}
