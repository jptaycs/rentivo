import { AuthShell } from '@/components/auth/AuthShell'
import { SignupForm } from '@/components/auth/SignupForm'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Create Account — Rentivo',
}

export default function SignupPage() {
  return (
    <AuthShell
      heading="Create your account"
      subheading="Join thousands of creators and hosts on Rentivo."
    >
      <SignupForm />
    </AuthShell>
  )
}
