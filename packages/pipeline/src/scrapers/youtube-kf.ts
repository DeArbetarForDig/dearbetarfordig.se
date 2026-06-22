/**
 * Scraper: YouTube — KF Göteborg mötesvideor
 *
 * Kanal: "KF Göteborg" (UCfMv_VO3uZ52cZhvX-Sy6Ag)
 * Titelmönster: "Göteborg kommunfullmäktige YYYY-MM-DD"
 *
 * Använder yt-dlp för att lista alla videor med metadata.
 * Fallback: YouTube search API via curl om yt-dlp inte installerad.
 */

import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHANNEL_ID = 'UCfMv_VO3uZ52cZhvX-Sy6Ag'
const CHANNEL_URL = `https://www.youtube.com/channel/${CHANNEL_ID}/videos`
const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/debatter')

interface KFVideo {
  videoId: string
  title: string
  date: string | null
  url: string
  duration: string | null
  uploadDate: string | null
}

function parseKFDate(title: string): string | null {
  const match = title.match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function scrapeWithYtDlp(): KFVideo[] {
  console.log('   Använder yt-dlp...')
  const raw = execSync(
    `yt-dlp --flat-playlist --print "%(id)s\t%(title)s\t%(duration_string)s\t%(upload_date)s" "${CHANNEL_URL}"`,
    { encoding: 'utf-8', timeout: 60_000 },
  )

  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [videoId, title, duration, uploadDate] = line.split('\t')
      return {
        videoId,
        title,
        date: parseKFDate(title),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        duration: duration || null,
        uploadDate: uploadDate || null,
      }
    })
    .filter((v) => v.title.toLowerCase().includes('kommunfullmäktige'))
}

function scrapeWithCurl(): KFVideo[] {
  console.log('   yt-dlp inte hittad, använder YouTube search fallback...')
  const searchUrl =
    'https://www.youtube.com/results?search_query=%22G%C3%B6teborg+kommunfullm%C3%A4ktige%22&sp=CAI%3D'
  const html = execSync(`curl -sL "${searchUrl}"`, { encoding: 'utf-8', timeout: 30_000 })

  const videoIds = [
    ...new Set(html.match(/"videoId":"([^"]+)"/g)?.map((m) => m.slice(11, -1)) || []),
  ]

  return videoIds.map((videoId) => ({
    videoId,
    title: `Göteborg kommunfullmäktige (ID: ${videoId})`,
    date: null,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    duration: null,
    uploadDate: null,
  }))
}

function hasYtDlp(): boolean {
  try {
    execSync('which yt-dlp', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function main() {
  console.log('🎬 Hämtar KF Göteborg mötesvideor från YouTube...\n')
  console.log(`   Kanal: KF Göteborg (${CHANNEL_ID})`)

  let videos: KFVideo[]
  if (hasYtDlp()) {
    videos = scrapeWithYtDlp()
  } else {
    videos = scrapeWithCurl()
  }

  console.log(`\n   Hittade ${videos.length} KF-videor`)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  const output = {
    källa: CHANNEL_URL,
    kanal: 'KF Göteborg',
    kanalId: CHANNEL_ID,
    hämtad: new Date().toISOString(),
    antal: videos.length,
    videor: videos.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  }

  const outPath = join(OUTPUT_DIR, 'youtube-kf-goteborg.json')
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`✅ Sparad: ${outPath}`)
}

main().catch(console.error)
