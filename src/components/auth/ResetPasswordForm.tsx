'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, Loader2, Lock, AlertCircle, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: '8+ characters', ok: password.length >= 8 },
    { label: 'Uppercase letter', ok: /[A-Z]/.test(password) },
    { label: 'Number', ok: /\d/.test(password) },
  ]
  const passed = checks.filter((c) => c.ok).length
  const colors = ['bg-red-400', 'bg-amber-400', 'bg-[#22C55E]']
  if (!password) return null
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i < passed ? colors[passed - 1] : 'bg-gray-200'}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        {checks.map((c) => (
          <span key={c.label} className={`flex items-center gap-1 text-[11px] ${c.ok ? 'text-[#22C55E]' : 'text-gray-400'}`}>
            <CheckCircle2 className="w-3 h-3" />{c.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ResetPasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const passwordStrong = password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password)
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0
  const canSubmit = passwordStrong && passwordsMatch && !loading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.updateUser({ password })
      if (authError) throw authError
      setDone(true)
      setTimeout(() => router.push('/'), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="text-center space-y-5">
        <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-[#22C55E]" />
        </div>
        <h2 className="text-xl font-bold text-[#111827]">Password updated!</h2>
        <p className="text-gray-500 text-sm">Your password has been reset successfully. Redirecting you home…</p>
        <Link href="/" className="inline-block bg-[#003049] text-white font-bold py-3 px-8 rounded-xl text-sm hover:bg-[#002438] transition-colors">
          Go to Home
        </Link>
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

      <div>
        <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">New Password</label>
        <div className="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 focus-within:border-[#003049] focus-within:ring-2 focus-within:ring-blue-100 transition-all bg-white">
          <Lock className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="new-password"
            className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
          />
          <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-gray-400 hover:text-gray-600">
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <PasswordStrength password={password} />
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">Confirm New Password</label>
        <div className={`flex items-center gap-3 border rounded-xl px-4 py-3 focus-within:ring-2 transition-all bg-white ${
          confirmPassword && !passwordsMatch
            ? 'border-red-300 focus-within:ring-red-100'
            : 'border-gray-200 focus-within:border-[#003049] focus-within:ring-blue-100'
        }`}>
          <Lock className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="new-password"
            className="flex-1 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent"
          />
          {passwordsMatch && <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />}
        </div>
        {confirmPassword && !passwordsMatch && (
          <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full bg-[#003049] hover:bg-[#002438] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating…</> : 'Update Password'}
      </button>
    </form>
  )
}
