import Link from 'next/link'
import { Camera, Mail, CheckCircle2 } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Verify Email — Rentivo',
}

interface VerifyPageProps {
  searchParams: Promise<{ email?: string }>
}

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const { email } = await searchParams

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mb-10">
        <div className="w-9 h-9 bg-[#003049] rounded-xl flex items-center justify-center">
          <Camera className="w-5 h-5 text-white" />
        </div>
        <span className="text-xl font-bold text-[#111827]">Rentivo</span>
      </Link>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center max-w-md w-full">
        {/* Icon */}
        <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <Mail className="w-9 h-9 text-[#003049]" />
        </div>

        <h1 className="text-2xl font-bold text-[#111827] mb-2">Verify your email</h1>
        <p className="text-gray-500 text-sm leading-relaxed mb-6">
          We sent a verification link to{' '}
          {email ? (
            <span className="font-semibold text-[#111827]">{email}</span>
          ) : (
            'your email address'
          )}
          . Click the link to activate your account.
        </p>

        {/* Steps */}
        <div className="bg-[#F8FAFC] rounded-xl p-5 text-left space-y-3 mb-6">
          {[
            'Open the email from Rentivo',
            'Click the "Confirm your account" button',
            'You\'ll be redirected back to Rentivo',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-[#003049] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </div>
              <p className="text-sm text-gray-600">{step}</p>
            </div>
          ))}
        </div>

        {/* Tip */}
        <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3.5 mb-6">
          <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p>
            Don&apos;t see it? Check your <strong>spam or junk</strong> folder. The link expires in <strong>24 hours</strong>.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Link
            href="/login"
            className="text-sm text-[#003049] hover:underline font-medium"
          >
            Already verified? Sign in →
          </Link>
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
