#!/bin/bash
# Batch transcription — all KF meetings for current mandatperiod
# Run overnight: ./scripts/transcribe-all.sh
# Safe to interrupt (Ctrl+C) — will resume from where it stopped

set -e
cd "$(dirname "$0")/.."

PIPELINE="packages/pipeline/src/transcription/run.ts"
OUTPUT_DIR="data/debatter"

# All KF meetings 2023-2026 (mandatperiod)
declare -a MEETINGS=(
  "i7pNQSYlmqk 2023-01-26"
  "F6S1CI8mgoI 2023-02-23"
  "J8ZRgxS6XGE 2023-03-23"
  "_dDX_ZF0p0s 2023-04-27"
  "ggXkLLzWcd4 2023-05-25"
  "8u1T9BBGaO0 2023-06-08"
  "Rf-LdqsSYQE 2023-06-19"
  "AMs2Po80QQI 2023-09-07"
  "Jal7Xa9kz0A 2023-10-12"
  "fVBsd9eKwrA 2023-11-09"
  "_V8es2EjHUo 2023-11-23"
  "aEU8mm50Q0g 2023-12-07"
  "g05LdHdGD48 2024-02-01"
  "msM4en3I4eg 2024-02-29"
  "gUuHaBItBiI 2024-03-21"
  "JtpGjM-UBNk 2024-04-25"
  "ZtTnkHoIqaE 2024-05-23"
  "D11ZPJrtFw0 2024-06-19"
  "0mppwzwWtow 2024-08-22"
  "QE613eLFXHY 2024-09-12"
  "ZKT9thJhiH8 2024-10-10"
  "lGQ1d9silMM 2024-11-07"
  "7H5ZI9nlrWU 2024-11-21"
  "gtcH6GJNnwc 2024-12-12"
  "mBeqybEl6ow 2025-01-30"
  "cGckZAkRe6E 2025-02-27"
  "2iQdIaIplXs 2025-03-27"
  "-0vPQ_vbM1I 2025-04-24"
  "mcgVSxLSZJ0 2025-05-22"
  "6untRD3CGjg 2025-06-12"
  "xk_L3Z-3tnQ 2025-06-18"
  "RXL62WPYYIE 2025-09-11"
  "8AHQQ6jBBxg 2025-10-16"
  "n2sv8WXaYBw 2025-11-06"
  "FPMdxYDJ03Q 2025-11-27"
  "KVYgRgNDZTc 2025-12-11"
  "BKoNfSHdE7Y 2026-01-29"
  "-GEcxUIqj80 2026-02-26"
  "p7qyGQTuW5Q 2026-03-26"
  "Da-5e0JNBPo 2026-04-23"
  "tb5mTTC7wko 2026-05-28"
  "j2dYIDsuD4U 2026-06-11"
)

echo "🎤 Batch transcription — ${#MEETINGS[@]} meetings"
echo "   Estimated: ~7h each × ${#MEETINGS[@]} = ~${#MEETINGS[@]}× realtime on M4"
echo ""

DONE=0
SKIPPED=0

for entry in "${MEETINGS[@]}"; do
  ID=$(echo "$entry" | cut -d' ' -f1)
  DATUM=$(echo "$entry" | cut -d' ' -f2)
  OUTFILE="$OUTPUT_DIR/kf-${DATUM}.json"

  if [ -f "$OUTFILE" ]; then
    echo "⏭️  $DATUM — redan transkriberad"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📅 $DATUM (video: $ID)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  npx tsx "$PIPELINE" "https://www.youtube.com/watch?v=$ID" "$DATUM" || echo "⚠️  Fel vid $DATUM, fortsätter..."

  DONE=$((DONE + 1))
  echo ""
  echo "   ✓ Klart: $DONE | Kvar: $((${#MEETINGS[@]} - DONE - SKIPPED))"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Batch complete: $DONE transcribed, $SKIPPED skipped"
