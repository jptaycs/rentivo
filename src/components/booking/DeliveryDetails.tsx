'use client'

import dynamic from 'next/dynamic'
import { Loader2, Truck, AlertTriangle } from 'lucide-react'

// Leaflet touches window, so it never renders on the server.
const LeafletMap = dynamic(() => import('./DeliveryPinMapLeaflet'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[220px] bg-[#F8FAFC] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
    </div>
  ),
})

interface Props {
  address: string | null
  distanceKm: number | null
  fee: number
  lat: number | null
  lng: number | null
  /** True while the host can still accept or decline (a pending request). */
  awaitingDecision: boolean
}

/**
 * Where a paid delivery booking is going, for its host. The renter supplies
 * both the typed address (where the host actually goes) and the map pin (what
 * the per-km fee was priced from), and nothing ties the two together — the
 * host seeing both is the safeguard (distance-based delivery spec §2.4). The
 * caller must render this only once the booking is PAID, so an abandoned
 * checkout never puts a renter's pin on the host's screen.
 */
export function DeliveryDetails({ address, distanceKm, fee, lat, lng, awaitingDecision }: Props) {
  const hasPin = lat != null && lng != null
  return (
    <div className="mt-4 rounded-xl border border-gray-100 overflow-hidden" data-testid="delivery-details">
      <div className="px-4 py-3 bg-gray-50/60 text-sm">
        <p className="text-xs text-gray-400 font-medium mb-0.5 flex items-center gap-1">
          <Truck className="w-3 h-3" /> Delivery address
        </p>
        <p className="font-semibold text-[#111827] whitespace-pre-line break-words">
          {address?.trim() || 'No address given — message the renter.'}
        </p>
        <p className="mt-1 text-xs text-gray-600">
          Delivery fee ₱{Number(fee).toLocaleString()}
          {distanceKm != null && <> · {Number(distanceKm)} km by road</>}
        </p>
      </div>
      {hasPin && (
        <>
          <LeafletMap lat={Number(lat)} lng={Number(lng)} />
          <p className="flex items-start gap-1.5 px-4 py-2.5 text-xs text-amber-800 bg-amber-50 border-t border-amber-100">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {awaitingDecision
              ? 'Check that the pin matches the address before you accept. The delivery fee was calculated from the pin.'
              : "The delivery fee was calculated from the pin. If it doesn't match the address, message the renter before you deliver."}
          </p>
        </>
      )}
    </div>
  )
}
