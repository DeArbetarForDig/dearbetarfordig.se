import { pgSchema, uuid, text, integer, real, jsonb, timestamp, date } from 'drizzle-orm/pg-core'

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
})

export const möten = goteborg.table('moten', {
  id: uuid('id').primaryKey().defaultRandom(),
  datum: date('datum').notNull(),
  typ: text('typ').notNull().default('sammanträde'),
  organisation: text('organisation').notNull().default('Kommunfullmäktige'),
  videoUrl: text('video_url'),
  protokollUrl: text('protokoll_url'),
})

export const ärenden = goteborg.table('arenden', {
  id: text('id').primaryKey(), // kf-2025-11-27-§491
  möteId: uuid('mote_id').references(() => möten.id),
  paragraf: text('paragraf'),
  ärendeNr: text('arende_nr'),
  rubrik: text('rubrik').notNull(),
  beslut: text('beslut'), // bifall, avslag, bordläggning, återremiss
  votering: jsonb('votering'), // { ja, nej, avstår }
  röster: jsonb('roster'), // [{ namn, parti, röst }]
  yrkanden: jsonb('yrkanden'),
  reservationer: jsonb('reservationer'),
})

export const grafNodes = goteborg.table('graf_nodes', {
  id: text('id').primaryKey(),
  typ: text('typ').notNull(), // paragraf, lag, organisation, politiker, möte, dokument, budget, nämnd
  label: text('label').notNull(),
  data: jsonb('data').notNull().default({}),
})

export const grafEdges = goteborg.table('graf_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromId: text('from_id').notNull().references(() => grafNodes.id),
  toId: text('to_id').notNull().references(() => grafNodes.id),
  typ: text('typ').notNull(), // finansierar, beslut_av, uppdrag_till, etc.
  label: text('label'),
  data: jsonb('data'),
})

export const budget = goteborg.table('budget', {
  id: uuid('id').primaryKey().defaultRandom(),
  år: integer('ar').notNull(),
  nämnd: text('namnd').notNull(),
  kommunbidragMnkr: real('kommunbidrag_mnkr').notNull(),
  andelProcent: real('andel_procent'),
  styre: text('styre'),
})
