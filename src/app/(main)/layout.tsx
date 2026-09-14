import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { MobileBottomNav } from '@/components/layout/MobileBottomNav'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      {/* pb-bottom-nav (globals.css) clears the fixed MobileBottomNav below
          md — applied to the wrapper, not just <main>, so the Footer's own
          last row (Privacy/Terms/Contact) isn't left sitting under the nav
          on every page. */}
      <div className="flex-1 flex flex-col pb-bottom-nav">
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
      <MobileBottomNav />
    </>
  )
}
