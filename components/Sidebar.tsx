'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  BarChart3,
  FolderKanban,
  Zap,
  Handshake,
  Megaphone,
  LogOut,
  Menu,
  X,
  Package,
  Users,
  ExternalLink,
  Store,
  ShoppingBag,
  ChevronDown,
  ChevronRight,
  Building2,
  LayoutGrid,
  Mail,
  Settings,
  FileBarChart,
  Award,
  Clock,
  Repeat,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

// The dashboard is Shopify-only: every other section's pages were removed (see
// the "shopify-only-sidebar" note in memory for the restore point). The Email
// pages still exist and stay reachable by URL — Flows and Sequences link into
// them, and Settings → Email links to Email → Senders — they just have no nav
// entry of their own.

// Sub-pages nested under the collapsible "Shopify" group (admin only).
const shopifyChildren: { href: string; label: string; icon: React.ElementType }[] = [
  { href: '/shopify/partners', label: 'Partners', icon: Building2 },
  { href: '/shopify/apps', label: 'Apps', icon: LayoutGrid },
  { href: '/shopify/campaign', label: 'Campaign', icon: Megaphone },
  { href: '/shopify/sequences', label: 'Sequences', icon: Repeat },
  { href: '/flows', label: 'Flows', icon: Zap },
  { href: '/flows/all', label: 'All Flows', icon: LayoutGrid },
  { href: '/flows/templates', label: 'Flow Templates', icon: FolderKanban },
  { href: '/flows/schedules', label: 'Schedules', icon: Clock },
]

function Sidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  // Shopify is the only group, so it starts expanded — collapsed would look empty.
  const [shopifyOpen, setShopifyOpen] = useState(true)
  const { user, logout } = useAuth()

  const isAdmin = user?.role === 'admin'

  const isActive = (href: string) => pathname === href
  const closeMobile = () => setMobileOpen(false)

  const itemClass = (active: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
      active ? 'bg-purple-50 text-purple-700 border-l-2 border-purple-600' : 'text-gray-500 hover:bg-gray-50'
    }`

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <Package className="h-7 w-7 text-purple-600" />
          <span className="text-lg font-semibold text-gray-900">
            Developer Hub
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-400">Internal Developer Hub</p>
      </div>

      {/* Navigation (scrolls when items overflow) */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-1">
        {/* Shopify — collapsible group with sub-pages (admin only) */}
        {isAdmin && (
          <div>
            <button
              onClick={() => setShopifyOpen((o) => !o)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
            >
              <ShoppingBag className="h-5 w-5 flex-shrink-0" />
              <span className="flex-1 text-left">Shopify</span>
              {shopifyOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {shopifyOpen && (
              <div className="mt-1 ml-5 pl-2 border-l border-gray-200 space-y-1">
                {shopifyChildren.map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={closeMobile}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive(href)
                        ? 'bg-purple-50 text-purple-700 border-l-2 border-purple-600'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings — installation-wide, so it sits outside the Shopify group. */}
        {isAdmin && (
          <Link href="/settings/email" onClick={closeMobile} className={itemClass(isActive('/settings/email'))}>
            <Settings className="h-5 w-5 flex-shrink-0" />
            Settings
          </Link>
        )}
      </nav>

      {/* Users + Logout — pinned to the bottom */}
      <div className="flex-shrink-0 px-3 py-4 border-t border-gray-200 space-y-1">
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          Logout
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Top accent gradient bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-400 via-purple-500 to-purple-600 z-50" />

      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-3 left-3 z-40 p-2 rounded-md bg-white shadow-md border border-gray-200 md:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5 text-gray-600" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30"
            onClick={() => setMobileOpen(false)}
          />
          {/* Sidebar panel */}
          <div className="fixed top-1 left-0 bottom-0 w-64 z-50 shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 p-1 rounded-md text-gray-400 hover:text-gray-600"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col fixed top-1 left-0 bottom-0 w-64 border-r border-gray-200 z-30">
        {sidebarContent}
      </aside>
    </>
  )
}

export default Sidebar
