import { pgSchema, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const goteborg = pgSchema('goteborg')

export const politiker = goteborg.table('politiker', {
  id: uuid('id').primaryKey(),
  förnamn: text('fornamn').notNull(),
  efternamn: text('efternamn').notNull(),
  parti: text('parti').notNull(),
  email: text('email'),
  fotoUrl: text('foto_url'),
  sociala: jsonb('sociala'),
  uppdrag: jsonb('uppdrag').notNull().default([]),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_politiker_parti').on(t.parti),
])

export const grafNodes = goteborg.table('graf_nodes', {
  id: text('id').primaryKey(),
  typ: text('typ').notNull(),
  label: text('label').notNull(),
  data: jsonb('data').notNull().default({}),
}, (t) => [
  index('idx_graf_nodes_typ').on(t.typ),
])

export const dokument = goteborg.table('dokument', {
  id: text('id').primaryKey(),
  titel: text('titel').notNull(),
  typ: text('typ').notNull(),
  nämnd: text('namnd').notNull(),
  datum: text('datum').notNull(),
  källa: text('kalla').notNull(),
  innehåll: text('innehall').notNull(),
  grafNod: text('graf_nod'),
}, (t) => [
  index('idx_dokument_typ').on(t.typ),
  index('idx_dokument_fts').using('gin', t.innehåll),
])

export const grafEdges = goteborg.table('graf_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromId: text('from_id').notNull().references(() => grafNodes.id, { onDelete: 'cascade' }),
  toId: text('to_id').notNull().references(() => grafNodes.id, { onDelete: 'cascade' }),
  typ: text('typ').notNull(),
  label: text('label'),
  data: jsonb('data'),
}, (t) => [
  index('idx_graf_edges_from').on(t.fromId),
  index('idx_graf_edges_to').on(t.toId),
  index('idx_graf_edges_typ').on(t.typ),
])
