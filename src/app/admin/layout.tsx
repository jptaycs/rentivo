import Link from 'next/link'
import { requireAdminPage } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPage()

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <header className="bg-[#003049] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="text-lg font-bold">
              Rentivo Admin
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/admin" className="hover:underline">Overview</Link>
              <Link href="/admin/verifications" className="hover:underline">Verifications</Link>
              <Link href="/admin/payouts" className="hover:underline">Payouts</Link>
              <Link href="/admin/users" className="hover:underline">Users</Link>
              <Link href="/admin/reports" className="hover:underline">Reports</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-xs text-white/70">
            <span>{user.email}</span>
            <Link href="/" className="hover:underline">← Back to site</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
