import postgres from 'postgres'

// --- Config ---
const DATABASE_URL =
  process.env.DATABASE_URL ||
  (process.env.NODE_ENV === 'production' ? '' : 'postgresql://daf:daf_local@localhost:5432/daf')
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL required in production')
  process.exit(1)
}

export const sql = postgres(DATABASE_URL, { max: 20, idle_timeout: 30, connect_timeout: 10 })

// --- Multi-tenancy allowlist ---
export const ALLOWED_KOMMUNER = ['goteborg'] // expand as we add more

export function getSchema(kommun: string): string | null {
  if (!ALLOWED_KOMMUNER.includes(kommun)) return null
  return kommun
}
// Route handlers only run after the kommun-validation middleware, which
// already restricts `kommun` to ALLOWED_KOMMUNER — this just narrows the type
// so query code can use the schema name directly (via the sql() identifier
// helper, e.g. `${sql(schema)}.politiker`) instead of a hardcoded literal.
export function requireSchema(kommun: string): string {
  const schema = getSchema(kommun)
  if (!schema) throw new Error(`Unknown kommun: ${kommun}`)
  return schema
}
