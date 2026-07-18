import 'server-only'
import { createAdminClient } from './supabase/admin'
import { isPayMongoConfigured, getPaymentIntent, createRefund } from './paymongo'

export interface RefundResult {
  refunded: boolean
  error?: string
}

/**
 * Refunds a booking's full charge and marks it refunded. Safe to call on
 * any cancelled booking — no-ops (refunded: true) if there was nothing to
 * refund (unpaid, or already refunded), so callers never need to check
 * payment_status first.
 */
export async function refundBooking(bookingId: string): Promise<RefundResult> {
  const admin = createAdminClient()
  const { data: booking } = await admin
    .from('bookings')
    .select('id, payment_status, paymongo_ref, total_amount')
    .eq('id', bookingId)
    .maybeSingle()

  if (!booking) return { refunded: false, error: 'Booking not found.' }
  if (booking.payment_status !== 'paid') return { refunded: true }

  // Simulated/dev payments have no real PayMongo charge behind them
  if (!isPayMongoConfigured() || !booking.paymongo_ref || booking.paymongo_ref === 'pi_simulated_dev') {
    await admin.rpc('mark_booking_refunded', { p_booking_id: bookingId, p_refund_ref: null })
    return { refunded: true }
  }

  try {
    const intent = await getPaymentIntent(booking.paymongo_ref)
    const paymentId = intent.attributes.payments?.[0]?.id
    if (!paymentId) return { refunded: false, error: 'No completed payment found to refund.' }

    const refund = await createRefund({
      paymentId,
      amountCentavos: booking.total_amount * 100,
      reason: 'requested_by_customer',
    })
    await admin.rpc('mark_booking_refunded', { p_booking_id: bookingId, p_refund_ref: refund.id })
    return { refunded: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refund failed.'
    console.error('[refund] failed for booking', bookingId, message)
    return { refunded: false, error: message }
  }
}
