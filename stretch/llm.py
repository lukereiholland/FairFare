import base64
import io
import os
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

LLM_BASE_URL = os.getenv("LLM_BASE_URL") or None
LLM_API_KEY = os.getenv("LLM_API_KEY") or None
LLM_MODEL = os.getenv("LLM_MODEL") or ""
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.7"))

# Optional second provider: when GEMINI_API_KEY is set, Gemini (via its OpenAI-compatible endpoint)
# handles every live user-facing call in complete(). OpenAI stays for web_lookup (its search model)
# and generate_image (gpt-image); both are offline/build-time paths.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or None
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL") or "https://generativelanguage.googleapis.com/v1beta/openai/"
GEMINI_MODEL = os.getenv("GEMINI_MODEL") or "gemini-3.8-flash"

try:
    _openai_client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY) if LLM_API_KEY else None
except Exception:
    _openai_client = None
try:
    _gemini_client = OpenAI(base_url=GEMINI_BASE_URL, api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
except Exception:
    _gemini_client = None

_client = _gemini_client or _openai_client  # complete() uses this


def provider() -> str:
    """Which provider complete() is using right now."""
    return "gemini" if _client is _gemini_client and _gemini_client is not None else "openai"


def _strip_fences(text: str | None) -> str | None:
    if not text:
        return text
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else ""
        if t.rstrip().endswith("```"):
            t = t.rstrip()[: -len("```")]
    return t.strip()


def _downscale(image: bytes, max_side: int = 1024) -> bytes:
    try:
        from PIL import Image  # optional; frontend already downscales before upload
    except ImportError:
        return image
    try:
        img = Image.open(io.BytesIO(image))
        if max(img.size) <= max_side:
            return image
        img.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=85)
        return buf.getvalue()
    except Exception:
        return image


def complete(messages: list[dict],
             tools: list[dict] | None = None,
             json_only: bool = False,
             temperature: float | None = None,
             images: list[bytes] | None = None) -> dict:
    """One call to the configured OpenAI-compatible provider; returns text and parsed tool calls."""
    if _client is None:
        raise RuntimeError("LLM is not configured: set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in .env")

    msgs = [dict(m) for m in messages]
    if images:
        last_user = next((m for m in reversed(msgs) if m.get("role") == "user"), None)
        if last_user is None:
            raise ValueError("images given but no user message to attach them to")
        parts: list[dict] = []
        content = last_user.get("content")
        if isinstance(content, str):
            parts.append({"type": "text", "text": content})
        elif isinstance(content, list):
            parts.extend(content)
        for img in images:
            b64 = base64.b64encode(_downscale(img)).decode("ascii")
            parts.append({"type": "image_url",
                          "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
        last_user["content"] = parts

    kwargs: dict = {
        "model": GEMINI_MODEL if provider() == "gemini" else LLM_MODEL,
        "messages": msgs,
        "temperature": LLM_TEMPERATURE if temperature is None else temperature,
    }
    if tools:
        kwargs["tools"] = tools
    if json_only:
        kwargs["response_format"] = {"type": "json_object"}

    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            resp = _client.chat.completions.create(**kwargs)
            break
        except Exception as exc:  # network or 5xx; retry exactly once
            last_exc = exc
            if attempt == 1:
                raise
            time.sleep(1.0)
    else:  # pragma: no cover
        raise last_exc  # type: ignore[misc]

    choice = resp.choices[0].message
    calls = []
    for tc in (getattr(choice, "tool_calls", None) or []):
        import json as _json
        try:
            args = _json.loads(tc.function.arguments or "{}")
        except _json.JSONDecodeError:
            args = {}
        calls.append({"id": tc.id, "name": tc.function.name, "arguments": args})

    return {"text": _strip_fences(choice.content), "tool_calls": calls, "raw": resp}


def web_lookup(prompt: str) -> str:
    """One web-search-enabled chat call (model from LLM_SEARCH_MODEL, default gpt-5-search-api); returns the
    text answer with fences stripped. Uses the chat endpoint so an ordinary chat-scoped key is enough."""
    if _openai_client is None:
        raise RuntimeError("Web lookups need the OpenAI key: set LLM_API_KEY in .env")
    model = os.getenv("LLM_SEARCH_MODEL") or "gpt-5-search-api"
    resp = None
    for attempt in range(4):
        try:
            resp = _openai_client.chat.completions.create(model=model, web_search_options={},
                                                   messages=[{"role": "user", "content": prompt}])
            break
        except Exception:  # network or 5xx (the search model throws the odd 500); back off and retry
            if attempt == 3:
                raise
            time.sleep(2.0 * (attempt + 1))
    return _strip_fences(resp.choices[0].message.content or "") or ""


def generate_image(prompt: str, size: str = "1024x1024", quality: str = "medium") -> bytes:
    """One image from the configured provider (gpt-image family, model from LLM_IMAGE_MODEL); returns JPEG bytes."""
    image_key = os.getenv("LLM_IMAGE_API_KEY") or LLM_API_KEY
    if not image_key:
        raise RuntimeError("Images are not configured: set LLM_IMAGE_API_KEY (a key with the Images permission) in .env")
    client = _openai_client if (image_key == LLM_API_KEY and _openai_client is not None) else OpenAI(base_url=LLM_BASE_URL, api_key=image_key)
    model = os.getenv("LLM_IMAGE_MODEL") or "gpt-image-1-mini"
    resp = None
    for attempt in range(2):
        try:
            resp = client.images.generate(model=model, prompt=prompt, size=size, quality=quality,
                                          output_format="jpeg", n=1)
            break
        except Exception:  # network or 5xx; retry exactly once
            if attempt == 1:
                raise
            time.sleep(1.0)
    return base64.b64decode(resp.data[0].b64_json)
