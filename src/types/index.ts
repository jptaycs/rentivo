export type EquipmentCategory =
  | 'mirrorless'
  | 'dslr'
  | 'digital'
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
  notify_new_booking: boolean
  notify_messages: boolean
  notify_reminders: boolean
  notify_promos: boolean
  qr_payment_url: string | null
  qr_payment_label: string | null
  suspended_at: string | null
  suspension_reason: string | null
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
  delivery_fee: number | null
  city: string
  province: string
  is_instant_book: boolean
  is_active: boolean
  is_draft: boolean
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
  delivery_fee: number
  total_amount: number
  status: 'pending' | 'confirmed' | 'active' | 'completed' | 'cancelled'
  is_delivery: boolean
  delivery_address: string | null
  payment_method: 'gcash' | 'maya' | 'card' | 'qrph' | 'apple_pay' | 'google_pay' | 'host_qr' | 'test_skip' | null
  payment_status: 'unpaid' | 'paid' | 'refunded'
  paymongo_ref: string | null
  refund_ref: string | null
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

export interface VerificationRequest {
  id: string
  user_id: string
  id_doc_path: string
  selfie_path: string
  status: 'pending' | 'approved' | 'rejected'
  reviewer_notes: string | null
  auto_check_failed: boolean
  auto_check_detail: string | null
  created_at: string
  reviewed_at: string | null
}

export interface PayoutAccount {
  id: string
  user_id: string
  method: 'GCash' | 'Maya' | 'Bank Transfer (Instapay)' | 'BDO' | 'BPI' | 'UnionBank'
  account_number: string
  account_name: string
  status: 'pending' | 'verified' | 'rejected'
  reviewer_notes: string | null
  created_at: string
  reviewed_at: string | null
}

export interface PayoutItem {
  payout_request_id: string
  booking_id: string
  amount: number
}

export interface PayoutRequest {
  id: string
  host_id: string
  payout_account_id: string
  amount: number
  status: 'pending' | 'paid' | 'failed'
  reference: string | null
  notes: string | null
  requested_at: string
  processed_at: string | null
  items?: PayoutItem[]
}

export interface Notification {
  id: string
  user_id: string
  type:
    | 'booking_request'
    | 'booking_confirmed'
    | 'booking_cancelled'
    | 'booking_completed'
    | 'booking_paid'
    | 'review_received'
    | 'verification_approved'
    | 'verification_rejected'
  title: string
  body: string
  link: string | null
  is_read: boolean
  created_at: string
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
