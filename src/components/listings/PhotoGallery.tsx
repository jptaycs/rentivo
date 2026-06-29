'use client'

import Image from 'next/image'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, X, ZoomIn } from 'lucide-react'

interface PhotoGalleryProps {
  images: string[]
  title: string
}

export function PhotoGallery({ images, title }: PhotoGalleryProps) {
  const [active, setActive] = useState(0)
  const [lightbox, setLightbox] = useState(false)

  const prev = () => setActive((i) => (i === 0 ? images.length - 1 : i - 1))
  const next = () => setActive((i) => (i === images.length - 1 ? 0 : i + 1))

  // Fill to at least 4 for the grid
  const display = images.length >= 4 ? images : [...images, ...Array(4 - images.length).fill(images[0])]

  return (
    <>
      {/* Gallery grid */}
      <div className="grid grid-cols-4 gap-2 h-[420px] rounded-2xl overflow-hidden">
        {/* Main large image */}
        <div
          className="col-span-2 row-span-2 relative cursor-pointer group"
          onClick={() => setLightbox(true)}
        >
          <Image
            src={display[0]}
            alt={title}
            fill
            className="object-cover group-hover:brightness-90 transition-all"
            sizes="50vw"
            priority
          />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="bg-black/50 rounded-full p-3">
              <ZoomIn className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>

        {/* Side thumbnails */}
        {display.slice(1, 5).map((img, i) => (
          <div
            key={i}
            className="relative cursor-pointer group overflow-hidden"
            onClick={() => { setActive(i + 1); setLightbox(true) }}
          >
            <Image
              src={img}
              alt={`${title} ${i + 2}`}
              fill
              className="object-cover group-hover:brightness-90 transition-all"
              sizes="25vw"
            />
            {/* "Show all" overlay on last thumbnail */}
            {i === 3 && images.length > 5 && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <span className="text-white font-semibold text-sm">+{images.length - 5} more</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center">
          <button
            onClick={() => setLightbox(false)}
            className="absolute top-4 right-4 text-white/70 hover:text-white"
          >
            <X className="w-7 h-7" />
          </button>

          <button
            onClick={prev}
            className="absolute left-4 text-white/70 hover:text-white p-2"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>

          <div className="relative w-full max-w-4xl h-[80vh] mx-16">
            <Image
              src={images[active] ?? display[active]}
              alt={title}
              fill
              className="object-contain"
              sizes="100vw"
            />
          </div>

          <button
            onClick={next}
            className="absolute right-4 text-white/70 hover:text-white p-2"
          >
            <ChevronRight className="w-8 h-8" />
          </button>

          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                className={`w-1.5 h-1.5 rounded-full transition-all ${
                  i === active ? 'bg-white w-4' : 'bg-white/40'
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
