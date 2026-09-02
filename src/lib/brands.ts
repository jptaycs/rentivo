// Single source of truth for equipment brands.
// Previously duplicated (and drifted) between the host wizard's dropdown and
// the search filter's pills — the wizard had "Other", the filter didn't.
//
// Scope boundary (AGENTS.md): cameras, smartphones and lenses only. DJI,
// GoPro and Insta360 are listed for their pocket/action *cameras*; nothing
// here is a drone, gimbal, laptop, console or vehicle. Don't add a brand
// whose only rentable products fall outside those three categories.
//
// Groups are exclusive — a brand appears exactly once, so ALL_BRANDS needs no
// dedupe and <optgroup> renders no repeats. Sigma sits under lenses because
// that's what hosts here would list it for.

export interface BrandGroup {
  label: string
  brands: string[]
}

export const BRAND_GROUPS: BrandGroup[] = [
  {
    label: 'Cameras',
    brands: [
      'Sony', 'Canon', 'Nikon', 'Fujifilm', 'Panasonic', 'Blackmagic',
      'Leica', 'OM System', 'Olympus', 'Pentax', 'Ricoh', 'Hasselblad',
      'RED', 'ARRI', 'DJI', 'GoPro', 'Insta360',
    ],
  },
  {
    label: 'Lenses & Optics',
    brands: ['Sigma', 'Tamron', 'Zeiss', 'Viltrox', 'Samyang', 'Laowa', 'Tokina'],
  },
  {
    label: 'Smartphones',
    brands: [
      'Apple', 'Samsung', 'Google', 'Xiaomi', 'OPPO', 'vivo',
      'Huawei', 'Realme', 'OnePlus', 'Nothing',
    ],
  },
]

/** Every brand, flat. Order follows BRAND_GROUPS. */
export const ALL_BRANDS: string[] = BRAND_GROUPS.flatMap((g) => g.brands)

/**
 * Shown in the search filter before the user expands the full list. These are
 * the eight the filter has always offered, so a bookmarked/shared ?brand= URL
 * keeps working and the collapsed pill row stays the size it was.
 */
export const FEATURED_BRANDS = [
  'Sony', 'Canon', 'Nikon', 'Fujifilm', 'Apple', 'Samsung', 'Panasonic', 'Blackmagic',
] as const

/** Escape hatch in the host wizard only — never a filter pill. */
export const OTHER_BRAND = 'Other'
