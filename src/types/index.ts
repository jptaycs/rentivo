export type EquipmentCategory =
  | 'mirrorless'
  | 'dslr'
  | 'cinema'
  | 'smartphone'
  | 'lens'
  | 'bundle'

export type ListingCondition = 'mint' | 'excellent' | 'good' | 'fair'

export interface Profile {
  id: string
  full_name: string
  avatar_url: string | null
  is_verified: boolean
  is_host: boolean
  host_rating: number | null
  host_review_count: number
  response_time_hours: number | null
  bio: string | null
  city: string | null
  created_at: string
}

export interface Listing {
  id: string
  host_id: string
  category: EquipmentCategory
  brand: string
  model: string
  title: string
  description: string
  condition: ListingCondition
  daily_price: number
  weekly_price: number | null
  monthly_price: number | null
  security_deposit: number
  city: string
  province: string
  is_instant_book: boolean
  is_active: boolean
  rating: number | null
  review_count: number
  view_count: number
  images: string[]
  accessories: string[]
  created_at: string
  host?: Profile
}

export interface Booking {
  id: string
  listing_id: string
  renter_id: string
  host_id: string
  pickup_date: string
  return_date: string
  total_days: number
  rental_fee: number
  security_deposit: number
  service_fee: number
  protection_fee: number
  total_amount: number
  status: 'pending' | 'confirmed' | 'active' | 'completed' | 'cancelled'
  is_delivery: boolean
  delivery_address: string | null
  payment_method: 'gcash' | 'maya' | 'card' | 'apple_pay' | 'google_pay' | null
  payment_status: 'unpaid' | 'paid' | 'refunded'
  paymongo_ref: string | null
  paid_at: string | null
  promo_code: string | null
  discount: number
  booking_ref: string
  created_at: string
  listing?: Listing
  renter?: Profile
  host?: Profile
}

export interface Message {
  id: string
  booking_id: string
  sender_id: string
  content: string
  image_url: string | null
  created_at: string
  sender?: Profile
}

export interface Review {
  id: string
  booking_id: string
  reviewer_id: string
  reviewee_id: string
  listing_id: string | null
  rating: number
  comment: string
  created_at: string
  reviewer?: Profile
  listing?: Listing | null
}

export interface SearchFilters {
  query: string
  category: EquipmentCategory | ''
  city: string
  province: string
  pickup_date: string
  return_date: string
  min_price: number
  max_price: number
  brand: string
  is_instant_book: boolean
  is_verified_host: boolean
  min_rating: number
}
