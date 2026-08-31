'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { CheckCircle2, Download, MessageCircle, Calendar, MapPin, Shield, Clock } from 'lucide-react'
import type { Listing, Booking } from '@/types'

interface Step4ConfirmationProps {
  listing: Listing
  booking: Booking
}

const METHOD_LABELS: Record<string, string> = {
  gcash: 'GCash',
  maya: 'Maya',
  card: 'Credit Card',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  host_qr: 'GCash/Maya QR',
}

export function Step4Confirmation({ listing, booking }: Step4ConfirmationProps) {
  const days = booking.total_days
  const isConfirmed = booking.status === 'confirmed'
  const isAwaitingQrPayment = booking.payment_method === 'host_qr' && booking.payment_status === 'unpaid'
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!isAwaitingQrPayment) return
    fetch(`/api/bookings/${booking.id}/qr`)
      .then((r) => r.json())
      .then((d) => setQrUrl(d.url ?? null))
      .catch(() => setQrUrl(null))
  }, [isAwaitingQrPayment, booking.id])

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', {
      weekday: 'short',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })

  return (
    <div className="space-y-8">
      {/* Success header */}
      <div className="text-center py-4">
        <div className={`w-20 h-20 ${isConfirmed ? 'bg-green-50' : 'bg-blue-50'} rounded-full flex items-center justify-center mx-auto mb-5`}>
          {isConfirmed ? (
            <CheckCircle2 className="w-10 h-10 text-[#22C55E]" />
          ) : (
            <Clock className="w-10 h-10 text-[#003049]" />
          )}
        </div>
        <h2 className="text-3xl font-bold text-[#111827]">
          {isAwaitingQrPayment ? 'Booking Created!' : isConfirmed ? 'Booking Confirmed!' : 'Payment Received!'}
        </h2>
        <p className="text-gray-500 mt-2">
          {isAwaitingQrPayment
            ? 'Scan the QR code below to pay the host directly. They’ll confirm your booking once payment arrives.'
            : isConfirmed
              ? 'Your rental is confirmed. The host has been notified.'
              : 'Your payment is in — the host will confirm your booking shortly.'}
        </p>
        <div className="mt-4 inline-flex items-center gap-2 bg-[#F8FAFC] border border-gray-200 rounded-full px-5 py-2">
          <span className="text-xs text-gray-500 font-medium">Booking Reference</span>
          <span className="text-sm font-bold text-[#003049] tracking-wider">{booking.booking_ref}</span>
        </div>
      </div>

      {isAwaitingQrPayment && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center space-y-3">
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL from a private bucket, not a next/image remotePattern candidate
            <img src={qrUrl} alt="Host's payment QR code" className="w-56 h-56 mx-auto rounded-xl object-cover" />
          ) : (
            <div className="w-56 h-56 mx-auto rounded-xl bg-gray-100 flex items-center justify-center text-sm text-gray-400">
              Loading QR code…
            </div>
          )}
          <p className="text-sm font-semibold text-[#111827]">
            {listing.host?.qr_payment_label}
          </p>
          <p className="text-xs text-gray-500">
            Pay ₱{booking.total_amount.toLocaleString()} — Rentivo doesn&apos;t process or hold this
            payment.
          </p>
        </div>
      )}

      {/* Digital receipt */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* Receipt header */}
        <div className="bg-[#003049] px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-xs font-medium">Digital Receipt</p>
            <p className="text-white font-bold">{booking.booking_ref}</p>
          </div>
          <button className="flex items-center gap-1.5 text-xs text-blue-100 hover:text-white transition-colors bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">
            <Download className="w-3.5 h-3.5" />
            Download PDF
          </button>
        </div>

        {/* Listing row */}
        <div className="flex items-center gap-4 p-5 border-b border-gray-100">
          <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0">
            <Image
              src={listing.images[0] ?? '/placeholder-equipment.jpg'}
              alt={listing.title}
              fill
              className="object-cover"
              sizes="64px"
            />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">{listing.brand}</p>
            <p className="font-bold text-[#111827]">{listing.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{listing.city}, {listing.province}</p>
          </div>
        </div>

        {/* Booking details */}
        <div className="divide-y divide-gray-100">
          {[
            {
              icon: Calendar,
              label: 'Pickup Date',
              value: fmt(booking.pickup_date),
            },
            {
              icon: Calendar,
              label: 'Return Date',
              value: fmt(booking.return_date),
            },
            {
              icon: MapPin,
              label: 'Method',
              value: booking.is_delivery ? 'Delivery to your address' : `Pickup from host in ${listing.city}`,
            },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center justify-between px-5 py-3.5">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Icon className="w-4 h-4 text-[#003049]" />
                {label}
              </div>
              <span className="text-sm font-medium text-[#111827] text-right max-w-[60%]">{value}</span>
            </div>
          ))}
        </div>

        {/* Price breakdown */}
        <div className="px-5 py-4 bg-[#F8FAFC] space-y-2 text-sm border-t border-gray-100">
          <div className="flex justify-between text-gray-600">
            <span>Rental fee ({days} day{days > 1 ? 's' : ''})</span>
            <span>₱{booking.rental_fee.toLocaleString()}</span>
          </div>
          {booking.discount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Promo {booking.promo_code}</span>
              <span>−₱{booking.discount.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between text-gray-600">
            <span>Service fee</span>
            <span>₱{booking.service_fee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Protection fee</span>
            <span>₱{booking.protection_fee.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Security deposit</span>
            <span>₱{booking.security_deposit.toLocaleString()}</span>
          </div>
          <div className="flex justify-between font-bold text-[#111827] text-base border-t border-gray-200 pt-2 mt-1">
            <span>{isAwaitingQrPayment ? 'Total Due' : 'Total Paid'}</span>
            <span className="text-[#003049]">₱{booking.total_amount.toLocaleString()}</span>
          </div>
        </div>

        {/* Payment method */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100">
          <span className="text-sm text-gray-500">Payment Method</span>
          <span className="text-sm font-semibold text-[#111827]">
            {(booking.payment_method && METHOD_LABELS[booking.payment_method]) ?? '—'}
          </span>
        </div>
      </div>

      {/* Protection badge */}
      <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-100 rounded-xl text-sm text-green-800">
        <Shield className="w-5 h-5 text-[#22C55E] shrink-0" />
        <p>
          Your rental is covered by Rentivo&apos;s <strong>Equipment Protection Plan</strong>. In case of damage or loss, contact support within 24 hours of your return date.
        </p>
      </div>

      {/* Next steps */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-bold text-[#111827] mb-3">What&apos;s next?</h3>
        <ol className="space-y-3">
          {[
            isConfirmed
              ? 'Your booking is confirmed — no further action needed.'
              : 'The host will confirm your booking within 24 hours.',
            booking.is_delivery
              ? 'The host will reach out to coordinate delivery.'
              : 'You will receive the exact pickup address once confirmed.',
            'Message the host if you have any questions.',
            'Return the equipment in the same condition by the return date.',
          ].map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-600">
              <span className="w-5 h-5 rounded-full bg-[#003049] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* CTA buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button className="flex-1 flex items-center justify-center gap-2 border border-[#003049] text-[#003049] font-bold py-3.5 rounded-xl text-sm hover:bg-blue-50 transition-colors">
          <MessageCircle className="w-4 h-4" />
          Message Host
        </button>
        <Link
          href="/dashboard"
          className="flex-1 flex items-center justify-center bg-[#003049] hover:bg-[#002438] text-white font-bold py-3.5 rounded-xl text-sm transition-colors"
        >
          View My Bookings
        </Link>
      </div>

      <div className="text-center">
        <Link href="/" className="text-sm text-gray-400 hover:text-[#003049] transition-colors">
          ← Back to Home
        </Link>
      </div>
    </div>
  )
}
