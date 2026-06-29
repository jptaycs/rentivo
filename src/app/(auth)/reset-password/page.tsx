import { AuthShell } from '@/components/auth/AuthShell'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'New Password — Rentivo',
}

export default function ResetPasswordPage() {
  return (
    <AuthShell
      heading="Set a new password"
      subheading="Choose a strong password for your account."
    >
      <ResetPasswordForm />
    </AuthShell>
  )
}
