// The team addresses that receive internal notifications — install/uninstall
// alerts and any flow step that sends "to my team".
//
// Its own module rather than part of services/email.ts because
// services/partner-notify.ts needs it, and email.ts already imports
// partner-notify — putting it there would close an import cycle.
//
// Stored in the State table so the list is editable from the UI. EMAIL_TO is a
// first-run fallback only: an installation that has never opened the settings
// page keeps whatever its .env said, and the first save takes over for good.
import { prisma } from '@/lib/db'

const NOTIFY_ID = 'notify_recipients'

export async function getNotifyRecipients(): Promise<string[]> {
  const row = await prisma.state.findUnique({ where: { id: NOTIFY_ID } })
  const stored = (row?.value as { emails?: string[] } | null)?.emails
  if (Array.isArray(stored)) return stored.filter(Boolean)
  return (process.env.EMAIL_TO || '').split(',').map((e) => e.trim()).filter(Boolean)
}

export async function setNotifyRecipients(emails: string[]): Promise<void> {
  const clean = Array.from(new Set(emails.map((e) => e.trim()).filter((e) => /.+@.+\..+/.test(e))))
  await prisma.state.upsert({
    where: { id: NOTIFY_ID },
    create: { id: NOTIFY_ID, value: { emails: clean } as any },
    update: { value: { emails: clean } as any },
  })
}
