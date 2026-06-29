import { DollarSign, Aperture, ShieldCheck } from 'lucide-react'

const FEATURES = [
  {
    icon: DollarSign,
    title: 'Earn Money',
    description: 'Turn your unused camera gear into passive income. List your equipment in minutes and start earning.',
    color: 'bg-green-50 text-green-600',
  },
  {
    icon: Aperture,
    title: 'Affordable Access',
    description: 'Rent premium cameras, lenses, and phones for a fraction of the purchase price. Shoot professional without buying professional.',
    color: 'bg-blue-50 text-[#003049]',
  },
  {
    icon: ShieldCheck,
    title: 'Trusted Marketplace',
    description: 'Verified users, secure payments, equipment protection, and a review system you can count on.',
    color: 'bg-orange-50 text-[#F97316]',
  },
]

export function WhyRentivo() {
  return (
    <section className="bg-white py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-[#111827]">Why Rentivo?</h2>
          <p className="mt-3 text-gray-500 max-w-xl mx-auto">
            The smarter way to access — and monetize — professional camera gear.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div
                key={f.title}
                className="flex flex-col items-center text-center p-8 rounded-2xl bg-[#F8FAFC] hover:shadow-md transition-shadow duration-300"
              >
                <div className={`w-14 h-14 rounded-2xl ${f.color} flex items-center justify-center mb-5`}>
                  <Icon className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-[#111827] mb-3">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.description}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
