"""Load MODEL and DATA the same way the static visualizer does (site/index.html + site/data.json)."""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA = ROOT / "site" / "data.json"
DEFAULT_INDEX = ROOT / "site" / "index.html"


def _extract_model_from_index(path: Path) -> dict:
    html = path.read_text(encoding="utf-8")
    m = re.search(r"const MODEL=(.+?);\s*\nconst DATA=", html, re.S)
    if not m:
        raise RuntimeError(f"Could not parse MODEL from {path}")
    return json.loads(m.group(1))


@lru_cache(maxsize=1)
def load_model() -> dict:
    explicit = os.getenv("STORM_MODEL_JSON")
    if explicit:
        return json.loads(Path(explicit).read_text(encoding="utf-8"))
    artifacts = ROOT / "artifacts" / "model.json"
    if artifacts.is_file():
        return json.loads(artifacts.read_text(encoding="utf-8"))
    index = Path(os.getenv("STORM_SITE_INDEX", DEFAULT_INDEX))
    return _extract_model_from_index(index)


@lru_cache(maxsize=1)
def load_data() -> dict:
    path = Path(os.getenv("STORM_DATA_JSON", DEFAULT_DATA))
    return json.loads(path.read_text(encoding="utf-8"))
