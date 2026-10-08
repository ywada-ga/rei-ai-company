"""Persistent local Japanese speech worker. JSON lines in/out; no network calls."""
import base64
import contextlib
import io
import json
import os
import sys
import time
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
protocol = sys.stdout


def emit(value):
    protocol.write(json.dumps(value, ensure_ascii=False) + '\n')
    protocol.flush()


def main():
    # Third-party initialization messages must never corrupt the protocol.
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import soundfile as sf
        import mlx.core as mx
        from mlx_audio.tts.utils import load_model
        model_path = Path(sys.argv[1]).resolve(strict=True)
        if not (model_path / 'model.safetensors').is_file():
            raise ValueError('Local model weights are missing')
        started = time.monotonic()
        model = load_model(str(model_path))
    emit({'type': 'ready', 'loadSeconds': round(time.monotonic() - started, 3)})
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get('id')
            text = request.get('text')
            if not isinstance(text, str) or not text.strip() or len(text) > 500:
                raise ValueError('Speech text must contain 1–500 characters')
            started = time.monotonic()
            first = None
            chunks = []
            streaming = request.get('stream') is True
            chunk_count = 0
            sample_count = 0
            with contextlib.redirect_stdout(sys.stderr):
                mx.random.seed(42)
                for result in model.generate(
                    text.strip(), voice='Ono_Anna', lang_code='Japanese',
                    instruct='Speak fluent standard Japanese in a mature, confident professional female voice. Sound like an attentive, capable colleague in a real conversation. Use clear articulation, a brisk natural pace, smooth connected phrasing and short conversational pauses. Match the meaning of the text: warm and responsive in casual conversation, composed and precise for work or serious topics. When the text contains ふふ, express it as a brief, subtle natural chuckle and smoothly continue the sentence. Give short acknowledgements natural conversational intonation. Use your natural vocal register; avoid a cute, breathy or exaggerated performance.',
                    stream=True, streaming_interval=0.5, max_tokens=500, verbose=False,
                ):
                    samples = np.asarray(result.audio).reshape(-1)
                    if not np.isfinite(samples).all():
                        raise ValueError('Invalid generated audio')
                    if not len(samples):
                        continue
                    if first is None:
                        first = time.monotonic() - started
                    rate = int(result.sample_rate)
                    sample_count += len(samples)
                    if streaming:
                        part = io.BytesIO()
                        sf.write(part, np.clip(samples, -0.95, 0.95), rate, format='WAV', subtype='PCM_16')
                        emit({'type': 'chunk', 'id': request_id, 'index': chunk_count, 'wav': base64.b64encode(part.getvalue()).decode('ascii'), 'sampleRate': rate, 'audioSeconds': len(samples) / rate, 'firstGeneratedSeconds': round(first, 3)})
                        chunk_count += 1
                    else:
                        chunks.append(samples)
                if streaming:
                    if not chunk_count:
                        raise ValueError('Empty generated audio')
                    emit({'type': 'done', 'id': request_id, 'chunkCount': chunk_count, 'audioSeconds': sample_count / rate, 'firstGeneratedSeconds': round(first, 3), 'totalSeconds': round(time.monotonic() - started, 3)})
                    continue
                audio = np.concatenate(chunks)
                if not len(audio):
                    raise ValueError('Empty generated audio')
                audio *= min(1, 0.95 / (float(np.max(np.abs(audio))) + 1e-9))
                wav = io.BytesIO()
                sf.write(wav, audio, rate, format='WAV', subtype='PCM_16')
            emit({'type': 'audio', 'id': request_id, 'wav': base64.b64encode(wav.getvalue()).decode('ascii'),
                  'audioSeconds': round(len(audio) / rate, 3),
                  'firstGeneratedSeconds': round(first, 3), 'totalSeconds': round(time.monotonic() - started, 3)})
        except Exception:
            # Do not echo company text or provider internals into logs/responses.
            emit({'type': 'error', 'id': request_id, 'message': 'Local speech generation failed'})


if __name__ == '__main__':
    main()
