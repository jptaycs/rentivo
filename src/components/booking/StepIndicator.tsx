import { Check } from 'lucide-react'

const STEPS = ['Review', 'Pickup', 'Payment', 'Confirmation']

interface StepIndicatorProps {
  current: number // 0-indexed
}

export function StepIndicator({ current }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {STEPS.map((label, i) => {
        const done = i < current
        const active = i === current

        return (
          <div key={label} className="flex items-center">
            {/* Circle */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  done
                    ? 'bg-[#22C55E] text-white'
                    : active
                    ? 'bg-[#003049] text-white ring-4 ring-blue-100'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {done ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span
                className={`text-xs font-medium whitespace-nowrap ${
                  active ? 'text-[#003049]' : done ? 'text-[#22C55E]' : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </div>

            {/* Connector */}
            {i < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-16 sm:w-24 mx-1 mb-5 transition-colors ${
                  i < current ? 'bg-[#22C55E]' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
