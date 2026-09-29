"""Speech-to-text for voice pantry input, via ElevenLabs Scribe. One function, no state.

The browser records a short clip (webm/opus usually); we forward the bytes and get text back.
Needs ELEVENLABS_API_KEY in .env. Failures raise; the API layer turns them into a plain 502.
"""
import os

import requests
from dotenv import load_dotenv

load_dotenv()

_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
_MODEL = os.getenv("ELEVENLABS_STT_MODEL", "scribe_v1")


def transcribe(audio: bytes, mime_type: str = "audio/webm") -> str:
    """Audio bytes -> spoken text (stripped). Raises RuntimeError when unconfigured or the service fails."""
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        raise RuntimeError("Voice input is not configured: set ELEVENLABS_API_KEY in .env")
    ext = "webm"
    if "/" in mime_type:
        ext = mime_type.split("/", 1)[1].split(";", 1)[0] or "webm"
    resp = requests.post(
        _STT_URL,
        headers={"xi-api-key": key},
        files={"file": (f"pantry.{ext}", audio, mime_type)},
        data={"model_id": _MODEL},
        timeout=30,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"speech-to-text failed ({resp.status_code}): {resp.text[:160]}")
    return (resp.json().get("text") or "").strip()
