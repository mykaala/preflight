"""
Centralised config — loads API keys from .env.local at the project root.
All fetchers import from here; nothing reads os.environ directly.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")


def _require(key: str) -> str:
    value = os.getenv(key, "").strip()
    if not value:
        raise EnvironmentError(f"Missing required env var: {key} — set it in .env.local")
    return value


def _optional(key: str) -> str | None:
    value = os.getenv(key, "").strip()
    return value or None


AERODATABOX_KEY: str = _require("AERODATABOX_KEY")
OPENAIP_KEY: str = _require("OPENAIP_KEY")
AVWX_TOKEN: str = _require("AVWX_TOKEN")
NEXT_PUBLIC_MAPBOX_TOKEN: str | None = _optional("NEXT_PUBLIC_MAPBOX_TOKEN")
