import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL || 'postgresql://daf:daf_local@localhost:5432/daf'
const client = postgres(connectionString)

export const db = drizzle(client, { schema })
