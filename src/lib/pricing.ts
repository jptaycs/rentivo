export const SERVICE_FEE_RATE = 0.12
export const PROTECTION_FEE_RATE = 0.05

export interface PricedListing {
  daily_price: number
  weekly_price: number | null
  monthly_price: number | null
  security_deposit: number
}

export type RentalTier = 'daily' | 'weekly' | 'monthly'

/**
 * Mirrors create_booking's tiering (024_tiered_rental_pricing.sql): once a
 * rental crosses 7 or 30 days, the whole rental is priced at the listing's
 * weekly/monthly rate (if the host set one) instead of the daily rate.
 */
export function calcRentalFee(listing: PricedListing, days: number): { rentalFee: number; tier: RentalTier } {
  if (days >= 30 && listing.monthly_price) {
    return { rentalFee: Math.round((listing.monthly_price / 30) * days), tier: 'monthly' }
  }
  if (days >= 7 && listing.weekly_price) {
    return { rentalFee: Math.round((listing.weekly_price / 7) * days), tier: 'weekly' }
  }
  return { rentalFee: listing.daily_price * days, tier: 'daily' }
}

export function calcPricing(listing: PricedListing, days: number) {
  const { rentalFee, tier } = calcRentalFee(listing, days)
  const serviceFee = Math.round(rentalFee * SERVICE_FEE_RATE)
  const protectionFee = Math.round(rentalFee * PROTECTION_FEE_RATE)
  const total = rentalFee + serviceFee + protectionFee + listing.security_deposit
  return { rentalFee, tier, serviceFee, protectionFee, total }
}
