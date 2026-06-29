import { Check } from 'lucide-react'

const STEPS = [
  { n: 1, label: 'Photos' },
  { n: 2, label: 'Details' },
  { n: 3, label: 'Pricing' },
  { n: 4, label: 'Availability' },
  { n: 5, label: 'Location' },
  { n: 6, label: 'Verify' },
]

export function WizardStep({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center flex-wrap gap-y-3 mb-10">
      {STEPS.map((s, i) => {
        const done   = s.n < current
        const active = s.n === current
        return (
          <div key={s.n} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all
                ${done   ? 'bg-[#22C55E] text-white'
                : active ? 'bg-[#003049] text-white ring-4 ring-blue-100'
                :          'bg-gray-100 text-gray-400'}`}>
                {done ? <Check className="w-3.5 h-3.5" /> : s.n}
              </div>
              <span className={`text-[10px] font-semibold whitespace-nowrap ${
                active ? 'text-[#003049]' : done ? 'text-[#22C55E]' : 'text-gray-400'
              }`}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-8 sm:w-12 mx-1 mb-4 transition-colors ${s.n < current ? 'bg-[#22C55E]' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
