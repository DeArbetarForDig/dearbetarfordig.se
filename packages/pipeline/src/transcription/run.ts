/**
 * Transcription pipeline — KF-möten från YouTube → text
 *
 * Chunked approach: splits audio into 30s chunks for reliable whisper output.
 *
 * Flow:
 * 1. yt-dlp → full WAV (16kHz mono)
 * 2. ffmpeg → split into 30s chunks
 * 3. whisper-cli → transcribe each chunk
 * 4. Merge → final JSON with correct timestamps
 * 5. Cleanup → delete all audio
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/debatter')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')
const CHUNK_SECONDS = 30
const MODEL = process.env.WHISPER_MODEL || join(TMP_DIR, 'ggml-small.bin')

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function downloadAudio(url: string, outPath: string): void {
  console.log(`⬇️  Laddar ner audio...`)
  execSync(
    `yt-dlp --extract-audio --audio-format wav --postprocessor-args "-ar 16000 -ac 1" -o "${outPath}" "${url}"`,
    { stdio: 'inherit', timeout: 1800_000 },
  )
}

function splitIntoChunks(audioPath: string, chunksDir: string): number {
  mkdirSync(chunksDir, { recursive: true })
  execSync(
    `ffmpeg -y -i "${audioPath}" -f segment -segment_time ${CHUNK_SECONDS} -c copy "${chunksDir}/chunk_%04d.wav"`,
    { stdio: 'pipe', timeout: 600_000 },
  )
  return readdirSync(chunksDir).filter(f => f.endsWith('.wav')).length
}

function transcribeChunk(chunkPath: string): Array<{ start: number; end: number; text: string }> {
  const outBase = chunkPath.replace('.wav', '')
  try {
    execSync(`whisper-cli -m "${MODEL}" -l sv -f "${chunkPath}" -oj --output-file "${outBase}"`, { stdio: 'pipe', timeout: 120_000 })
  } catch {
    return []
  }

  // whisper-cli outputs to <outBase>.json
  const jsonPath = `${outBase}.json`
  if (!existsSync(jsonPath)) return []

  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  const segments = raw.transcription || []
  unlinkSync(jsonPath)

  return segments.map((s: any) => {
    const from = s.timestamps?.from || '00:00:00,000'
    const to = s.timestamps?.to || '00:00:00,000'
    const parseTs = (ts: string) => {
      const parts = ts.replace(',', '.').split(':')
      return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
    }
    return { start: parseTs(from), end: parseTs(to), text: (s.text || '').trim() }
  }).filter((s: any) => s.text.length > 0)
}

async function main() {
  const url = process.argv[2]
  const datum = process.argv[3]

  if (!url) {
    console.error('Usage: npx tsx src/transcription/run.ts <youtube-url> [datum]')
    process.exit(1)
  }

  if (!existsSync(MODEL)) {
    console.error(`Model saknas: ${MODEL}`)
    console.error('Ladda ner: curl -sL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin -o .tmp/ggml-small.bin')
    process.exit(1)
  }

  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const videoId = url.match(/[?&]v=([^&]+)/)?.[1] || 'unknown'
  const audioPath = join(TMP_DIR, `kf-${videoId}.wav`)
  const chunksDir = join(TMP_DIR, `chunks-${videoId}`)

  // Step 1: Download
  if (!existsSync(audioPath)) {
    downloadAudio(url, audioPath)
  }

  // Step 2: Split into chunks
  console.log(`✂️  Delar upp i ${CHUNK_SECONDS}s-segment...`)
  const numChunks = splitIntoChunks(audioPath, chunksDir)
  console.log(`   ${numChunks} chunks`)

  // Step 3: Transcribe each chunk
  console.log(`🎤 Transkriberar...`)
  const allSegments: Array<{ start: string; end: string; text: string }> = []
  const chunkFiles = readdirSync(chunksDir).filter(f => f.endsWith('.wav')).sort()

  for (let i = 0; i < chunkFiles.length; i++) {
    const chunkPath = join(chunksDir, chunkFiles[i])
    const offsetSeconds = i * CHUNK_SECONDS
    process.stdout.write(`   [${i + 1}/${numChunks}] ${formatTime(offsetSeconds)}...`)

    const segments = transcribeChunk(chunkPath)
    for (const seg of segments) {
      allSegments.push({
        start: formatTime(seg.start + offsetSeconds),
        end: formatTime(seg.end + offsetSeconds),
        text: seg.text,
      })
    }
    console.log(` ${segments.length} segment`)
    unlinkSync(chunkPath) // cleanup chunk immediately
  }

  // Step 4: Save
  const output = {
    källa: url,
    videoId,
    datum: datum || null,
    språk: 'sv',
    modell: MODEL.split('/').pop(),
    chunkSekunder: CHUNK_SECONDS,
    transkriberad: new Date().toISOString(),
    antalSegment: allSegments.length,
    segment: allSegments,
  }

  const outFile = datum ? `kf-${datum}.json` : `kf-${videoId}.json`
  const outPath = join(OUTPUT_DIR, outFile)
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\n✅ ${outPath} (${allSegments.length} segment)`)

  // Step 5: Cleanup
  unlinkSync(audioPath)
  rmSync(chunksDir, { recursive: true, force: true })
  console.log(`🗑️  Audio raderat`)
}

main().catch(console.error)
