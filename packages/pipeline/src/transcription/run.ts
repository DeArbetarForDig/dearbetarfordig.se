/**
 * Transcription pipeline — KF-möten från YouTube → text
 *
 * Flow:
 * 1. yt-dlp: download audio (wav 16kHz mono)
 * 2. whisper-cli: transcribe → JSON with timestamps
 * 3. Cleanup: delete audio, keep only transcription
 *
 * Kör lokalt: npx tsx src/transcription/run.ts <youtube-url> [datum]
 * Kör via Docker: docker compose run whisper <url>
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/debatter')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')
const MODEL = process.env.WHISPER_MODEL || findModel()

function findModel(): string {
  // Local brew install
  const brewModel = '/opt/homebrew/Cellar/whisper-cpp/1.8.4/share/whisper-cpp/for-tests-ggml-tiny.bin'
  const tmpModel = join(TMP_DIR, 'ggml-small.bin')
  const dockerModel = '/models/ggml-small.bin'

  if (existsSync(tmpModel)) return tmpModel
  if (existsSync(dockerModel)) return dockerModel
  if (existsSync(brewModel)) return brewModel
  return tmpModel // will need to be downloaded
}

function downloadAudio(url: string, outPath: string): void {
  console.log(`⬇️  Laddar ner audio...`)
  execSync(
    `yt-dlp --extract-audio --audio-format wav --postprocessor-args "-ar 16000 -ac 1" -o "${outPath}" "${url}"`,
    { stdio: 'inherit', timeout: 600_000 },
  )
}

function transcribe(audioPath: string, outputPath: string): void {
  console.log(`🎤 Transkriberar (${MODEL.split('/').pop()})...`)
  execSync(
    `whisper-cli -m "${MODEL}" -l sv -f "${audioPath}" -oj --output-file "${outputPath}"`,
    { stdio: 'inherit', timeout: 7200_000 }, // 2h timeout for long meetings
  )
}

function parseWhisperJson(jsonPath: string): Array<{ start: string; end: string; text: string }> {
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const segments = raw.transcription || raw.segments || []
  return segments.map((s: any) => ({
    start: s.timestamps?.from || s.start || '',
    end: s.timestamps?.to || s.end || '',
    text: (s.text || '').trim(),
  })).filter((s: any) => s.text.length > 0)
}

async function main() {
  const url = process.argv[2]
  const datum = process.argv[3]

  if (!url) {
    console.error('Usage: npx tsx src/transcription/run.ts <youtube-url> [datum]')
    console.error('  npx tsx src/transcription/run.ts https://youtube.com/watch?v=BKoNfSHdE7Y 2026-01-29')
    process.exit(1)
  }

  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Extract video ID for filename
  const videoId = url.match(/[?&]v=([^&]+)/)?.[1] || 'unknown'
  const audioPath = join(TMP_DIR, `kf-${videoId}.wav`)
  const whisperOutPath = join(TMP_DIR, `kf-${videoId}`)

  // Step 1: Download audio
  if (!existsSync(audioPath)) {
    downloadAudio(url, audioPath)
  } else {
    console.log(`   Audio finns redan: ${audioPath}`)
  }

  // Step 2: Transcribe
  const jsonResult = `${whisperOutPath}.wav.json`
  if (!existsSync(jsonResult)) {
    transcribe(audioPath, whisperOutPath)
  }

  // Step 3: Parse and save
  const segments = parseWhisperJson(jsonResult)
  console.log(`\n   ${segments.length} segment transkriberade`)

  const output = {
    källa: url,
    videoId,
    datum: datum || null,
    språk: 'sv',
    modell: MODEL.split('/').pop(),
    transkriberad: new Date().toISOString(),
    antalSegment: segments.length,
    segment: segments,
  }

  const outFile = datum ? `kf-${datum}.json` : `kf-${videoId}.json`
  const outPath = join(OUTPUT_DIR, outFile)
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`✅ ${outPath}`)

  // Step 4: Cleanup audio (keep only transcription)
  unlinkSync(audioPath)
  unlinkSync(jsonResult)
  console.log(`🗑️  Audio raderat (sparar bara text)`)
}

main().catch(console.error)
