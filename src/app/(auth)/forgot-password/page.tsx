import { AuthShell } from '@/components/auth/AuthShell'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Reset Password — Rentivo',
}

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      heading="Forgot your password?"
      subheading="No worries — we'll send you a reset link."
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
