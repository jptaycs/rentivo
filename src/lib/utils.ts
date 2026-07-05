import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Only allow same-origin paths: rejects //host, /\host, and http(s):// forms
export function safeRedirectPath(path: string | null | undefined, fallback = '/') {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
    return fallback
  }
  return path
}
