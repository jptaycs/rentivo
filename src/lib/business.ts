// The operating entity's public details — the single source for every place
// they appear (legal pages, footer, /contact). PayMongo's merchant review
// requires the registration number, a business address and a customer-service
// contact to be published on the site, so these are load-bearing for the
// payment account, not decoration. Change them here and nowhere else.
//
// Client-safe: plain constants, no server imports. Imported by client
// components (Settings, Footer) as well as server pages.
export const BUSINESS = {
  /** Registered business name. Rentivo is its trade name, not the entity. */
  name: 'Appnado IT Solutions',
  /** DTI Business Name Registration, as printed on the certificate. */
  dtiNumber: '7356023',
  city: 'Naga City',
  province: 'Camarines Sur',
  country: 'Philippines',
  /** The one customer-service address. Not the admin allowlist address
   *  (ADMIN_EMAILS), which is deliberately separate and never published. */
  email: 'appnadoitsolutions@gmail.com',
  /** What we tell people to expect. Keep it honest — it is a public promise. */
  responseTime: '2 business days',
} as const

export const BUSINESS_ADDRESS = `${BUSINESS.city}, ${BUSINESS.province}, ${BUSINESS.country}`
