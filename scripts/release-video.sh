#!/usr/bin/env bash
# Records and renders the release demo video (.agents/skills/release-video/SKILL.md).
#
# Usage:
#   scripts/release-video.sh <version> [all|tts|record|render]
#
# Inputs (gitignored, written per release):
#   frontend/e2e/_video/<project>.video.ts        Playwright storyboard (templates: frontend/e2e/video/*.storyboard.ts)
#   frontend/e2e/_video/<project>.narration.json  voice-over script   (templates: frontend/e2e/video/*.narration.json)
#
# Steps (all = tts → record → render; each step reuses the previous step's output):
#   tts     local text-to-speech (Kokoro, container) → _video/<project>/narration/*.wav + durations.json
#   record  e2e stack up, storyboard once per format → _video/<project>/<format>/ frames + timeline
#   render  ffmpeg (container) → $VIDEO_OUT/jarvis-<version>-{youtube,linkedin}.{mp4,-cover.jpg}; QA sheets stay in _video/<project>/<format>/
#
# Env: VIDEO_PROJECT video project folder (default: release; e.g. intro for the product video)
#      VIDEO_OUT     output directory (default: ~/Downloads/jarvis-<project>-video) — never inside the repo
#      VIDEO_FORMATS formats to record/render (default: "landscape square")

set -euo pipefail

VERSION="${1:?usage: release-video.sh <version> [all|tts|record|render]}"
VERSION="${VERSION#v}"
STEP="${2:-all}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VIDEO_PROJECT="${VIDEO_PROJECT:-release}"
case "$VIDEO_PROJECT" in *[!a-z0-9-]*|"") echo "ERROR: VIDEO_PROJECT must be [a-z0-9-]+" >&2; exit 1 ;; esac
export VIDEO_PROJECT
VIDEO_DIR="frontend/e2e/_video"
STORYBOARD="$VIDEO_DIR/$VIDEO_PROJECT.video.ts"
NARRATION="$VIDEO_DIR/$VIDEO_PROJECT.narration.json"
WORK="$VIDEO_DIR/$VIDEO_PROJECT"
VIDEO_OUT="${VIDEO_OUT:-$HOME/Downloads/jarvis-$VIDEO_PROJECT-video}"
VIDEO_FORMATS="${VIDEO_FORMATS:-landscape square}"
TTS_IMAGE="localhost/jarvis-release-video-tts:latest"
FFMPEG_IMAGE="docker.io/mwader/static-ffmpeg:7.1@sha256:84e4edba9212b950f26fb591365ea4f89baf3d8202310b43bcf0128db9fb0992"
NODE_IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

case "$VIDEO_OUT" in
  "$ROOT"|"$ROOT"/*) echo "ERROR: VIDEO_OUT must be outside the repository" >&2; exit 1 ;;
esac

ffmpeg() { podman run --rm -v "$ROOT/$WORK:/w:z" -w /w "$FFMPEG_IMAGE" -hide_banner -loglevel error -y "$@"; }
ffprobe() { podman run --rm -v "$ROOT/$WORK:/w:z" -w /w --entrypoint /ffprobe "$FFMPEG_IMAGE" -v error "$@"; }

step_tts() {
  [ -f "$NARRATION" ] || { echo "ERROR: $NARRATION missing (templates: frontend/e2e/video/*.narration.json)" >&2; exit 1; }
  echo "==> [tts] building voice container"
  podman build -q -t "$TTS_IMAGE" scripts/release-video/tts > /dev/null
  # Empty instead of rm -rf + mkdir: a directory recreated on the host right
  # before the run is stale inside the podman machine (virtiofs) and writes fail.
  mkdir -p "$WORK/narration" && find "$WORK/narration" -type f -delete
  echo "==> [tts] synthesizing narration"
  podman run --rm \
    -v "$ROOT/$NARRATION:/work/narration.json:ro,z" \
    -v "$ROOT/$WORK/narration:/work/out:z" \
    "$TTS_IMAGE" /work/narration.json /work/out
}

step_record() {
  [ -f "$STORYBOARD" ] || { echo "ERROR: $STORYBOARD missing (templates: frontend/e2e/video/*.storyboard.ts)" >&2; exit 1; }
  [ -f "$WORK/narration/durations.json" ] || echo "    note: no narration — recording a silent video (run the tts step first for a voice-over)"
  VIDEO_VERSION="$VERSION" VIDEO_FORMATS="$VIDEO_FORMATS" bash scripts/e2e-run.sh video none
}

step_render() {
  mkdir -p "$VIDEO_OUT"
  for format in $VIDEO_FORMATS; do
    [ -f "$WORK/$format/timeline.json" ] || { echo "ERROR: $WORK/$format/timeline.json missing — run the record step" >&2; exit 1; }
    case "$format" in
      landscape) name="jarvis-$VERSION-youtube" ;;
      square)    name="jarvis-$VERSION-linkedin" ;;
      *) echo "ERROR: unknown format '$format'" >&2; exit 1 ;;
    esac
    echo "==> [render] $format"
    out_w=$(grep -oE '"outWidth": [0-9]+' "$WORK/$format/timeline.json" | grep -oE '[0-9]+$')
    out_h=$(grep -oE '"outHeight": [0-9]+' "$WORK/$format/timeline.json" | grep -oE '[0-9]+$')
    podman run --rm -v "$ROOT/frontend:/work/frontend:z" -w /work/frontend "$NODE_IMAGE" \
      node e2e/video/build-video.mjs "e2e/_video/$VIDEO_PROJECT" "$format"

    # Pass 1: frames → zoomed base video (lossless intermediate, so pass 2 encodes only once).
    inputs=()
    while IFS= read -r arg; do inputs+=("$arg"); done < "$WORK/$format/base-inputs.txt"
    ffmpeg "${inputs[@]}" -filter_complex_threads 2 -filter_complex_script "$format/base-filter.txt" -map '[vout]' \
      -c:v libx264 -preset ultrafast -qp 0 -threads 2 "$format/base.mkv"
    # Pass 2: base + captions, title/chapter cards and narration → final video.
    inputs=()
    while IFS= read -r arg; do inputs+=("$arg"); done < "$WORK/$format/inputs.txt"
    maps=(-map '[vout]')
    if grep -q '\[aout\]' "$WORK/$format/filter.txt"; then maps+=(-map '[aout]' -c:a aac -b:a 192k); fi
    # Encoder settings against flicker on dark, static UI: x264's default rate
    # control makes flat gradients and 1 px grid lines "breathe" frame to frame;
    # stillimage tuning + aq-mode 3 keep them stable. Output is TV-range BT.709
    # (the JPEG frames are full range — players render untagged full range
    # inconsistently).
    ffmpeg "${inputs[@]}" -filter_complex_threads 1 -filter_complex_script "$format/filter.txt" "${maps[@]}" \
      -c:v libx264 -preset slow -crf 16 -tune stillimage -x264-params aq-mode=3:rc-lookahead=20 -threads 2 \
      -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart "$format/$name.mp4"
    rm -f "$WORK/$format/base.mkv"
    # Cover = the opening card as a still with the app screenshot, at output size; JPEG stays under YouTube's 2 MB thumbnail limit.
    ffmpeg -i "$format/cover.png" -vf "scale=${out_w}:${out_h}:flags=lanczos" -q:v 2 "$format/$name-cover.jpg"
    # Contact sheet: QA only (one frame per 2.5 s) — stays in the work dir, never handed out.
    ffmpeg -i "$format/$name.mp4" -vf "fps=1/2.5,scale=480:-1,tile=5x5:padding=6:color=white" -frames:v 1 "$format/sheet.png"

    cp "$WORK/$format/$name.mp4" "$WORK/$format/$name-cover.jpg" "$VIDEO_OUT/"
    # YouTube chapter timestamps for the description (the 16:9 video is the YouTube upload).
    if [ "$format" = landscape ] && [ -f "$WORK/$format/chapters.txt" ]; then
      cp "$WORK/$format/chapters.txt" "$VIDEO_OUT/$name-chapters.txt"
    fi
    echo "    $(ffprobe -show_entries format=duration:stream=codec_type,width,height -of compact=p=0:nk=1 "$format/$name.mp4" | tr '\n' ' ')"
    echo "    QA contact sheet: $WORK/$format/sheet.png"
  done
  echo "==> videos written to $VIDEO_OUT"
}

case "$STEP" in
  all)    step_tts; step_record; step_render ;;
  tts)    step_tts ;;
  record) step_record ;;
  render) step_render ;;
  *) echo "ERROR: unknown step '$STEP' (use all|tts|record|render)" >&2; exit 1 ;;
esac
