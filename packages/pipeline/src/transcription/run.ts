/**
 * Transcription pipeline — smart chunking per anförande
 *
 * Flow:
 * 1. Parse yttrandeprotokoll PDF → list of (talare, §, start, slut)
 * 2. yt-dlp → download full audio
 * 3. ffmpeg → cut audio per anförande (max 5 min sub-chunks)
 * 4. whisper-cli → transcribe each chunk
 * 5. Merge → JSON with talare + text + timestamps
 * 6. Cleanup → delete all audio
 *
 * Fallback: if no yttrandeprotokoll → naive 30s chunks
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_DIR = join(import.meta.dirname, '../../../../data/debatter')
const TMP_DIR = join(import.meta.dirname, '../../../../.tmp')
const MAX_CHUNK_SECONDS = 300 // 5 min max per chunk
const FALLBACK_CHUNK_SECONDS = 30
const MODEL = process.env.WHISPER_MODEL || join(TMP_DIR, 'ggml-small.bin')

interface Anförande {
  talare: string
  parti: string
  ärende: string
  start: number // seconds from video start
  slut: number
}

interface TranscribedAnförande extends Anförande {
  text: string
  segments: Array<{ start: string; end: string; text: string }>
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function timeToSeconds(ts: string): number {
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}

// Parse yttrandeprotokoll PDF → list of speakers with timestamps
function parseYttrandeprotokoll(pdfPath: string): Anförande[] {
  const text = execSync(`pdftotext "${pdfPath}" -`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
  const anföranden: Anförande[] = []

  // Pattern: "Namn (Parti)" + time range, grouped under § headers
  let currentÄrende = ''
  const lines = text.split('\n')

  for (const line of lines) {
    // Detect § header
    const ärendeMatch = line.match(/§\s*(\d+)/)
    if (ärendeMatch) currentÄrende = `§${ärendeMatch[1]}`

    // Detect speaker: "Namn Efternamn (X)   HH:MM - HH:MM" or "HH:MM:SS - HH:MM:SS"
    const speakerMatch = line.match(/^(.+?)\s*\((\w+)\)\s+(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)\s*[-–]\s*(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)/)
    if (speakerMatch) {
      const [, talare, parti, startStr, slutStr] = speakerMatch
      const start = timeToSeconds(startStr.replace(/\./g, ':'))
      const slut = timeToSeconds(slutStr.replace(/\./g, ':'))
      if (slut > start) {
        anföranden.push({ talare: talare.trim(), parti, ärende: currentÄrende, start, slut })
      }
    }
  }

  return anföranden
}

function downloadAudio(url: string, outPath: string): void {
  console.log(`⬇️  Laddar ner audio...`)
  execSync(
    `yt-dlp --cookies-from-browser chrome --extract-audio --audio-format wav --postprocessor-args "-ar 16000 -ac 1" -o "${outPath}" "${url}"`,
    { stdio: 'inherit', timeout: 1800_000 },
  )
}

function cutAudioSegment(inputPath: string, outPath: string, startSec: number, durationSec: number): void {
  execSync(`ffmpeg -y -ss ${startSec} -t ${durationSec} -i "${inputPath}" -c copy "${outPath}"`, { stdio: 'pipe' })
}

function transcribeChunk(chunkPath: string): Array<{ start: number; end: number; text: string }> {
  const outBase = chunkPath.replace('.wav', '')
  try {
    execSync(`whisper-cli -m "${MODEL}" -l sv -f "${chunkPath}" -oj --output-file "${outBase}"`, { stdio: 'pipe', timeout: 300_000 })
  } catch { return [] }

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
  const yttrandePdf = process.argv[4] // optional: path to yttrandeprotokoll PDF

  if (!url) {
    console.error('Usage: npx tsx src/transcription/run.ts <youtube-url> [datum] [yttrandeprotokoll.pdf]')
    process.exit(1)
  }

  if (!existsSync(MODEL)) {
    console.error(`Model saknas: ${MODEL}\nKör: curl -sL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin -o .tmp/ggml-small.bin`)
    process.exit(1)
  }

  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const videoId = url.match(/[?&]v=([^&]+)/)?.[1] || 'unknown'
  const audioPath = join(TMP_DIR, `kf-${videoId}.wav`)
  const chunksDir = join(TMP_DIR, `chunks-${videoId}`)
  mkdirSync(chunksDir, { recursive: true })

  // Step 1: Parse yttrandeprotokoll if available
  let anföranden: Anförande[] = []
  if (yttrandePdf && existsSync(yttrandePdf)) {
    console.log(`📋 Parsear yttrandeprotokoll...`)
    anföranden = parseYttrandeprotokoll(yttrandePdf)
    console.log(`   ${anföranden.length} anföranden hittade\n`)
  }

  // Step 2: Download audio
  if (!existsSync(audioPath)) {
    downloadAudio(url, audioPath)
  }

  // Step 3: Cut and transcribe
  const results: TranscribedAnförande[] = []

  if (anföranden.length > 0) {
    // Smart chunking: per anförande
    console.log(`🎤 Transkriberar per anförande (max ${MAX_CHUNK_SECONDS / 60} min/chunk)...\n`)

    for (let i = 0; i < anföranden.length; i++) {
      const a = anföranden[i]
      const duration = a.slut - a.start
      process.stdout.write(`   [${i + 1}/${anföranden.length}] ${a.talare} (${a.parti}) ${a.ärende}...`)

      // Split long speeches into sub-chunks
      const subChunks: Array<{ offset: number; path: string }> = []
      for (let offset = 0; offset < duration; offset += MAX_CHUNK_SECONDS) {
        const chunkDur = Math.min(MAX_CHUNK_SECONDS, duration - offset)
        const chunkPath = join(chunksDir, `anf_${i}_${offset}.wav`)
        cutAudioSegment(audioPath, chunkPath, a.start + offset, chunkDur)
        subChunks.push({ offset, path: chunkPath })
      }

      // Transcribe all sub-chunks and merge
      const allSegments: Array<{ start: string; end: string; text: string }> = []
      for (const { offset, path } of subChunks) {
        const segs = transcribeChunk(path)
        for (const seg of segs) {
          allSegments.push({
            start: formatTime(a.start + offset + seg.start),
            end: formatTime(a.start + offset + seg.end),
            text: seg.text,
          })
        }
        unlinkSync(path)
      }

      const fullText = allSegments.map(s => s.text).join(' ')
      results.push({ ...a, text: fullText, segments: allSegments })
      console.log(` ${allSegments.length} seg (${Math.round(duration)}s)`)
    }
  } else {
    // Fallback: naive 30s chunks
    console.log(`⚠️  Inget yttrandeprotokoll — använder ${FALLBACK_CHUNK_SECONDS}s-chunks\n`)
    execSync(`ffmpeg -y -i "${audioPath}" -f segment -segment_time ${FALLBACK_CHUNK_SECONDS} -c copy "${chunksDir}/chunk_%04d.wav"`, { stdio: 'pipe' })
    const chunkFiles = readdirSync(chunksDir).filter(f => f.endsWith('.wav')).sort()

    for (let i = 0; i < chunkFiles.length; i++) {
      const chunkPath = join(chunksDir, chunkFiles[i])
      const offsetSeconds = i * FALLBACK_CHUNK_SECONDS
      const segs = transcribeChunk(chunkPath)
      if (segs.length > 0) {
        results.push({
          talare: 'okänd', parti: '', ärende: '',
          start: offsetSeconds, slut: offsetSeconds + FALLBACK_CHUNK_SECONDS,
          text: segs.map(s => s.text).join(' '),
          segments: segs.map(s => ({ start: formatTime(s.start + offsetSeconds), end: formatTime(s.end + offsetSeconds), text: s.text })),
        })
      }
      unlinkSync(chunkPath)
    }
  }

  // Step 4: Save
  const output = {
    källa: url,
    videoId,
    datum: datum || null,
    språk: 'sv',
    modell: MODEL.split('/').pop(),
    metod: anföranden.length > 0 ? 'yttrandeprotokoll' : 'fallback-30s',
    transkriberad: new Date().toISOString(),
    antalAnföranden: results.length,
    anföranden: results,
  }

  const outFile = datum ? `kf-${datum}.json` : `kf-${videoId}.json`
  const outPath = join(OUTPUT_DIR, outFile)
  writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\n✅ ${outPath} (${results.length} anföranden)`)

  // Step 5: Cleanup
  unlinkSync(audioPath)
  rmSync(chunksDir, { recursive: true, force: true })
  console.log(`🗑️  Audio raderat`)
}

main().catch(console.error)
