import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('/*', cors())

app.get('/', (c) =>
  c.json({
    name: 'De Arbetar För Dig — API',
    version: '0.1.0',
    docs: '/docs',
  }),
)

// Tenant-scoped routes
app.get('/api/v1/:kommun/politiker', async (c) => {
  const kommun = c.req.param('kommun')
  // TODO: fetch from DB
  return c.json({ kommun, politiker: [] })
})

app.get('/api/v1/:kommun/beslut', async (c) => {
  const kommun = c.req.param('kommun')
  return c.json({ kommun, beslut: [] })
})

app.get('/api/v1/:kommun/debatter', async (c) => {
  const kommun = c.req.param('kommun')
  return c.json({ kommun, debatter: [] })
})

export default {
  port: 3000,
  fetch: app.fetch,
}
