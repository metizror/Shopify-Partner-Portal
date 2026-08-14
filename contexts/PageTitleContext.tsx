'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

// Lets an inner page (e.g. the flow builder) set the title shown in the global
// TopHeader — so you see the flow's NAME instead of a generic label.
interface PageTitleCtx { title: string | null; setTitle: (t: string | null) => void }
const Ctx = createContext<PageTitleCtx>({ title: null, setTitle: () => {} })

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null)
  return <Ctx.Provider value={{ title, setTitle }}>{children}</Ctx.Provider>
}

export const usePageTitle = () => useContext(Ctx)
