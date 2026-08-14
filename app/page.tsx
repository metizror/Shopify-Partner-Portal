import { redirect } from 'next/navigation'

// The dashboard now lives under routed pages in the (dashboard) group. Land on
// Shopify Partners — the only section the sidebar currently exposes (see
// SHOPIFY_ONLY in components/Sidebar.tsx). It's admin-only, so the dashboard
// layout bounces non-admins on to their first allowed section.
export default function Home() {
  redirect('/shopify/partners')
}
