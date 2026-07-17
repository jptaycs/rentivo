/**
 * Approximate city-center coordinates for the Philippine cities/provinces
 * offered in the host wizard's pickup-address step. Deliberately coarse —
 * renters only ever see city/province (never the exact street address,
 * which is shared after a booking is confirmed), so a city-level pin is
 * the correct level of precision, not a privacy gap to geocode around.
 */

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  // Metro Manila
  makati: { lat: 14.5547, lng: 121.0244 },
  'bgc (taguig)': { lat: 14.5511, lng: 121.0503 },
  taguig: { lat: 14.5378, lng: 121.0014 },
  'quezon city': { lat: 14.676, lng: 121.0437 },
  pasig: { lat: 14.5764, lng: 121.0851 },
  mandaluyong: { lat: 14.5794, lng: 121.0359 },
  marikina: { lat: 14.6507, lng: 121.1029 },
  paranaque: { lat: 14.4793, lng: 121.0198 },
  manila: { lat: 14.5995, lng: 120.9842 },
  pasay: { lat: 14.5378, lng: 121.0014 },
  'las pinas': { lat: 14.4499, lng: 120.9829 },
  muntinlupa: { lat: 14.4081, lng: 121.0415 },

  // Cebu
  'cebu city': { lat: 10.3157, lng: 123.8854 },
  mandaue: { lat: 10.3236, lng: 123.9223 },
  'lapu-lapu': { lat: 10.3103, lng: 123.9494 },
  talisay: { lat: 10.2447, lng: 123.8494 },

  // Davao
  'davao city': { lat: 7.1907, lng: 125.4553 },
  tagum: { lat: 7.4478, lng: 125.8078 },
  digos: { lat: 6.7496, lng: 125.3572 },
}

const PROVINCE_COORDS: Record<string, { lat: number; lng: number }> = {
  'metro manila': { lat: 14.5995, lng: 120.9842 },
  cebu: { lat: 10.3157, lng: 123.8854 },
  davao: { lat: 7.1907, lng: 125.4553 },
  bulacan: { lat: 14.7943, lng: 120.8794 },
  laguna: { lat: 14.2833, lng: 121.4167 },
  cavite: { lat: 14.4297, lng: 120.9367 },
  pampanga: { lat: 15.0794, lng: 120.62 },
  batangas: { lat: 13.7565, lng: 121.0583 },
  rizal: { lat: 14.6255, lng: 121.1245 },
  quezon: { lat: 13.9314, lng: 121.6169 },
  iloilo: { lat: 10.7202, lng: 122.5621 },
  'negros occidental': { lat: 10.6713, lng: 122.9511 },
}

/** Falls back to province center, then to Manila — always returns a pin. */
export function getCityCoordinates(city: string, province: string) {
  const key = city.trim().toLowerCase()
  const provinceKey = province.trim().toLowerCase()
  return CITY_COORDS[key] ?? PROVINCE_COORDS[provinceKey] ?? PROVINCE_COORDS['metro manila']
}
