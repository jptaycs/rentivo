'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { Upload, X, GripVertical, ChevronRight, ImagePlus } from 'lucide-react'

export interface WizardPhoto {
  file: File
  preview: string
}

interface Step1PhotosProps {
  photos: WizardPhoto[]
  onChange: (photos: WizardPhoto[]) => void
  onNext: () => void
}

export function Step1Photos({ photos, onChange, onNext }: Step1PhotosProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleFiles(files: FileList | null) {
    if (!files) return
    const added = Array.from(files)
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({ file: f, preview: URL.createObjectURL(f) }))
    onChange([...photos, ...added].slice(0, 10))
  }

  function remove(i: number) {
    URL.revokeObjectURL(photos[i].preview)
    onChange(photos.filter((_, idx) => idx !== i))
  }

  function moveLeft(i: number) {
    if (i === 0) return
    const next = [...photos]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    onChange(next)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#111827]">Upload photos</h2>
        <p className="text-gray-500 text-sm mt-1">Add up to 10 photos. The first photo is your cover image.</p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-4 p-12 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
          dragging ? 'border-[#003049] bg-blue-50' : 'border-gray-200 hover:border-[#003049] hover:bg-gray-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={e => handleFiles(e.target.files)}
        />
        <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
          <ImagePlus className="w-7 h-7 text-[#003049]" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-[#111827]">Drop photos here or click to browse</p>
          <p className="text-sm text-gray-400 mt-1">JPG, PNG, WEBP · Max 10MB each · Up to 10 photos</p>
        </div>
      </div>

      {/* Preview grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map(({ preview }, i) => (
            <div key={preview} className={`relative group rounded-xl overflow-hidden ${i === 0 ? 'ring-2 ring-[#003049]' : ''}`}>
              <div className="relative aspect-[4/3]">
                <Image src={preview} alt={`Photo ${i + 1}`} fill className="object-cover" sizes="200px" />
              </div>
              {i === 0 && (
                <div className="absolute top-2 left-2 bg-[#003049] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  Cover
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
              <button
                onClick={e => { e.stopPropagation(); remove(i) }}
                className="absolute top-2 right-2 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
              >
                <X className="w-3.5 h-3.5 text-gray-600" />
              </button>
              {i > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); moveLeft(i) }}
                  className="absolute bottom-2 left-2 text-[10px] bg-white/90 font-semibold px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-gray-600"
                >
                  ← Make cover
                </button>
              )}
            </div>
          ))}
          {photos.length < 10 && (
            <button
              onClick={() => inputRef.current?.click()}
              className="aspect-[4/3] border-2 border-dashed border-gray-200 hover:border-[#003049] rounded-xl flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-[#003049] transition-colors"
            >
              <Upload className="w-5 h-5" />
              <span className="text-xs font-medium">Add more</span>
            </button>
          )}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-800">
        <strong>Pro tip:</strong> Listings with 5+ clear, well-lit photos get <strong>3× more bookings</strong>. Show the equipment from multiple angles.
      </div>

      <button
        onClick={onNext}
        disabled={photos.length === 0}
        className="w-full bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        Continue <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}
