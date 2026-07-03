import type { MiddlewareHandler } from 'hono'

// Rate limiting (simple in-memory, per IP)
const rateMap = new Map<string, { count: number; reset: number }>()
// Buckets expire after their `reset` timestamp but are never removed on their
// own — without this, one entry per distinct IP (or the shared 'unknown'
// bucket) accumulates for the lifetime of the process. Prune stale buckets
// periodically instead of on every request to keep the sweep cheap.
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000
const rateMapCleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of rateMap) {
    if (entry.reset <= now) rateMap.delete(ip)
  }
}, RATE_LIMIT_CLEANUP_INTERVAL_MS)
// Don't let the cleanup timer keep the process (or test runner) alive.
rateMapCleanupTimer.unref?.()

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const ip = c.req.header('x-forwarded-for') || 'unknown'
  // Direct access without proxy header = local dev / SSG build — skip limiting
  if (ip === 'unknown' && process.env.NODE_ENV !== 'production') {
    await next()
    return
  }
  const now = Date.now()
  const entry = rateMap.get(ip)
  const limit = process.env.NODE_ENV === 'production' ? 200 : 5000
  if (entry && entry.reset > now) {
    if (entry.count >= limit) return c.json({ error: 'Rate limit exceeded (200/min)' }, 429)
    entry.count++
  } else {
    rateMap.set(ip, { count: 1, reset: now + 60_000 })
  }
  await next()
}
