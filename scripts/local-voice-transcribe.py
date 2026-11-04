"""Private local audio decoder and MLX Whisper bridge; emits only a draft transcript."""
import json
import os
import subprocess
import sys
import numpy as np

try:
    # Decode at most 32 seconds, then reject anything beyond 31 seconds including recorder overhead.
    pcm = subprocess.run([os.environ['LOCAL_VOICE_FFMPEG'], '-v', 'error', '-nostdin', '-i', sys.argv[1], '-t', '32', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], capture_output=True, check=True, timeout=30).stdout
    audio = np.frombuffer(pcm, dtype='<f4')
    if len(audio) < 1600 or len(audio) > 31 * 16000 or not np.isfinite(audio).all() or np.sqrt(np.mean(audio * audio)) < 0.002:
        raise ValueError('Invalid duration or silent recording')
    import mlx_whisper
    result = mlx_whisper.transcribe(audio, path_or_hf_repo=os.environ['LOCAL_VOICE_MODEL'], verbose=False)
    print(json.dumps({'transcript': result['text'].strip()}))
except ValueError as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(2)
except Exception as exc:
    print(str(exc), file=sys.stderr)
    sys.exit(1)
