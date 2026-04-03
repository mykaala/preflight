"""
GET /api/preflight/{flight_number}?date=YYYY-MM-DD

Orchestrates all fetchers and returns a single unified pre-flight briefing.
Non-critical fetchers (weather, airspace, winds) fail gracefully — their
fields return null rather than failing the whole request.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.fetchers.aerodatabox import fetch_aircraft, fetch_airport_delays, fetch_flight, fetch_flight_plan, fetch_inbound
from backend.fetchers.avwx import fetch_metar, fetch_taf
from backend.fetchers.aviationweather import fetch_pireps, fetch_sigmets
from backend.fetchers.openaip import fetch_airspace
from backend.fetchers.openmeteo import fetch_route_winds
from backend.utils.airport_lookup import get_airport_by_iata, get_airport_by_municipality
from backend.utils.airport_timezones import get_timezone_by_iata

logger = logging.getLogger(__name__)
router = APIRouter()

_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 3600  # 1 hour in seconds


def _great_circle_waypoints(
    origin_lat: float, origin_lon: float,
    dest_lat: float,   dest_lon: float,
    n: int = 12,
) -> list[dict[str, float]]:
    """
    Generate N evenly spaced waypoints along the great circle between two points
    using linear interpolation in lat/lon space — good enough for a wind grid
    fetch where precision isn't critical. For a real great circle the frontend
    uses Turf.js; this is server-side only.
    """
    return [
        {
            "lat": round(origin_lat + (dest_lat - origin_lat) * i / (n - 1), 4),
            "lng": round(origin_lon + (dest_lon - origin_lon) * i / (n - 1), 4),
        }
        for i in range(n)
    ]


async def _safe(label: str, coro: Any) -> Any:
    """Await a coroutine; return None and log on any exception."""
    try:
        return await coro
    except Exception as exc:
        logger.warning("Fetcher '%s' failed: %s: %s",
                       label, type(exc).__name__, exc)
        return None


@router.get("/preflight/{flight_number}")
async def get_preflight(
    flight_number: str,
    date: str | None = Query(
        default=None, description="Departure date YYYY-MM-DD"),
) -> dict:
    # ── 0. Cache lookup ────────────────────────────────────────────────────────
    cache_key = f"{flight_number.upper()}:{date or 'today'}"
    cached = _cache.get(cache_key)
    if cached:
        ts, payload = cached
        if time.monotonic() - ts < _CACHE_TTL:
            logger.info("Cache hit: %s", cache_key)
            return payload
        del _cache[cache_key]

    # ── 1. Parse date ──────────────────────────────────────────────────────────
    if date:
        try:
            departure_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(
                status_code=400, detail="date must be YYYY-MM-DD")
    else:
        from datetime import date as _date
        departure_date = _date.today()

    # ── 2. Fetch flight — hard failure if not found ────────────────────────────
    try:
        flight = await fetch_flight(flight_number.upper(), departure_date)
    except Exception as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Flight {flight_number.upper()} on {departure_date} not found: {exc}",
        )

    origin = flight["origin"]
    destination = flight["destination"]
    reg = flight.get("aircraftReg")

    # AeroDataBox omits airport details for future flights — fill from CSV.
    # Try IATA first, fall back to city/municipality name (AeroDataBox sometimes
    # returns only {"name": "New York"} with no IATA or ICAO).
    def _enrich(ap: dict) -> dict:
        if ap.get("icao") and ap.get("lat"):
            return ap
        lookup = (
            get_airport_by_iata(ap.get("iata") or "")
            or get_airport_by_municipality(ap.get("name") or "")
        )
        return {**ap, **lookup} if lookup else ap

    origin = _enrich(origin)
    destination = _enrich(destination)

    # Inject timezone from lookup table if not already present
    if not origin.get("timezone"):
        tz = get_timezone_by_iata(origin.get("iata") or "")
        if tz:
            origin = {**origin, "timezone": tz}
    if not destination.get("timezone"):
        tz = get_timezone_by_iata(destination.get("iata") or "")
        if tz:
            destination = {**destination, "timezone": tz}

    origin_lat, origin_lon = origin["lat"], origin["lng"]
    dest_lat,   dest_lon = destination["lat"], destination["lng"]

    # Bounding box with 3° padding for airspace / weather queries
    bbox_min_lat = round(min(origin_lat, dest_lat) - 3, 2)
    bbox_min_lon = round(min(origin_lon, dest_lon) - 3, 2)
    bbox_max_lat = round(max(origin_lat, dest_lat) + 3, 2)
    bbox_max_lon = round(max(origin_lon, dest_lon) + 3, 2)

    gc_waypoints = _great_circle_waypoints(
        origin_lat, origin_lon, dest_lat, dest_lon)

    # Estimate departure datetime for wind time-interpolation
    try:
        dep_dt = datetime.fromisoformat(
            flight.get("estimatedDeparture") or flight.get(
                "scheduledDeparture") or ""
        ).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        dep_dt = datetime.now(timezone.utc)

    # ── 3. Concurrent fetches ──────────────────────────────────────────────────
    (
        inbound,
        aircraft,
        origin_metar,
        dest_metar,
        dest_taf,
        pireps,
        sigmets,
        airspace,
        flight_plan,
        origin_delays,
        dest_delays,
    ) = await asyncio.gather(
        _safe("inbound",         fetch_inbound(
            flight_number.upper(), departure_date)),
        _safe("aircraft",        fetch_aircraft(reg)
              ) if reg else asyncio.sleep(0, result=None),
        _safe("origin_metar",    fetch_metar(origin["icao"])),
        _safe("dest_metar",      fetch_metar(destination["icao"])),
        _safe("dest_taf",        fetch_taf(destination["icao"])),
        _safe("pireps",          fetch_pireps(
            origin_lat, origin_lon, dest_lat, dest_lon)),
        _safe("sigmets",         fetch_sigmets()),
        _safe("airspace",        fetch_airspace(bbox_min_lat,
              bbox_min_lon, bbox_max_lat, bbox_max_lon)),
        _safe("flight_plan",     fetch_flight_plan(
            flight_number.upper(), departure_date)),
        _safe("origin_delays",   fetch_airport_delays(origin["icao"])),
        _safe("dest_delays",     fetch_airport_delays(destination["icao"])),
    )

    # Use actual flight plan waypoints for wind sampling when available
    plan_waypoints = flight_plan or []
    if not plan_waypoints:
        logger.info("Flight plan unavailable for %s on %s — falling back to great circle",
                    flight_number.upper(), departure_date)
    wind_waypoints = (
        [{"lat": wp["lat"], "lng": wp["lng"]} for wp in plan_waypoints]
        if len(plan_waypoints) >= 2
        else gc_waypoints
    )

    route_winds = await _safe("route_winds", fetch_route_winds(
        waypoints=wind_waypoints,
        flight_date=departure_date.isoformat(),
        departure_time=dep_dt,
    ))

    # ── 4. Generate narrative ──────────────────────────────────────────────────
    def _generate_narrative(
        flight: dict,
        origin: dict,
        destination: dict,
        origin_metar: dict | None,
        dest_metar: dict | None,
        pireps: list | None,
        sigmets: list | None,
        route_winds: list | None,
    ) -> dict:
        """Generate human-readable narrative summaries."""
        summary_parts = []

        # Basic flight info
        delay = flight.get("delayMinutes", 0)
        if delay > 0:
            summary_parts.append(f"Flight is delayed by {delay} minutes.")
        else:
            summary_parts.append("Flight is on time.")

        # Weather at origin
        origin_weather = "Weather data unavailable."
        if origin_metar:
            fr = origin_metar.get("flight_rules", "VFR")
            temp = origin_metar.get("temperature", {}).get("value")
            wind_spd = origin_metar.get("wind_speed", {}).get("value", 0)
            vis = origin_metar.get("visibility", {}).get("repr", "10+")

            conditions = []
            if fr != "VFR":
                conditions.append(f"{fr} conditions")
            if temp is not None:
                conditions.append(f"{temp}°C")
            if wind_spd > 10:
                conditions.append(f"winds {wind_spd} kt")
            if vis != "10+":
                conditions.append(f"visibility {vis}")

            origin_weather = f"{origin.get('name', 'Origin')}: {'; '.join(conditions) if conditions else 'Clear skies'}."

        # Weather at destination
        dest_weather = "Weather data unavailable."
        if dest_metar:
            fr = dest_metar.get("flight_rules", "VFR")
            temp = dest_metar.get("temperature", {}).get("value")
            wind_spd = dest_metar.get("wind_speed", {}).get("value", 0)
            vis = dest_metar.get("visibility", {}).get("repr", "10+")

            conditions = []
            if fr != "VFR":
                conditions.append(f"{fr} conditions")
            if temp is not None:
                conditions.append(f"{temp}°C")
            if wind_spd > 10:
                conditions.append(f"winds {wind_spd} kt")
            if vis != "10+":
                conditions.append(f"visibility {vis}")

            dest_weather = f"{destination.get('name', 'Destination')}: {'; '.join(conditions) if conditions else 'Clear skies'}."

        # Turbulence from PIREPs
        turbulence = "No significant turbulence reported."
        if pireps:
            severe = [p for p in pireps if p.get(
                "pirepType") == "Urgent" or "SEV" in str(p.get("tbInt1", ""))]
            if severe:
                turbulence = f"Severe turbulence reported near flight path."
            elif pireps:
                turbulence = f"Turbulence reports along route."

        # Jet stream (simplified)
        jet_stream = "Jet stream conditions normal."

        # Delay risk
        delay_risk = "Low delay risk."
        if sigmets:
            delay_risk = "Potential delays due to weather alerts."

        # Wind altitude
        wind_altitude = "Winds aloft data available."

        # Weather alerts
        weather_alerts = []
        if sigmets:
            weather_alerts.extend(
                [s.get("hazard", "Weather alert") for s in sigmets[:3]])

        return {
            "summary": " ".join(summary_parts),
            "turbulence": turbulence,
            "jetStream": jet_stream,
            "delayRisk": delay_risk,
            "originWeather": origin_weather,
            "destWeather": dest_weather,
            "windAltitude": wind_altitude,
            "weatherAlerts": weather_alerts,
        }

    narrative = _generate_narrative(
        flight, origin, destination, origin_metar, dest_metar, pireps, sigmets, route_winds
    )

    # ── 5. Assemble response ───────────────────────────────────────────────────
    response = {
        "flight":      flight,
        "aircraft":    aircraft,
        "inbound":     inbound,
        "origin":      origin,
        "destination": destination,
        "flightPlan":  plan_waypoints,
        "delays": {
            "origin":      origin_delays,
            "destination": dest_delays,
        },
        "weather": {
            "originMetar": origin_metar,
            "destMetar":   dest_metar,
            "destTaf":     dest_taf,
            "pireps":      pireps or [],
            "sigmets":     sigmets or [],
        },
        "atmosphere": {
            "routeWinds": route_winds or [],
        },
        "airspace": airspace or [],
        "narrative": narrative,
    }
    _cache[cache_key] = (time.monotonic(), response)
    return response
