"""Generate one photo per meal into web/public/meals/<id>.jpg (skips existing files).

Usage: python -m stretch.images [--limit N] [--workers 3] [--force] [--only id ...]
"""
import argparse
import io
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from . import llm
from .schemas import Meal

OUT_DIR = os.path.join("web", "public", "meals")


def _prompt(m: Meal) -> str:
    return (
        f"Realistic overhead food photograph of {m.name}. {m.description} "
        "Homemade, served in a simple bowl or on a plain plate on a light wooden table, soft natural "
        "daylight, appetizing and unfussy. No text, no hands, no people, no packaging, no logos."
    )


def _save(data: bytes, path: str, max_side: int = 768) -> None:
    from PIL import Image

    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((max_side, max_side))
    img.save(path, format="JPEG", quality=82, optimize=True)


def generate_one(m: Meal, force: bool = False) -> tuple[str, str]:
    """Generate and save one meal photo; returns (meal id, "ok" | "exists" | "failed")."""
    path = os.path.join(OUT_DIR, f"{m.id}.jpg")
    if os.path.exists(path) and not force:
        return m.id, "exists"
    for attempt in range(3):
        try:
            data = llm.generate_image(_prompt(m))
            _save(data, path)
            return m.id, "ok"
        except Exception as exc:
            wait = 5 * (attempt + 1)
            print(f"images[{m.id}]: attempt {attempt + 1} failed: {str(exc)[:140]}; retrying in {wait}s", flush=True)
            time.sleep(wait)
    return m.id, "failed"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    with open("data/meals.json", encoding="utf-8") as fh:
        meals = [Meal.model_validate(m) for m in json.load(fh)]
    if args.only:
        wanted = set(args.only)
        meals = [m for m in meals if m.id in wanted]
    if args.limit:
        meals = meals[: args.limit]
    print(f"images: {len(meals)} meals, {args.workers} workers, output {OUT_DIR}", flush=True)

    started = time.time()
    results: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(generate_one, m, args.force) for m in meals]
        for fut in as_completed(futures):
            mid, status = fut.result()
            results[status] = results.get(status, 0) + 1
            print(f"images: {mid} {status}", flush=True)
    print(f"images: done in {int(time.time() - started)}s -> {results}", flush=True)


if __name__ == "__main__":
    main()
