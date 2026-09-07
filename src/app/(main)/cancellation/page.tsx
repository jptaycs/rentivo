export const metadata = { title: 'Cancellation Policy — Rentivo' }

export default function CancellationPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Cancellation Policy</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated September 8, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Renter cancellation</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            A renter can cancel a booking only while it is still awaiting the host&apos;s
            response — before the host has accepted it. Once a host has accepted a booking, the
            renter can no longer cancel it themselves.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Refund amount</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            If the cancelled booking was already paid, it is refunded in full. There is no
            cancellation fee and no reduced refund based on how close to the pickup date the
            cancellation happens.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Host decline</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            A host may decline a booking that is still awaiting their response. If the booking
            was already paid, the renter is refunded in full.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">No cancellation tiers</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo does not offer different cancellation tiers (for example, Flexible, Moderate,
            or Strict). Every eligible cancellation is handled the same way, as described above.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">How refunds are paid</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            A refund is returned to the original payment method through PayMongo and may take
            several banking days to appear, depending on your bank or e-wallet.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">Direct GCash/Maya QR payments</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            If a booking was paid directly to the host&apos;s own GCash or Maya QR code, Rentivo
            never received that payment and cannot refund it. If that booking is cancelled,
            arrange the refund directly with the host.
          </p>
        </section>

        <section className="space-y-3">
          <p className="text-sm text-gray-700 leading-relaxed">
            This page describes how Rentivo actually works. It is not legal advice.
          </p>
        </section>
      </div>
    </div>
  )
}
