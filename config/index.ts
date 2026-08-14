// Installation-independent constants only.
//
// Partner organisations, their API tokens, app IDs, display names and App Store
// handles used to live here as a hardcoded ORGS array. They are database rows
// now — see services/app-catalog.ts — so this file holds nothing specific to
// whoever is running the dashboard.

// Sender identity is no longer configured here: it resolves per-installation in
// services/brand.ts from the default row under Email → Senders. Hardcoded
// defaults meant a fresh clone mailed its merchants from an address it does
// not own.
// The alert recipient list is not here either: it is editable per-installation
// under Email → Settings (services/notify-recipients.ts), with EMAIL_TO kept
// only as a first-run fallback for an installation that has never saved one.

// A formatIST() lived here, hardcoded to Asia/Kolkata. Date formatting is
// per-installation, not an installation-independent constant, so it moved to
// lib/tz.ts and reads TZ_DISPLAY. Nothing imported it from here.

export const SHOPIFY_PARTNER_API_VERSION = '2026-01'
