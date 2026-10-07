"""Offline, resident conversation model. stdout is a JSON-lines protocol."""
import json, sys, time, contextlib
with contextlib.redirect_stdout(sys.stderr):
    from mlx_lm import load, stream_generate
    from mlx_lm.sample_utils import make_sampler
    from mlx_lm.models.cache import make_prompt_cache, trim_prompt_cache, can_trim_prompt_cache
    model, tokenizer = load(sys.argv[1])

cache = make_prompt_cache(model)
cached_tokens = []
print(json.dumps({"type": "ready"}), flush=True)
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        prompt = tokenizer.apply_chat_template(request["messages"], tokenize=False, add_generation_prompt=True, enable_thinking=False)
        prefix = '{"action":'
        prompt += prefix
        tokens = tokenizer.encode(prompt)
        common = 0
        for a, b in zip(cached_tokens, tokens[:-1]):
            if a != b:
                break
            common += 1
        if can_trim_prompt_cache(cache):
            trim_prompt_cache(cache, len(cached_tokens) - common)
        else:
            cache = make_prompt_cache(model)
            common = 0
        generated_tokens = []
        started = time.monotonic()
        chunks = [prefix]
        first = None
        for response in stream_generate(model, tokenizer, tokens[common:], prompt_cache=cache, max_tokens=650, sampler=make_sampler(temp=0.0)):
            if first is None:
                first = time.monotonic() - started
            chunks.append(response.text)
            generated_tokens.append(response.token)
        cached_tokens = (tokens + generated_tokens)[:cache[0].offset]
        print(json.dumps({"id": request["id"], "text": "".join(chunks), "seconds": time.monotonic()-started, "firstTokenSeconds": first}, ensure_ascii=False), flush=True)
    except Exception:
        cache = make_prompt_cache(model)
        cached_tokens = []
        print(json.dumps({"id": request.get("id"), "error": "conversation_generation_failed"}), flush=True)
