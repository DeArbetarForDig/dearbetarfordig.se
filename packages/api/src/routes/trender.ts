import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

export const trenderRouter = new OpenAPIHono()

// Kolada (api.kolada.se/v3, SKR/RKA:s öppna kommunstatistik) — Göteborgs
// egna trender över tid (skola, äldreomsorg, arbetsmarknad, miljö, ekonomi,
// personal), parat mot motsvarande nämnds kommunbidrag där en rimlig
// koppling finns. INTE en jämförelse mot andra kommuner — syftet är att
// synliggöra frågor typ "skolans budget ökar men resultaten står stilla".
// Litet, statiskt referensdataset (uppdateras när pipeline/kolada.ts körs
// om) — serveras direkt från fil, ingen databas behövs.
const DataPunkt = z.object({ år: z.number(), värde: z.number().nullable() })
const Förändring = z.object({ från: z.number(), till: z.number(), procent: z.number() }).nullable()

const TrendKpi = z.object({
  id: z.string(),
  namn: z.string(),
  kategori: z.string(),
  enhet: z.string(),
  nämndId: z.string().optional(),
  nämndNamn: z.string().optional(),
  göteborg: z.array(DataPunkt),
  utfallÄndring: Förändring,
  budget: z.array(DataPunkt).optional(),
  budgetÄndring: Förändring.optional(),
})

const trenderRoute = createRoute({
  method: 'get',
  path: '/v1/{kommun}/trender',
  tags: ['Trender'],
  summary:
    'Göteborgs trender över tid (Kolada) parat mot nämndbudget — skola, äldreomsorg, miljö m.fl.',
  request: { params: z.object({ kommun: z.string() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ kpis: z.array(TrendKpi) }).openapi('Trender'),
        },
      },
      description: 'OK',
    },
  },
})
trenderRouter.openapi(trenderRoute, async (c) => {
  const filePath = join(import.meta.dirname, '../../../../data/kolada/kpi-trender.json')
  if (!existsSync(filePath)) return c.json({ kpis: [] }, 200)
  const data = JSON.parse(readFileSync(filePath, 'utf-8'))
  return c.json(data, 200)
})
