export function capLimit(val: string | undefined, max = 200): number {
  return Math.min(Math.max(Number.parseInt(val || '50') || 50, 1), max)
}
