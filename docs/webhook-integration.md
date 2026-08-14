# Forwarding install / uninstall events to the dashboard

Each Shopify app must POST to the dashboard's webhook endpoint when a store
**installs** (after OAuth completes) or **uninstalls** (in the `app/uninstalled`
webhook). The dashboard stores the event and increments the live counts shown on
the **Shopify → Partners** page and each app's detail page.

## Endpoint

```
POST  https://<your-dashboard-domain>/api/partner-webhook
Content-Type: application/json
```

- Production: your deployed dashboard URL.
- Local testing: the cloudflared/ngrok tunnel URL.

## Payload

```json
{
  "type": "install",                 // or "uninstall"
  "app_id": "1533025",               // the numeric Partner app id (per app)
  "store_domain": "store.myshopify.com",
  "store_name": "Store Name",        // optional
  "occurred_at": "2026-06-26T16:00:00Z"  // ISO 8601; defaults to now if omitted
}
```

`app_id` is your app's **Partner app id** (the number in the Partner Dashboard
URL, e.g. `1533025`). Hard-code it per app.

---

## Node.js (works in Remix, Express, Koa, etc.)

Shared helper — put in e.g. `lib/notifyDashboard.js`:

```js
const DASHBOARD_WEBHOOK_URL =
  process.env.DASHBOARD_WEBHOOK_URL || 'https://<your-dashboard-domain>/api/partner-webhook'
const APP_ID = process.env.PARTNER_APP_ID // e.g. '1533025'

/** Fire-and-forget: never let this break the install/uninstall flow. */
export async function notifyDashboard(type, shopDomain, shopName) {
  try {
    await fetch(DASHBOARD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,                              // 'install' | 'uninstall'
        app_id: APP_ID,
        store_domain: shopDomain,
        store_name: shopName || shopDomain,
        occurred_at: new Date().toISOString(),
      }),
    })
  } catch (e) {
    console.error('notifyDashboard failed:', e)
  }
}
```

### Install — call after OAuth succeeds

Shopify **Remix** app (`app/shopify.server.js` → `afterAuth` hook):

```js
import { notifyDashboard } from './lib/notifyDashboard'

const shopify = shopifyApp({
  // ...your existing config...
  hooks: {
    afterAuth: async ({ session }) => {
      shopify.registerWebhooks({ session })
      // session.shop = 'store.myshopify.com'
      await notifyDashboard('install', session.shop)
    },
  },
})
```

Plain **Express** (in your OAuth callback route, after you get the token):

```js
app.get('/auth/callback', async (req, res) => {
  // ...exchange code for token, save session...
  const shop = req.query.shop // 'store.myshopify.com'
  await notifyDashboard('install', shop)
  res.redirect('/')
})
```

### Uninstall — in the `app/uninstalled` webhook handler

```js
// however your framework receives the app/uninstalled webhook:
async function handleAppUninstalled(shopDomain) {
  // ...your cleanup (delete session, etc.)...
  await notifyDashboard('uninstall', shopDomain)
}
```

Remix template: add `APP_UNINSTALLED` to your webhook handlers and call
`notifyDashboard('uninstall', shop)` inside it.

---

## PHP (Laravel / vanilla)

```php
function notifyDashboard(string $type, string $shopDomain, ?string $shopName = null): void {
    $url   = getenv('DASHBOARD_WEBHOOK_URL') ?: 'https://<your-dashboard-domain>/api/partner-webhook';
    $appId = getenv('PARTNER_APP_ID'); // e.g. '1533025'
    $payload = json_encode([
        'type'         => $type,                 // 'install' | 'uninstall'
        'app_id'       => $appId,
        'store_domain' => $shopDomain,
        'store_name'   => $shopName ?: $shopDomain,
        'occurred_at'  => gmdate('c'),
    ]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);
    curl_exec($ch);
    curl_close($ch);
}

// Install: after OAuth completes
notifyDashboard('install', $shopDomain);

// Uninstall: inside the app/uninstalled webhook handler
notifyDashboard('uninstall', $shopDomain);
```

---

## Notes

- **Fire-and-forget:** wrap in try/catch so a dashboard hiccup never breaks the
  merchant's install/uninstall.
- **Idempotent:** the dashboard dedupes on `type + app_id + store_domain +
  occurred_at`, so a retried delivery won't double-count.
- **Per-app config:** set `PARTNER_APP_ID` and `DASHBOARD_WEBHOOK_URL` as env
  vars in each app.
- **Counts are forward-only:** they start from the first event received; they do
  not backfill historical installs.
