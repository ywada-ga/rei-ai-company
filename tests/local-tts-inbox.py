"""Standard-library protocol test; no model, MLX or audio dependency."""
import importlib.util
import json
import queue
import threading
from pathlib import Path
spec = importlib.util.spec_from_file_location('worker', Path(__file__).resolve().parents[1] / 'local-tts-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
class Source:
    def __init__(self):
        self.lines = queue.Queue()
    def __iter__(self):
        while True:
            line = self.lines.get()
            if line is None:
                return
            yield line
    def send(self, value):
        self.lines.put(json.dumps(value))
source = Source()
inbox = worker.RequestInbox(source)
inbox.start()
source.send({'id': 'first', 'text': 'notice'})
first, first_event = inbox.queue.get(timeout=2)
assert first['id'] == 'first' and not first_event.is_set()
source.send({'type': 'cancel', 'id': 'unrelated'})
source.send({'id': 'second', 'text': 'answer'})
second, second_event = inbox.queue.get(timeout=2)
assert not first_event.is_set() and not second_event.is_set()
source.send({'type': 'cancel', 'id': 'first'})
assert first_event.wait(2), 'cancel must be read while main generation is busy'
assert not second_event.is_set(), 'never cancel the other request'
inbox.complete('first')
source.send({'type': 'cancel', 'id': 'first'})
source.lines.put(None)
assert inbox.queue.get(timeout=2) is None
assert not second_event.is_set()
inbox.complete('second')
assert not inbox.events
print('PASS concurrent stdin cancellation, request separation and EOF cleanup')
# Exercise the production worker loop with fake MLX/audio modules. This tests
# control flow and cleanup, not real synthesis speed or speech quality.
import io
import sys
import tempfile
import types
source = Source()
source.send({'id': 'notice', 'text': 'notice', 'stream': True})
source.send({'id': 'answer', 'text': 'answer', 'stream': True})
source.lines.put(None)
instances = []
class ObservedInbox(worker.RequestInbox):
    def __init__(self, src):
        super().__init__(src)
        instances.append(self)
# Feed cancellation directly through the reader before yielding another chunk.
# The first test above verifies stdin delivery independently.
class Samples(list):
    def reshape(self, _):
        return self
class Finite:
    def all(self):
        return True
np = types.ModuleType('numpy')
np.asarray = lambda audio: Samples(audio)
np.isfinite = lambda audio: Finite()
np.clip = lambda audio, low, high: audio
sf = types.ModuleType('soundfile')
sf.write = lambda target, *args, **kwargs: target.write(b'RIFF-fixture')
mx = types.ModuleType('mlx.core')
mx.random = types.SimpleNamespace(seed=lambda _: None)
clears = []
mx.clear_cache = lambda: clears.append(True)
resets = []
decoder = types.SimpleNamespace(reset_streaming_state=lambda: resets.append(True))
closed = []
class Model:
    speech_tokenizer = types.SimpleNamespace(decoder=decoder)
    def generate(self, text, **kwargs):
        if text == 'answer':
            assert len(resets) == 1 and len(clears) == 1
        try:
            for _ in range(3):
                yield types.SimpleNamespace(audio=[0.1]*12000, sample_rate=24000)
                if text == 'notice':
                    instances[0].events['notice'].set()
        finally:
            closed.append(text)
loaded = []
utils = types.ModuleType('mlx_audio.tts.utils')
def load_model(_):
    loaded.append(True)
    return Model()
utils.load_model = load_model
sys.modules.update({'numpy': np, 'soundfile': sf, 'mlx': types.ModuleType('mlx'),
                    'mlx.core': mx, 'mlx_audio': types.ModuleType('mlx_audio'),
                    'mlx_audio.tts': types.ModuleType('mlx_audio.tts'), 'mlx_audio.tts.utils': utils})
worker.RequestInbox = ObservedInbox
worker.protocol = io.StringIO()
original_stdin, original_argv = sys.stdin, sys.argv
try:
    with tempfile.TemporaryDirectory() as folder:
        (Path(folder) / 'model.safetensors').write_text('fixture')
        sys.stdin = source
        sys.argv = ['worker', folder]
        worker.main()
finally:
    sys.stdin, sys.argv = original_stdin, original_argv
messages = [json.loads(line) for line in worker.protocol.getvalue().splitlines()]
assert messages[0]['cancelSupported'] is True
notice_messages = [m for m in messages if m.get('id') == 'notice']
assert [m['type'] for m in notice_messages] == ['chunk', 'cancelled']
answer_messages = [m for m in messages if m.get('id') == 'answer']
assert [m['type'] for m in answer_messages] == ['chunk', 'chunk', 'chunk', 'done']
assert len(loaded) == 1 and closed == ['notice', 'answer']
assert not instances[0].events
print('PASS worker chunk-boundary cancellation, generator close, decoder cleanup and next-request reuse (fake MLX)')
