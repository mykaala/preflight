"""
OpenAIP API — airspace data with global coverage.

Docs: https://api.core.openaip.net/api
"""

import httpx

from backend.config import OPENAIP_KEY

_BASE = "https://api.core.openaip.net/api"
_HEADERS = {"x-openaip-api-key": OPENAIP_KEY}


async def fetch_airspace(
    min_lat: float,
    min_lon: float,
    max_lat: float,
    max_lon: float,
) -> list[dict]:
    """
    Airspace polygons intersecting a bounding box.

    OpenAIP bbox format is: min_lon,min_lat,max_lon,max_lat (lng first).

    Args:
        min_lat: Southern boundary
        min_lon: Western boundary
        max_lat: Northern boundary
        max_lon: Eastern boundary

    Returns:
        List of airspace objects with name, type, and geometry.
    """
    params = {"bbox": f"{min_lon},{min_lat},{max_lon},{max_lat}"}
    async with httpx.AsyncClient() as client:
        r = await client.get(
            f"{_BASE}/airspaces",
            headers=_HEADERS,
            params=params,
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        return data.get("items", data) if isinstance(data, dict) else data
