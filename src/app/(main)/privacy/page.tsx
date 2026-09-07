import Link from 'next/link'

export const metadata = { title: 'Privacy Policy — Rentivo' }

export default function PrivacyPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-[#111827]">Privacy Policy</h1>
          <p className="mt-2 text-sm text-gray-500">Last updated September 8, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">1. Who we are</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo is operated by Appnado IT Solutions, a business registered with the
            Philippine Department of Trade and Industry (DTI) and the Bureau of Internal
            Revenue (BIR). For the purposes of the Data Privacy Act of 2012 (RA 10173),
            Appnado IT Solutions is the Personal Information Controller for the data
            described on this page. For any privacy question, request, or concern, email{' '}
            <a href="mailto:jptayco1109@gmail.com" className="text-[#003049] underline">
              jptayco1109@gmail.com
            </a>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">2. What we collect</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            We collect the information you give us directly, plus the records the
            marketplace itself has to create as bookings happen:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>
              <span className="font-semibold">Account information:</span> your name,
              email address, avatar, bio, and city.
            </li>
            <li>
              <span className="font-semibold">Identity verification:</span> a
              government-issued ID and a selfie, used to confirm hosts are who they say
              they are before they can list gear. This is sensitive personal
              information under RA 10173 §3(l), and it is stored in a private,
              access-controlled file storage bucket that only our review process and
              service systems can reach — it is never public.
            </li>
            <li>
              <span className="font-semibold">Listings:</span> equipment photos, serial
              numbers, the street address and exact pickup coordinates a host sets for
              pickup, and pricing.
            </li>
            <li>
              <span className="font-semibold">Bookings:</span> rental dates, the amounts
              charged, and delivery addresses when delivery is chosen.
            </li>
            <li>
              <span className="font-semibold">Messages:</span> the content of messages
              between renters and hosts, and any images attached to them.
            </li>
            <li>
              <span className="font-semibold">Payout details:</span> the bank or
              e-wallet account number and account name a host provides to receive
              payouts.
            </li>
            <li>
              <span className="font-semibold">Host QR payment labels:</span> if a host
              enables direct GCash/Maya QR payment, the label shown to renters contains
              that host&apos;s real name and mobile number.
            </li>
            <li>
              <span className="font-semibold">Wishlist and recently-viewed history:</span>{' '}
              the listings you save or view, so we can show them back to you.
            </li>
            <li>
              <span className="font-semibold">Reviews:</span> after a completed
              booking, the rating and written comment you leave are visible
              publicly on the listing page and on the reviewed person&apos;s host
              profile, along with your display name.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">3. Why we collect it</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            We use this information to operate the marketplace: to create and manage
            accounts and listings, to verify host identity so renters can trust who
            they&apos;re renting from, to process bookings and payments, to send
            transactional email about your bookings and account, and to detect and
            prevent fraud and abuse of the platform.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">4. Who else processes it</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Running Rentivo means some of your data passes through the services we
            build on. We use:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-sm text-gray-700 leading-relaxed">
            <li>
              <span className="font-semibold">Supabase</span> — our database,
              authentication, and file storage provider.
            </li>
            <li>
              <span className="font-semibold">Vercel</span> — hosts Rentivo at
              rentivo.live.
            </li>
            <li>
              <span className="font-semibold">PayMongo</span> — processes payments.
              Your browser communicates with PayMongo directly to tokenize card
              details, and our server communicates with PayMongo to create payment
              intents and refunds.
            </li>
            <li>
              <span className="font-semibold">Resend</span> — sends transactional email
              on our behalf, from <span className="font-mono">noreply@rentivo.live</span>.
            </li>
            <li>
              <span className="font-semibold">Google</span> — only if you choose to
              sign in with Google. Your avatar may then be served from Google&apos;s own
              image servers.
            </li>
            <li>
              <span className="font-semibold">Esri</span> — supplies the map tiles on
              listing and search pages. Your browser fetches these tiles directly from
              Esri, so Esri sees your IP address when a map loads.
            </li>
            <li>
              <span className="font-semibold">Unsplash</span> — supplies placeholder
              listing photography where a host hasn&apos;t uploaded their own images.
            </li>
          </ul>
          <p className="text-sm text-gray-700 leading-relaxed">
            Some of these providers process data on servers located outside the
            Philippines.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">5. What stays on your device</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            When you upload your ID and selfie for verification, we run an automatic
            check to catch the wrong photo being uploaded by mistake — for example, a
            product photo instead of an ID. That check runs entirely in your browser:
            your image is analyzed on your own device and is never sent anywhere for
            that analysis. The detection library we use has a built-in telemetry
            feature that would otherwise phone home to Google&apos;s servers; our site&apos;s
            Content-Security-Policy blocks that request outright, so it never leaves
            your device either. This on-device check is separate from the ID image
            itself, which is uploaded to our private verification storage so a human
            reviewer can approve your identity — see the section above.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">6. Retention and deletion</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            When you delete your Rentivo account, we anonymize your profile rather than
            erasing it outright. Your bookings, reviews, and messages reference your
            profile, and other people&apos;s records of their own rentals depend on that
            reference — erasing it would destroy the other party&apos;s history along with
            yours. Instead, your name, avatar, bio, and other personal fields are
            replaced with placeholder &quot;Deleted User&quot; values, and your account is
            deactivated so you can no longer sign in.
          </p>
          <p className="text-sm text-gray-700 leading-relaxed">
            At that point, we permanently delete your identity verification documents,
            notifications, wishlist, and recently-viewed history. We keep financial
            records — commission bills and payout requests — because they are
            accounting records, and we keep message threads because they are also the
            other party&apos;s record of the conversation, not yours alone.
          </p>
          <p className="text-sm text-gray-700 leading-relaxed">
            Account deletion is blocked while you have an in-flight booking, a pending
            payout request, or an unpaid commission bill outstanding, so that deleting
            an account never strands money or a rental that&apos;s still in progress.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">
            7. Your rights under the Data Privacy Act
          </h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            As a data subject under RA 10173, you have the right to be informed about
            how your personal information is processed; to access it; to correct it if
            it is inaccurate; to have it erased or blocked, subject to the retention
            obligations described above; to object to certain processing; to claim
            damages for violations of your rights; to data portability; and to lodge a
            complaint with the National Privacy Commission. To exercise any of these
            rights, email us at{' '}
            <a href="mailto:jptayco1109@gmail.com" className="text-[#003049] underline">
              jptayco1109@gmail.com
            </a>{' '}
            and we&apos;ll respond directly.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">8. Cookies</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            Rentivo sets an authentication session cookie so you can stay signed in.
            If you browse without an account, we use your browser&apos;s local storage
            — not a cookie — to remember your wishlist and recently-viewed listings
            so they&apos;re still there when you come back. Once you sign in, those
            same lists move into our database instead (see &quot;What we collect&quot;
            above). We do not use advertising cookies or any third-party tracking
            cookies.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-[#111827]">9. Changes to this policy</h2>
          <p className="text-sm text-gray-700 leading-relaxed">
            If how Rentivo collects or uses personal information changes, we&apos;ll
            update this page and its &quot;Last updated&quot; date. See also our{' '}
            <Link href="/host-terms" className="text-[#003049] underline">
              Host Terms
            </Link>
            .
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
