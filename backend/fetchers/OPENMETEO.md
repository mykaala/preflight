# openmeteo.py — Route Wind Grid Fetcher

Powers the **vertical atmosphere cross-section animation** on the Preflight briefing page.

---

## What it does

Fetches wind speed and direction at 6 pressure levels for every waypoint along the great circle route between origin and destination. All waypoint requests fire concurrently.

**API:** [Open-Meteo](https://open-meteo.com/en/docs) — free, no API key required.

---

## Pressure levels

| hPa | Approx. altitude | Context |
|-----|-----------------|---------|
| 850 | 5,000 ft | Low-level turbulence, icing |
| 700 | 10,000 ft | Climb/descent zone |
| 500 | 18,000 ft | Mid-level winds |
| 300 | 30,000 ft | Upper winds |
| 250 | 34,000 ft | Typical narrowbody cruise |
| 200 | 38,600 ft | Typical widebody cruise |

---

## Function

```python
async def fetch_route_winds(
    waypoints: list[dict[str, float]],
    flight_date: str,
    departure_time: datetime | None = None,
    flight_duration_hours: float | None = None,
    levels: list[int] | None = None,
) -> list[WaypointWind]
```

### Args

| Param | Type | Description |
|-------|------|-------------|
| `waypoints` | `list[{"lat": float, "lng": float}]` | Ordered route points, origin → destination. Typically 20–40 points from the route interpolation layer. |
| `flight_date` | `str` | ISO 8601 date, e.g. `"2026-08-15"`. Must be within Open-Meteo's 16-day forecast window. |
| `departure_time` | `datetime \| None` | UTC departure time. Used to sample the correct forecast hour at each waypoint. If `None`, uses hour 0. |
| `flight_duration_hours` | `float \| None` | Total flight time. Combined with `departure_time` to interpolate per-waypoint times along the route. If `None`, all waypoints use `departure_time`. |
| `levels` | `list[int] \| None` | Pressure levels to sample in hPa. Defaults to `[850, 700, 500, 300, 250, 200]`. |

### Returns

`list[WaypointWind]` — one entry per input waypoint, in route order.

```python
class WaypointWind(TypedDict):
    lat: float
    lng: float
    routeProgressPct: float      # 0.0–100.0, maps to animation x-axis
    levels: list[WindAtLevel]

class WindAtLevel(TypedDict):
    pressureHpa: int
    altitudeFt: int              # approximate, maps to animation y-axis
    speedKt: float               # converted from km/h
    directionDeg: float          # meteorological convention (where wind comes FROM)
```

### Raises

| Exception | When |
|-----------|------|
| `ValueError` | `waypoints` is empty |
| `httpx.HTTPStatusError` | Any waypoint request returns a non-2xx response |

---

## How time interpolation works

If `departure_time` and `flight_duration_hours` are both provided, each waypoint is assigned an estimated overfly time:

```
waypoint_time = departure_time + (i / total_waypoints) × flight_duration_hours
```

This means a waypoint at 50% route progress on an 8-hour flight samples the forecast 4 hours after departure — the hour the aircraft will actually be there, not when it left. This matters for long-haul routes where the jet stream shifts across time zones.

If either is `None`, all waypoints sample the same hour.

---

## Frontend contract

The return shape maps directly to the cross-section animation axes:

- `routeProgressPct` → **x-axis** (0 = origin, 100 = destination)
- `altitudeFt` → **y-axis** (ground to ~45,000 ft)
- `speedKt` + `directionDeg` → wind particle velocity and angle at each grid cell

PIREP turbulence zones are overlaid on the same grid by the frontend — this fetcher does not include them.

---

## Example output (single waypoint)

```json
{
  "lat": 25.2,
  "lng": 55.4,
  "routeProgressPct": 0.0,
  "levels": [
    { "pressureHpa": 850, "altitudeFt": 5000,  "speedKt": 12.3, "directionDeg": 285.0 },
    { "pressureHpa": 700, "altitudeFt": 10000, "speedKt": 22.1, "directionDeg": 270.0 },
    { "pressureHpa": 500, "altitudeFt": 18000, "speedKt": 41.5, "directionDeg": 265.0 },
    { "pressureHpa": 300, "altitudeFt": 30000, "speedKt": 78.2, "directionDeg": 255.0 },
    { "pressureHpa": 250, "altitudeFt": 34000, "speedKt": 95.0, "directionDeg": 250.0 },
    { "pressureHpa": 200, "altitudeFt": 38600, "speedKt": 88.4, "directionDeg": 248.0 }
  ]
}
```

---

## Notes

- Open-Meteo wind speed is returned in km/h and converted to knots (`× 0.539957`).
- The 16-day forecast window means dates beyond that require Open-Meteo's [Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) — not yet implemented.
- Concurrency: a 30-waypoint route fires 30 parallel HTTP requests inside one shared `httpx.AsyncClient` session via `asyncio.gather`.
