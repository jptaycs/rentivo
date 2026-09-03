'use client'

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

interface Props {
  billId: string | null
  qrImage: string | null
  amountLabel: string
  onClose: () => void
  onPaid: () => void
  verify: (id: string) => Promise<'paid' | 'processing' | 'unpaid' | 'error'>
}

/** QR Ph modal for a commission bill. Polls the bill row every 3 s (same
 *  pattern as BookingWizard's qrWaiting) until the webhook marks it paid;
 *  "I've paid" asks PayMongo directly via verify-payment. */
export function BillPayModal({ billId, qrImage, amountLabel, onClose, onPaid, verify }: Props) {
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!billId) return
    const supabase = createClient()
    const interval = setInterval(async () => {
      const { data } = await supabase.from('host_bills').select('status').eq('id', billId).maybeSingle()
      if (data?.status === 'paid') {
        clearInterval(interval)
        onPaid()
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [billId, onPaid])

  async function handleVerify() {
    if (!billId) return
    setChecking(true)
    setNote('')
    const s = await verify(billId)
    setChecking(false)
    if (s === 'paid') onPaid()
    else if (s === 'processing') setNote('PayMongo is still processing this payment. Give it a moment.')
    else if (s === 'unpaid') setNote("We couldn't see a payment yet. If you just scanned, wait a few seconds and try again.")
    else setNote("Couldn't check right now. Please try again.")
  }

  return (
    <Dialog open={Boolean(billId && qrImage)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md bg-white p-6 text-center">
        <DialogHeader>
          <DialogTitle className="text-[#111827]">Pay {amountLabel} via QR Ph</DialogTitle>
          <DialogDescription>Scan with any QR Ph-enabled bank or e-wallet app. This page updates automatically once the payment lands.</DialogDescription>
        </DialogHeader>
        {qrImage && <img src={qrImage} alt="QR Ph payment code" className="w-56 h-56 mx-auto rounded-xl" />}
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Waiting for payment…
        </div>
        {note && <p role="alert" className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">{note}</p>}
        <div className="flex gap-3 justify-center">
          <button type="button" onClick={handleVerify} disabled={checking} className="text-sm font-semibold text-[#003049] underline disabled:opacity-50">
            {checking ? 'Checking…' : "I've paid — check now"}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 flex items-center gap-1">
            <X className="w-3.5 h-3.5" /> Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
