import { getAppDb } from '@kb/db'
import type { H3Event } from 'h3'

export async function useDb() {
  return getAppDb()
}

export function devBypassAllowed() {
  if (process.env.NODE_ENV === 'production') return false
  if (process.env.VERCEL_ENV === 'production') return false
  return process.env.DEV_AUTH_BYPASS === 'true'
}

export function ownerEmail() {
  return (useRuntimeConfig().ownerEmail || process.env.OWNER_EMAIL || '').trim().toLowerCase()
}

export async function requireOwner(event: H3Event) {
  const session = await requireUserSession(event)
  const user = session.user
  if (!user?.workspaceId || user.role !== 'owner') {
    throw createError({ statusCode: 403, message: '只有擁有者可以操作' })
  }
  return user
}

export async function withApi<T>(work: () => Promise<T>) {
  try {
    return await work()
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    const message = error instanceof Error ? error.message : '發生錯誤'
    throw createError({ statusCode: 400, message })
  }
}

/** Continue queued AI work without blocking the HTTP response when the platform allows it. */
export function runQueuedJobs(event: H3Event, work: () => Promise<unknown>) {
  const run = Promise.resolve().then(work)
  const waitUntil = (event as H3Event & { waitUntil?: (promise: Promise<unknown>) => void }).waitUntil
  if (typeof waitUntil === 'function') {
    waitUntil(run)
    return
  }
  return run
}

/** Leave enough headroom under Vercel Hobby's 300s function limit. */
export const JOB_BUDGET_MS = 270_000
