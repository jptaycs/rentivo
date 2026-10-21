// The one list of equipment categories and their public labels. Used by the
// search filter, page titles and sitemap. Scope boundary per AGENTS.md: these
// seven and nothing else (no drones, laptops, consoles, vehicles).
import type { EquipmentCategory } from '@/types'

export const CATEGORIES: { value: EquipmentCategory; label: string; noun: string }[] = [
  { value: 'mirrorless', label: 'Mirrorless Cameras', noun: 'mirrorless camera' },
  { value: 'dslr', label: 'DSLR Cameras', noun: 'DSLR camera' },
  { value: 'digital', label: 'Digital Cameras', noun: 'digital camera' },
  { value: 'cinema', label: 'Cinema Cameras', noun: 'cinema camera' },
  { value: 'smartphone', label: 'Smartphones', noun: 'smartphone' },
  { value: 'lens', label: 'Lenses', noun: 'camera lens' },
  { value: 'bundle', label: 'Creator Bundles', noun: 'creator kit' },
]

export function categoryLabel(value: string): string | null {
  return CATEGORIES.find((c) => c.value === value)?.label ?? null
}

export function categoryNoun(value: string): string | null {
  return CATEGORIES.find((c) => c.value === value)?.noun ?? null
}

export function isEquipmentCategory(value: string): value is EquipmentCategory {
  return CATEGORIES.some((c) => c.value === value)
}
