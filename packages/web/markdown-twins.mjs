/**
 * Markdown twins — after `astro build`, write a Markdown copy of every page's
 * <main> next to it, so LLM agents can read /x/y.md instead of /x/y/ (HTML is
 * ~5x the tokens). Root becomes /index.md. Base.astro advertises the twin via
 * <link rel="alternate" type="text/markdown">; /llms.txt links the key ones.
 *
 * GitHub Pages can't do Accept-negotiation or Link headers, so this is the
 * static-hosting subset of https://llmstxt.org.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromHtml } from 'hast-util-from-html'
import { toMdast } from 'hast-util-to-mdast'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'

const DROP = new Set(['script', 'style', 'svg', 'button', 'template', 'noscript', 'canvas'])

function findMain(node) {
  if (node.tagName === 'main') return node
  for (const child of node.children ?? []) {
    const found = findMain(child)
    if (found) return found
  }
}

function prune(node) {
  if (node.children) {
    node.children = node.children.filter(
      (c) => !(c.type === 'element' && (DROP.has(c.tagName) || c.properties?.hidden)),
    )
    node.children.forEach(prune)
  }
  return node
}

/** HTML document → Markdown of its <main>, or null if there is none. */
export function htmlToMarkdown(html) {
  const main = findMain(fromHtml(html))
  if (!main) return null
  return toMarkdown(toMdast(prune(main)), { extensions: [gfmToMarkdown()] })
}

/** a/b/index.html → a/b.md, index.html → index.md, a/x.html → a/x.md */
export function twinPath(htmlRel) {
  if (htmlRel === 'index.html') return 'index.md'
  return htmlRel.replace(/\/index\.html$|\.html$/, '.md')
}

export default function markdownTwins() {
  return {
    name: 'markdown-twins',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir)
        const files = (await readdir(root, { recursive: true })).filter((f) => f.endsWith('.html'))
        let n = 0
        for (const f of files) {
          const md = htmlToMarkdown(await readFile(join(root, f), 'utf8'))
          if (md) {
            await writeFile(join(root, twinPath(f)), md)
            n++
          }
        }
        logger.info(`${n} Markdown twins written`)
      },
    },
  }
}
