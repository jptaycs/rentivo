export const SERVICE_FEE_RATE = 0.05

export interface PricedListing {
  daily_price: number
  weekly_price: number | null
  monthly_price: number | null
  security_deposit: number
  delivery_fee: number | null
}

export type RentalTier = 'daily' | 'weekly' | 'monthly'

/**
 * Exactly `round(price / div.0 * days)` as Postgres evaluates it in
 * create_booking (integer price, numeric division). Postgres first rounds the
 * quotient to its numeric division scale — max(16 - 4 * quotient weight, the
 * divisor's display scale of 1) decimal digits, half away from zero — and only
 * then multiplies and rounds. Float `Math.round((p / div) * days)` disagrees at
 * exact halves (e.g. 1029/30*45: Postgres 1544, JS 1543), which made checkout
 * report a false "price changed". `Math.round(p * days / div)` is ALSO wrong —
 * it skips the intermediate rounding. This emulation matched every one of
 * 54,000 live Postgres ties (TODO.md) and is re-proven by
 * scripts/verify/079-rental-rounding-parity.mjs. Integer-only BigInt math.
 */
function pgTierRental(price: number, days: number, div: 30 | 7): number {
  let w = 0
  let lead = price
  while (lead >= 10000) { lead = Math.floor(lead / 10000); w++ }
  const scale = BigInt(10) ** BigInt(Math.max(16 - 4 * (w - (lead < div ? 1 : 0)), 1))
  const d = BigInt(div)
  const q = (BigInt(2) * BigInt(price) * scale + d) / (BigInt(2) * d) // round(p/div, rscale)
  return Number((BigInt(2) * q * BigInt(days) + scale) / (BigInt(2) * scale)) // round(q*days)
}

/**
 * Mirrors create_booking's tiering (024_tiered_rental_pricing.sql): once a
 * rental crosses 7 or 30 days, the whole rental is priced at the listing's
 * weekly/monthly rate (if the host set one) instead of the daily rate.
 */
export function calcRentalFee(listing: PricedListing, days: number): { rentalFee: number; tier: RentalTier } {
  if (days >= 30 && listing.monthly_price) {
    return { rentalFee: pgTierRental(listing.monthly_price, days, 30), tier: 'monthly' }
  }
  if (days >= 7 && listing.weekly_price) {
    return { rentalFee: pgTierRental(listing.weekly_price, days, 7), tier: 'weekly' }
  }
  return { rentalFee: listing.daily_price * days, tier: 'daily' }
}

/**
 * Mirrors create_booking (070). The delivery fee is charged only when the
 * renter picks delivery, and the service fee is NOT charged on it — it is a
 * pass-through to the host.
 *
 * The security deposit is deliberately NOT part of the total: since 070
 * Rentivo does not charge it. The host collects it directly at pickup.
 * `PricedListing.security_deposit` stays on the interface because the listing
 * still discloses the amount — it is just not money Rentivo takes.
 *
 * 078: for a listing with a per-kilometre rate, the delivery figure must be the
 * server's quote (`quote_delivery_fee`), passed as `deliveryFeeOverride` — never
 * client arithmetic. Distance is measured from coordinates the client cannot
 * see, by the same function create_booking charges with. Without an override
 * the base `delivery_fee` is used, which is the whole fee for a flat-rate listing.
 */
export function calcPricing(
  listing: PricedListing,
  days: number,
  isDelivery = false,
  deliveryFeeOverride: number | null = null
) {
  const { rentalFee, tier } = calcRentalFee(listing, days)
  const serviceFee = Math.round(rentalFee * SERVICE_FEE_RATE)
  const deliveryFee = isDelivery ? (deliveryFeeOverride ?? listing.delivery_fee ?? 0) : 0
  const total = rentalFee + serviceFee + deliveryFee
  return { rentalFee, tier, serviceFee, deliveryFee, total }
}

/**
 * The money fields of a booking row as create_booking STORED them. Once a
 * booking exists these win over any client figure or earlier quote: the host
 * may have changed a rate in between, and the PayMongo intent is priced from
 * the stored total_amount. The checkout route returns this with every response
 * that carries a bookingId; delivery_latitude/longitude ride along so the
 * wizard can tell whether that booking is still reusable for the current pin.
 */
export interface StoredBookingAmounts {
  id: string
  rental_fee: number
  service_fee: number
  delivery_fee: number
  delivery_distance_km: number | null
  total_amount: number
  is_delivery: boolean
  delivery_latitude: number | null
  delivery_longitude: number | null
}

export function storedBookingAmounts(b: StoredBookingAmounts): StoredBookingAmounts {
  return {
    id: b.id,
    rental_fee: b.rental_fee,
    service_fee: b.service_fee,
    delivery_fee: b.delivery_fee,
    delivery_distance_km: b.delivery_distance_km == null ? null : Number(b.delivery_distance_km),
    total_amount: b.total_amount,
    is_delivery: b.is_delivery,
    delivery_latitude: b.delivery_latitude == null ? null : Number(b.delivery_latitude),
    delivery_longitude: b.delivery_longitude == null ? null : Number(b.delivery_longitude),
  }
}
