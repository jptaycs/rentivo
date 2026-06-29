'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Mail, Loader2, AlertCircle, CheckCircle2, ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (authError) throw authError
      setSent(true)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center space-y-5">
        <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-[#22C55E]" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[#111827]">Check your email</h2>
          <p className="text-gray-500 mt-2 text-sm leading-relaxed">
            We sent a password reset link to{' '}
            <span className="font-semibold text-[#111827]">{email}</span>.
            Check your inbox and follow the link.
          </p>
        </div>
        <div className="bg-[#F8FAFC] rounded-xl p-4 text-sm text-gray-500 text-left space-y-1.5">
          <p>• The link expires in 1 hour</p>
          <p>• Check your spam folder if you don&apos;t see it</p>
          <p>• Make sure you entered the correct email</p>
        </div>
        <button
          onClick={() => { setSent(false); setEmail('') }}
          className="text-sm text-[#2563EB] hover:underline font-medium"
        >
          Try a different email
        </button>
        <div>
          <Link href="/login" className="flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-[#2563EB] transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back to Sign In
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <p className="text-sm text-gray-500 leading-relaxed">
        Enter the email address linked to your account and we&apos;ll send you a reset link.
      </p>

      <div>
        <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">Email</label>
        <div className="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-blue-100 transition-all bg-white">
          <Mail className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || !email}
        className="w-full bg-[#2563EB] hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : 'Send Reset Link'}
      </button>

      <Link
        href="/login"
        className="flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-[#2563EB] transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> Back to Sign In
      </Link>
    </form>
  )
}
