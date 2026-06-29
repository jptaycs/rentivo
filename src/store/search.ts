import { create } from 'zustand'
import type { SearchFilters } from '@/types'

const defaultFilters: SearchFilters = {
  query: '',
  category: '',
  city: '',
  province: '',
  pickup_date: '',
  return_date: '',
  min_price: 0,
  max_price: 10000,
  brand: '',
  is_instant_book: false,
  is_verified_host: false,
  min_rating: 0,
}

interface SearchStore {
  filters: SearchFilters
  setFilter: <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => void
  setFilters: (filters: Partial<SearchFilters>) => void
  resetFilters: () => void
}

export const useSearchStore = create<SearchStore>((set) => ({
  filters: defaultFilters,
  setFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),
  setFilters: (filters) =>
    set((state) => ({ filters: { ...state.filters, ...filters } })),
  resetFilters: () => set({ filters: defaultFilters }),
}))
