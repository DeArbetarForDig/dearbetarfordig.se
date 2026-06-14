/**
 * Transcription pipeline
 *
 * 1. Download KF meeting video from YouTube (via yt-dlp binary)
 * 2. Extract audio
 * 3. Transcribe with Whisper API (or local whisper.cpp)
 * 4. Output structured JSON with timestamps
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Debatt } from '@daf/shared'

const OUTPUT_DIR = join(import.meta.dirname, '../../../data/debatter')
const TEMP_DIR = join(import.meta.dirname, '../../.tmp')

interface TranscriptionSegment {
  start: number
  end: number
  text: string
}

async function downloadAudio(youtubeUrl: string, outputPath: string): Promise<void> {
  console.log(`⬇️  Laddar ner audio: ${youtubeUrl}`)
  execSync(`yt-dlp -x --audio-format wav --audio-quality 0 -o "${outputPath}" "${youtubeUrl}"`, {
    stdio: 'inherit',
  })
}

async function transcribeWhisperApi(audioPath: string): Promise<TranscriptionSegment[]> {
  // OpenAI Whisper API
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set')

  const formData = new FormData()
  const audioFile = new Blob([readFileSync(audioPath)])
  formData.append('file', audioFile, 'audio.wav')
  formData.append('model', 'whisper-1')
  formData.append('language', 'sv')
  formData.append('response_format', 'verbose_json')
  formData.append('timestamp_granularities[]', 'segment')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  })

  const data = await res.json()
  return data.segments.map((s: any) => ({
    start: s.start,
    end: s.end,
    text: s.text,
  }))
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

async function main() {
  const youtubeUrl = process.argv[2]
  if (!youtubeUrl) {
    console.error('Usage: tsx run.ts <youtube-url>')
    process.exit(1)
  }

  mkdirSync(TEMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const audioPath = join(TEMP_DIR, 'kf-audio.wav')

  if (!existsSync(audioPath)) {
    await downloadAudio(youtubeUrl, audioPath)
  }

  console.log('🎤 Transkriberar...')
  const segments = await transcribeWhisperApi(audioPath)

  const output = {
    source: youtubeUrl,
    language: 'sv',
    segments: segments.map((s) => ({
      startTid: formatTime(s.start),
      slutTid: formatTime(s.end),
      text: s.text.trim(),
    })),
  }

  const filename = `kf-${new Date().toISOString().split('T')[0]}.json`
  writeFileSync(join(OUTPUT_DIR, filename), JSON.stringify(output, null, 2))
  console.log(`✅ Sparad: data/debatter/${filename}`)
}

main().catch(console.error)
