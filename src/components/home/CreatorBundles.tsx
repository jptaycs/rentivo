import Image from 'next/image'
import Link from 'next/link'
import { Package } from 'lucide-react'
import { getBundles } from '@/lib/listings'

export async function CreatorBundles() {
  const bundles = await getBundles(3)
  if (bundles.length === 0) return null

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#111827]">Creator Bundles</h2>
          <p className="text-sm text-gray-500 mt-1">Everything you need, ready to shoot</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {bundles.map((bundle) => (
          <Link
            key={bundle.id}
            href={`/listings/${bundle.id}`}
            className="group relative bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
          >
            <div className="relative h-48 overflow-hidden">
              <Image
                src={bundle.images[0] ?? '/placeholder-equipment.jpg'}
                alt={bundle.title}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-500"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute top-3 left-3 bg-[#FDF0D5] text-white text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                <Package className="w-3 h-3" />
                Bundle
              </div>
              <h3 className="absolute bottom-4 left-4 text-white font-bold text-lg">
                {bundle.title}
              </h3>
            </div>
            <div className="p-4">
              <ul className="space-y-1 mb-4">
                {bundle.accessories.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="w-1 h-1 rounded-full bg-[#003049] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <p className="font-bold text-[#111827]">
                  <span className="text-[#003049]">₱{bundle.daily_price.toLocaleString()}</span>
                  <span className="text-xs font-normal text-gray-500">/day</span>
                </p>
                <span className="text-xs font-semibold text-[#003049] hover:text-blue-700">
                  Book now →
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
