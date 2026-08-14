'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { PageTitleProvider } from '@/contexts/PageTitleContext'
import Sidebar from '@/components/Sidebar'
import TopHeader from '@/components/TopHeader'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  // Not logged in → login page. There is no second, per-route check: login
  // refuses every non-admin account (app/api/auth/login/route.ts), so anyone who
  // reaches this layout may see all of it.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login')
  }, [isLoading, isAuthenticated, router])

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <PageTitleProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 ml-0 md:ml-64 min-w-0 overflow-x-hidden">
          <TopHeader />
          {children}
        </main>
      </div>
    </PageTitleProvider>
  )
}
