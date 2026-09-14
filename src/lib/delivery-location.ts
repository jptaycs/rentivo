/**
 * Renter delivery pins. Client-safe: the checkout route and the checkout UI
 * both import this, so the Philippines box and the pin comparison can't drift.
 */

/**
 * Rentivo operates only in the Philippines. A pin far outside it overflows
 * bookings.delivery_distance_km numeric(6,2) and create_booking fails with a raw
 * "numeric field overflow", so both the UI and the route refuse it first.
 */
export const PH_BOUNDS = { minLat: 4.0, maxLat: 21.5, minLng: 116.0, maxLng: 127.0 } as const

export const OUTSIDE_PH_MESSAGE = 'Please choose a delivery location in the Philippines.'

export function isInPhilippines(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= PH_BOUNDS.minLat &&
    lat <= PH_BOUNDS.maxLat &&
    lng >= PH_BOUNDS.minLng &&
    lng <= PH_BOUNDS.maxLng
  )
}

/** bookings.delivery_latitude/longitude are numeric(10,7). */
export const PIN_DECIMALS = 7

/**
 * Round a pin to the precision the database stores, so the coordinate that is
 * quoted, the one create_booking prices, and the one it stores are identical.
 */
export function roundPinCoord(n: number): number {
  return Number(n.toFixed(PIN_DECIMALS))
}

/**
 * Stable comparison key for a pin at stored precision. Never compare pins with
 * raw === on floats: a stored numeric(10,7) read back as a JS number and a
 * freshly dragged float can differ in the 15th digit yet be the same pin.
 */
export function pinKey(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null) return null
  return `${Number(lat).toFixed(PIN_DECIMALS)},${Number(lng).toFixed(PIN_DECIMALS)}`
}

/**
 * Whether an unpaid booking may be reused for a checkout attempt with this
 * delivery choice and pin. Reusing it charges its STORED total, so it is only
 * safe when that total was priced under the same choice:
 * - pickup ↔ delivery must match;
 * - a booking that stored a pin (per-km delivery) must match the pin exactly.
 * A booking with no stored pin was priced flat, so the pin can't change its total.
 */
export function canReuseBooking(
  stored: { is_delivery: boolean; delivery_latitude: number | null; delivery_longitude: number | null },
  isDelivery: boolean,
  pin: { lat: number; lng: number } | null
): boolean {
  if (stored.is_delivery !== isDelivery) return false
  const storedKey = pinKey(stored.delivery_latitude, stored.delivery_longitude)
  if (storedKey === null) return true
  return storedKey === pinKey(pin?.lat, pin?.lng)
}
