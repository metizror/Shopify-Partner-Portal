'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { usePageTitle } from '@/contexts/PageTitleContext'
import CookieHealthIndicator from '@/components/CookieHealthIndicator'

// Human-readable title per route, shown on the left of the global header.
const TAB_TITLES: Record<string, string> = {
  '/metrics': 'App Metrics',
  '/app-ads': 'App Ads',
  '/projects': 'Projects',
  '/automations': 'Automations',
  '/partners': 'Partners',
  '/partner-stores': 'Partner Stores',
  '/shopify/partners': 'Shopify · Partners',
  '/shopify/apps': 'Shopify · Apps',
  '/users': 'Users',
}

const roleBadge: Record<string, string> = {
  admin: 'bg-red-50 text-red-700 border-red-200',
  developer: 'bg-teal-50 text-teal-700 border-teal-200',
  viewer: 'bg-gray-50 text-gray-600 border-gray-200',
  designer: 'bg-pink-50 text-pink-700 border-pink-200',
}

export default function TopHeader() {
  const { user } = useAuth()
  const pathname = usePathname()
  const { title: dynamicTitle } = usePageTitle()

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : ''

  // A page (e.g. the flow builder) can set its own title — prefer that so the
  // header shows the flow's NAME rather than a generic label.
  const title =
    dynamicTitle ??
    TAB_TITLES[pathname ?? ''] ??
    ((pathname ?? '').startsWith('/shopify/apps/') ? 'Shopify · App Detail' : 'Dashboard')

  return (
    <header className="sticky top-0 z-20 py-4 flex items-center justify-between gap-4 pl-16 pr-4 md:px-8 border-b border-gray-200 bg-white/80 backdrop-blur-md">
      <h2 className="text-sm md:text-base font-semibold text-gray-900 truncate">
        {title}
      </h2>

      {user && (
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {user.role === 'admin' && <CookieHealthIndicator />}
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm font-semibold text-gray-900 truncate max-w-[180px]">
              {user.name}
            </span>
            <span className="text-[11px] text-gray-400 truncate max-w-[180px]">
              {user.email}
            </span>
          </div>
          <span
            className={`hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${
              roleBadge[user.role] ?? roleBadge.viewer
            }`}
          >
            {user.role}
          </span>
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {initials}
          </div>
        </div>
      )}
    </header>
  )
}
