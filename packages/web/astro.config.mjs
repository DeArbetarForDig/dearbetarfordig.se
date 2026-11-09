import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import markdownTwins from './markdown-twins.mjs'

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
  site: 'https://dearbetarfordig.se',
  integrations: [sitemap(), markdownTwins()],
})
