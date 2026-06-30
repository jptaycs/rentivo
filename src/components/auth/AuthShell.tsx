import Link from 'next/link'
import Image from 'next/image'

interface AuthShellProps {
  children: React.ReactNode
  heading: string
  subheading: string
}

const TESTIMONIALS = [
  { quote: 'Earned ₱45,000 last month just renting out my A7 IV on weekends.', name: 'Mark R.', role: 'Host · Manila' },
  { quote: 'Rented an FX3 for our wedding shoot. Saved us ₱180k vs buying.', name: 'Trish M.', role: 'Photographer · Cebu' },
  { quote: 'The whole booking process took less than 3 minutes. Incredible.', name: 'Carlo S.', role: 'Content Creator · BGC' },
]

const ROTATING = TESTIMONIALS[Math.floor(Math.random() * TESTIMONIALS.length)]

export function AuthShell({ children, heading, subheading }: AuthShellProps) {
  return (
    <div className="min-h-screen flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-[480px] shrink-0 flex-col justify-between bg-[#003049] p-10 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'radial-gradient(circle at 80% 20%, white 1px, transparent 1px), radial-gradient(circle at 20% 80%, white 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-white/5 rounded-full translate-x-1/3 translate-y-1/3" />
        <div className="absolute top-20 right-10 w-32 h-32 bg-white/5 rounded-full" />

        {/* Logo */}
        <Link href="/" className="relative z-10 inline-block">
          <Image src="/rentivo-logo-beige.png" alt="Rentivo" width={160} height={52} className="h-14 w-auto object-contain" />
        </Link>

        {/* Center content */}
        <div className="relative z-10 space-y-6">
          <div>
            <p className="text-blue-200 text-sm font-semibold uppercase tracking-wider mb-3">
              Trusted by creators
            </p>
            <h2 className="text-3xl font-bold text-white leading-snug">
              Rent Smarter.<br />Create More.
            </h2>
            <p className="text-blue-100 mt-3 leading-relaxed">
              The Philippines&apos; #1 marketplace for renting cameras, smartphones, and lenses from verified owners.
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { value: '10k+', label: 'Listings' },
              { value: '4.9★', label: 'Avg rating' },
              { value: '₱0', label: 'To list' },
            ].map((s) => (
              <div key={s.label} className="bg-white/10 rounded-2xl p-4 text-center">
                <p className="text-white font-bold text-lg">{s.value}</p>
                <p className="text-blue-200 text-xs mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Testimonial */}
          <div className="bg-white/10 rounded-2xl p-5 border border-white/10">
            <p className="text-white text-sm leading-relaxed italic">
              &ldquo;{ROTATING.quote}&rdquo;
            </p>
            <div className="mt-3 flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-bold">
                {ROTATING.name[0]}
              </div>
              <div>
                <p className="text-white text-xs font-semibold">{ROTATING.name}</p>
                <p className="text-blue-200 text-xs">{ROTATING.role}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-blue-200/60 text-xs relative z-10">
          © 2026 Rentivo · Privacy · Terms
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 sm:px-12 overflow-y-auto">
        {/* Mobile logo */}
        <Link href="/" className="mb-8 lg:hidden inline-block">
          <Image src="/rentivo-logo.png" alt="Rentivo" width={140} height={48} className="h-11 w-auto object-contain" />
        </Link>

        <div className="w-full max-w-md">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#111827]">{heading}</h1>
            <p className="text-gray-500 mt-1.5 text-sm">{subheading}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
