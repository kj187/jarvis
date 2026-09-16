"""Synthesizes one WAV per narration segment and records each clip's duration.

Usage (inside the container): python /tts.py /work/narration.json /work/out/narration

narration.json: {"voice": "af_heart", "speed": 1.0, "segments": [{"id": "...", "text": "..."}]}
Writes <out>/<id>.wav and <out>/durations.json ({id: seconds}); the recorder
(frontend/e2e/video/recorder.ts) waits per scene until its clip has finished.
"""

import json
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro


def main() -> None:
    spec_path, out_dir = sys.argv[1], sys.argv[2]
    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)
    os.makedirs(out_dir, exist_ok=True)

    kokoro = Kokoro("/models/kokoro.onnx", "/models/voices.bin")
    voice = spec.get("voice", "af_heart")
    speed = float(spec.get("speed", 1.0))

    durations = {}
    for seg in spec["segments"]:
        samples, rate = kokoro.create(seg["text"], voice=voice, speed=speed, lang=spec.get("lang", "en-us"))
        sf.write(os.path.join(out_dir, f"{seg['id']}.wav"), samples, rate)
        durations[seg["id"]] = round(len(samples) / rate, 3)
        print(f"  {seg['id']}: {durations[seg['id']]}s", flush=True)

    with open(os.path.join(out_dir, "durations.json"), "w", encoding="utf-8") as f:
        json.dump(durations, f, indent=2)


if __name__ == "__main__":
    main()
