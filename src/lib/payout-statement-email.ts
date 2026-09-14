import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyPayoutStatementIssued, notifyPayoutStatementReversed } from '@/lib/email'

/**
 * Send a host their statement email and record that it went out.
 *
 * Shared by the issue, reverse and resend routes rather than copied into each:
 * "send, then stamp `statement_emailed_at` only on a real success" is one rule,
 * and three copies of it is how the emailed state starts disagreeing with
 * reality.
 *
 * Deliberately AWAITED by its callers, not fire-and-forget like the app's other
 * notifications: its result is what decides whether the statement is marked
 * emailed, and the admin page turns an un-emailed statement into a "Email not
 * sent — Resend" link. A send that fails must never take the recorded transfer
 * down with it, so callers report `emailed: false` and keep the 200.
 */
export async function emailStatement(requestId: string, reversed: boolean): Promise<boolean> {
  let emailed = false
  try {
    emailed = reversed
      ? await notifyPayoutStatementReversed(requestId)
      : await notifyPayoutStatementIssued(requestId)
  } catch (e) {
    console.error('[payout-statement] email threw', e)
    return false
  }
  if (!emailed) return false

  const { error } = await createAdminClient()
    .from('payout_requests')
    .update({ statement_emailed_at: new Date().toISOString() })
    .eq('id', requestId)
  if (error) {
    // The mail really did go out, so the caller is still told `true`. The
    // statement will keep offering Resend, which sends a duplicate copy —
    // annoying, and strictly better than a stamp claiming a send that failed.
    console.error('[payout-statement] statement_emailed_at update failed:', error.message)
  }
  return true
}
