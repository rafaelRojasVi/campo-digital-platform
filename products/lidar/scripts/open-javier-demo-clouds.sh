#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ORIGINAL="$ROOT/data/raw/v01_MG_23jun2026/v01_MG_23jun2026.las"
CANDIDATE="$ROOT/data/interim/v01_MG_23jun2026/timber_roi/timber_stack_candidate_v1.las"
ISOLATED="$ROOT/data/interim/v01_MG_23jun2026/timber_roi/timber_stack_manual_reference_v1.las"

CLOUDCOMPARE="/mnt/c/Program Files/CloudCompare/CloudCompare.exe"

for path in "$ORIGINAL" "$CANDIDATE" "$ISOLATED"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing demo file: $path" >&2
    exit 1
  fi
done

if [[ ! -x "$CLOUDCOMPARE" ]]; then
  echo "CloudCompare not found: $CLOUDCOMPARE" >&2
  exit 1
fi

echo
echo "========================================"
echo " CAMPO DIGITAL · CLOUDCOMPARE DEMO"
echo "========================================"
echo
echo "1. ORIGINAL"
echo "   v01_MG_23jun2026.las"
echo "   ~9.72 million points"
echo
echo "2. CANDIDATE / REDUCED REGION"
echo "   timber_stack_candidate_v1.las"
echo "   ~4.07 million points"
echo
echo "3. CONTROLLED ISOLATED PILE"
echo "   timber_stack_manual_reference_v1.las"
echo "   ~1.58 million points"
echo
echo "If CloudCompare asks for Global Shift use:"
echo "  X = -499995.00"
echo "  Y =  4166584.00"
echo "  Z =  0.00"
echo

"$CLOUDCOMPARE" \
  "$(wslpath -w "$ORIGINAL")" \
  "$(wslpath -w "$CANDIDATE")" \
  "$(wslpath -w "$ISOLATED")"
