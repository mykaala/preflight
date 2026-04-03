"""
aviationweather.gov API — PIREPs, SIGMETs, NOTAMs.

No API key required.
Docs: https://aviationweather.gov/data/api/
"""

import httpx

_BASE = "https://aviationweather.gov/api/data"


async def fetch_pireps(
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    padding_deg: float = 3.0,
    age_hours: int = 6,
) -> list[dict]:
    """
    Recent PIREPs within the bounding box of origin→destination + padding.

    Args:
        origin_lat: Origin airport latitude
        origin_lon: Origin airport longitude
        dest_lat: Destination airport latitude
        dest_lon: Destination airport longitude
        padding_deg: Degrees of padding on each side of the bbox (default 3°)
        age_hours: How many hours back to search (default 6)
    """
    min_lat = round(min(origin_lat, dest_lat) - padding_deg, 2)
    min_lon = round(min(origin_lon, dest_lon) - padding_deg, 2)
    max_lat = round(max(origin_lat, dest_lat) + padding_deg, 2)
    max_lon = round(max(origin_lon, dest_lon) + padding_deg, 2)
    params = {
        "bbox": f"{min_lat},{min_lon},{max_lat},{max_lon}",
        "format": "json",
        "age": age_hours,
    }
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{_BASE}/pirep", params=params, timeout=10)
        r.raise_for_status()
        return r.json() or []


async def fetch_sigmets() -> list[dict]:
    """
    All currently active SIGMETs globally. Caller filters by route bounding box.
    """
    params = {"format": "json", "type": "all"}
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{_BASE}/sigmet", params=params, timeout=10)
        r.raise_for_status()
        return r.json() or []


