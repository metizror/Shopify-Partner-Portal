/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  // Inlined into the client bundle at build time, so lib/tz.ts can read the same
  // single TZ_DISPLAY on both sides instead of the app needing a server variable
  // and a NEXT_PUBLIC_ twin that must be kept in sync.
  //
  // Anything listed here is PUBLIC — it ends up in JavaScript any visitor can
  // read. A timezone name is not a secret; never add a key to this map that is.
  env: {
    TZ_DISPLAY: process.env.TZ_DISPLAY || '',
  },
  // Allow the dev server to be accessed over the local network AND through a
  // public tunnel (cloudflared/ngrok) without Next.js blocking internal
  // asset/HMR requests, which would otherwise leave the page stuck hydrating
  // (infinite spinner). trycloudflare gives a new subdomain each run, so allow
  // the whole wildcard.
  allowedDevOrigins: [
    '192.168.1.108',
    'hire-values-donors-roulette.trycloudflare.com',
    '*.trycloudflare.com',
  ],
}
module.exports = nextConfig
