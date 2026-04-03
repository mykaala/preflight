"""
AVWX API — METAR and TAF for any airport worldwide.

Global coverage, no fallback needed. Requires AVWX_TOKEN from .env.local.
Docs: https://avwx.rest/api
"""

import httpx

from config import AVWX_TOKEN

_BASE = "https://avwx.rest/api"
_HEADERS = {"Authorization": AVWX_TOKEN}


async def fetch_metar(icao: str) -> dict:
    """
    Latest METAR for any airport worldwide.

    Args:
        icao: Airport ICAO code, e.g. "OMDB" or "KJFK"
    """
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{_BASE}/metar/{icao.upper()}",
            headers=_HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        return r.json()


async def fetch_taf(icao: str) -> dict:
    """
    Latest TAF for any airport worldwide.

    Args:
        icao: Airport ICAO code, e.g. "KJFK"
    """
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{_BASE}/taf/{icao.upper()}",
            headers=_HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        return r.json()
