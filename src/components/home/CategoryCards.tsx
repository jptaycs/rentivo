import Link from 'next/link'

const CATEGORIES = [
  { emoji: '📷', label: 'Cameras', sub: 'Mirrorless & DSLR', href: '/search?category=mirrorless' },
  { emoji: '📱', label: 'Phones', sub: 'iOS & Android', href: '/search?category=smartphone' },
  { emoji: '🔭', label: 'Lenses', sub: 'Prime & Zoom', href: '/search?category=lens' },
  { emoji: '🎥', label: 'Creator Kits', sub: 'Complete bundles', href: '/search?category=bundle' },
]

export function CategoryCards() {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h2 className="text-2xl font-bold text-[#111827] mb-6">Browse by Category</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.label}
            href={cat.href}
            className="group flex flex-col items-center gap-3 p-6 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
          >
            <span className="text-4xl group-hover:scale-110 transition-transform duration-200">
              {cat.emoji}
            </span>
            <div className="text-center">
              <p className="font-semibold text-[#111827] text-sm">{cat.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{cat.sub}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
