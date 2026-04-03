"""
Open-Meteo API — pressure-level wind data along a flight route.

Powers the vertical atmosphere cross-section animation:
  x-axis = route progress (waypoint index)
  y-axis = altitude (pressure level)
  values = wind speed + direction at each cell

All waypoints are fetched in a single batched HTTP request by passing
comma-separated lat/lng lists. No API key required.
Docs: https://open-meteo.com/en/docs
"""

from __future__ import annotations

from datetime import datetime
from typing import TypedDict

import httpx

_BASE = "https://api.open-meteo.com/v1/forecast"

# Pressure levels covering the cruise band (35,000–45,000 ft).
# 850/700 hPa dropped — those are climb/descent altitudes, not relevant
# for the cross-section animation which focuses on cruise.
PRESSURE_LEVELS_HPA: list[int] = [500, 300, 250, 200]

LEVEL_TO_ALT_FT: dict[int, int] = {
    500: 18_000,
    300: 30_000,
    250: 34_000,
    200: 38_600,
}


# ── Types ──────────────────────────────────────────────────────────────────────

class WindAtLevel(TypedDict):
    pressureHpa: int
    altitudeFt: int
    speedKt: float
    directionDeg: float


class WaypointWind(TypedDict):
    lat: float
    lng: float
    routeProgressPct: float  # 0.0–100.0
    levels: list[WindAtLevel]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _hourly_vars(levels: list[int]) -> list[str]:
    """Build the hourly variable list for all pressure levels."""
    out: list[str] = []
    for lvl in levels:
        out.append(f"windspeed_{lvl}hPa")
        out.append(f"winddirection_{lvl}hPa")
    return out


def _closest_hour_index(times: list[str], target: datetime) -> int:
    """Return the index in Open-Meteo's time array closest to target."""
    target_ts = target.timestamp()
    best_idx, best_diff = 0, float("inf")
    for i, t in enumerate(times):
        try:
            diff = abs(datetime.fromisoformat(t).timestamp() - target_ts)
            if diff < best_diff:
                best_diff, best_idx = diff, i
        except ValueError:
            continue
    return best_idx


# ── Public fetcher ─────────────────────────────────────────────────────────────

async def fetch_route_winds(
    waypoints: list[dict[str, float]],
    flight_date: str,
    departure_time: datetime | None = None,
    flight_duration_hours: float | None = None,
    levels: list[int] | None = None,
) -> list[WaypointWind]:
    """
    Fetch wind speed and direction at multiple pressure levels for every
    waypoint along the route in a single HTTP request.

    Open-Meteo accepts comma-separated latitude/longitude lists and returns
    an array of per-location results, so N waypoints = 1 request.

    Args:
        waypoints: Ordered list of {"lat": float, "lng": float} dicts,
                   origin → destination.
        flight_date: ISO 8601 date, e.g. "2026-08-15". Must be within
                     Open-Meteo's 16-day forecast window.
        departure_time: UTC departure datetime. Used to pick the right
                        forecast hour at each waypoint. If None, uses hour 0.
        flight_duration_hours: Total flight time in hours. Combined with
                               departure_time to interpolate per-waypoint
                               times. If None, all waypoints use departure_time.
        levels: Pressure levels in hPa. Defaults to [500, 300, 250, 200].

    Returns:
        List of WaypointWind, one per input waypoint, in route order.

    Raises:
        ValueError: If waypoints is empty.
        httpx.HTTPStatusError: On non-2xx API response.
    """
    if not waypoints:
        raise ValueError("waypoints list is empty")

    active_levels = levels or PRESSURE_LEVELS_HPA
    total = len(waypoints)

    params = {
        "latitude":  ",".join(str(round(wp["lat"], 4)) for wp in waypoints),
        "longitude": ",".join(str(round(wp["lng"], 4)) for wp in waypoints),
        "hourly":    ",".join(_hourly_vars(active_levels)),
        "wind_speed_unit": "kn",   # knots directly — no conversion needed
        "start_date": flight_date,
        "end_date":   flight_date,
        "timezone":   "UTC",
    }

    async with httpx.AsyncClient() as client:
        r = await client.get(_BASE, params=params, timeout=20)
        r.raise_for_status()
        data = r.json()

    # When multiple locations are requested, Open-Meteo wraps results in a list.
    # Single location returns a plain dict — normalise to list for uniform handling.
    locations: list[dict] = data if isinstance(data, list) else [data]

    output: list[WaypointWind] = []
    for i, (wp, loc) in enumerate(zip(waypoints, locations)):
        hourly = loc.get("hourly", {})
        times: list[str] = hourly.get("time", [])

        # Pick the forecast hour the aircraft will actually be at this waypoint
        if departure_time and flight_duration_hours:
            progress = i / max(total - 1, 1)
            offset = progress * flight_duration_hours * 3600
            waypoint_time: datetime | None = datetime.fromtimestamp(
                departure_time.timestamp() + offset,
                tz=departure_time.tzinfo,
            )
        else:
            waypoint_time = departure_time

        hour_idx = _closest_hour_index(times, waypoint_time) if waypoint_time else 0

        wind_levels: list[WindAtLevel] = []
        for lvl in active_levels:
            speeds = hourly.get(f"windspeed_{lvl}hPa") or []
            dirs   = hourly.get(f"winddirection_{lvl}hPa") or []
            wind_levels.append(WindAtLevel(
                pressureHpa=lvl,
                altitudeFt=LEVEL_TO_ALT_FT.get(lvl, 0),
                speedKt=float(speeds[hour_idx]) if hour_idx < len(speeds) else 0.0,
                directionDeg=float(dirs[hour_idx]) if hour_idx < len(dirs) else 0.0,
            ))

        output.append(WaypointWind(
            lat=wp["lat"],
            lng=wp["lng"],
            routeProgressPct=round(i / max(total - 1, 1) * 100, 1),
            levels=wind_levels,
        ))

    return output
