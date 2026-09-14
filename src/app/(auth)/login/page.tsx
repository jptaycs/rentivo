import { AuthShell } from '@/components/auth/AuthShell'
import { LoginForm } from '@/components/auth/LoginForm'
import { LoginHeading, LoginSubheading } from '@/components/auth/LoginHeading'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign In — Rentivo',
}

export default function LoginPage() {
  return (
    <AuthShell
      heading={<LoginHeading />}
      subheading={<LoginSubheading />}
    >
      <LoginForm />
    </AuthShell>
  )
}
