"""
AeroDataBox API — flight info, aircraft details, inbound rotation.

Uses RapidAPI. Auth header: x-rapidapi-key.

Docs: https://doc.aerodatabox.com
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import TypedDict

import httpx

from backend.config import AERODATABOX_KEY

_BASE = "https://aerodatabox.p.rapidapi.com"
_HEADERS = {
    "x-rapidapi-host": "aerodatabox.p.rapidapi.com",
    "x-rapidapi-key": AERODATABOX_KEY,
}


# ── Internal types ─────────────────────────────────────────────────────────────

class AirportInfo(TypedDict):
    iata: str
    icao: str
    name: str
    lat: float
    lng: float


class FlightInfo(TypedDict):
    flightNumber: str
    airline: str
    airlineIata: str
    origin: AirportInfo
    destination: AirportInfo
    scheduledDeparture: str    # UTC ISO 8601
    scheduledArrival: str
    estimatedDeparture: str    # revisedTime if available, else scheduledTime
    estimatedArrival: str
    gate: str | None
    terminal: str | None
    status: str
    aircraftReg: str | None    # tail number, e.g. "A6-ENA"
    aircraftIcao24: str | None  # transponder hex, e.g. "896140" — used by OpenSky
    aircraftModel: str | None
    delayMinutes: int          # positive = late, negative = early, 0 = on time


class AircraftInfo(TypedDict):
    registration: str
    icao24: str | None         # modeS hex — passed directly to opensky.fetch_position
    icaoType: str | None       # e.g. "B77W"
    typeName: str | None       # e.g. "Boeing 777-300ER"
    airlineName: str | None
    airlineIata: str | None
    firstFlightDate: str | None
    ageYears: float | None


class InboundFlight(TypedDict):
    flightNumber: str
    origin: AirportInfo
    destination: AirportInfo
    scheduledArrival: str
    estimatedArrival: str
    delayMinutes: int
    status: str
    aircraftReg: str | None


class FlightPlanWaypoint(TypedDict):
    lat: float
    lng: float
    name: str


class AirportDelays(TypedDict):
    avgDelayMinutes: float
    delayIndex: float
    sampleSize: int


# ── Helpers ────────────────────────────────────────────────────────────────────

def _parse_airport(raw: dict) -> AirportInfo:
    loc = raw.get("location") or {}
    return AirportInfo(
        iata=raw.get("iata") or "",
        icao=raw.get("icao") or "",
        name=raw.get("name") or raw.get("shortName") or "",
        lat=loc.get("lat") or 0.0,
        lng=loc.get("lon") or 0.0,
    )


def _pick_time(time_block: dict | None, field: str = "utc") -> str:
    """
    AeroDataBox time blocks look like:
        {"scheduledTime": {"utc": "2026-08-15 08:30Z", "local": "2026-08-15 12:30+04:00"}}
    Returns empty string if the block or field is absent.
    """
    if not time_block:
        return ""
    return time_block.get(field) or ""


def _delay_minutes(scheduled_utc: str, estimated_utc: str) -> int:
    """
    Derive delay in minutes from two UTC time strings.
    AeroDataBox format: "2026-08-15 08:30Z"
    Returns 0 if either string is empty or unparseable.
    """
    fmt = "%Y-%m-%d %H:%MZ"
    try:
        sched = datetime.strptime(
            scheduled_utc, fmt).replace(tzinfo=timezone.utc)
        estim = datetime.strptime(
            estimated_utc, fmt).replace(tzinfo=timezone.utc)
        return int((estim - sched).total_seconds() / 60)
    except (ValueError, TypeError):
        return 0


def _normalize_flight(raw: dict) -> FlightInfo:
    """Map a single AeroDataBox flight object to our internal FlightInfo shape."""
    dep = raw.get("departure") or {}
    arr = raw.get("arrival") or {}
    aircraft = raw.get("aircraft") or {}
    airline = raw.get("airline") or {}

    sched_dep = _pick_time(dep.get("scheduledTime"))
    sched_arr = _pick_time(arr.get("scheduledTime"))
    estim_dep = _pick_time(dep.get("revisedTime")) or sched_dep
    estim_arr = _pick_time(arr.get("revisedTime")) or sched_arr

    return FlightInfo(
        flightNumber=raw.get("number") or "",
        airline=airline.get("name") or "",
        airlineIata=airline.get("iata") or "",
        origin=_parse_airport(dep.get("airport") or {}),
        destination=_parse_airport(arr.get("airport") or {}),
        scheduledDeparture=sched_dep,
        scheduledArrival=sched_arr,
        estimatedDeparture=estim_dep,
        estimatedArrival=estim_arr,
        gate=dep.get("gate") or None,
        terminal=dep.get("terminal") or None,
        status=raw.get("status") or "Unknown",
        aircraftReg=aircraft.get("reg") or None,
        aircraftIcao24=aircraft.get("modeS") or None,
        aircraftModel=aircraft.get("model") or None,
        delayMinutes=_delay_minutes(sched_dep, estim_dep),
    )


# ── Public fetchers ────────────────────────────────────────────────────────────

async def fetch_flight(flight_number: str, departure_date: date) -> FlightInfo:
    """
    Fetch and normalize flight info for a specific flight number and date.

    AeroDataBox returns a list of departures (including codeshares). We match
    on the exact flight number to find the right entry.

    Args:
        flight_number: IATA flight number, e.g. "EK203"
        departure_date: Local departure date

    Raises:
        ValueError: If no matching departure is found in the response
        httpx.HTTPStatusError: On non-2xx responses
    """
    url = f"{_BASE}/flights/number/{flight_number}/{departure_date.isoformat()}"
    params = {
        "withAircraftImage": "false",
        "withLocation": "false",
        "withFlightPlan": "false",
        "dateLocalRole": "Departure",
    }
    headers = {**_HEADERS, "Accept": "application/json"}

    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers=headers, params=params, timeout=10)
        r.raise_for_status()
        departures: list[dict] = r.json()

    if not departures:
        raise ValueError(
            f"No departures found for {flight_number} on {departure_date}")

    # Match on exact flight number; fall back to first result if somehow none match
    # (can happen with minor formatting differences like "EK 203" vs "EK203")
    fn_normalized = flight_number.replace(" ", "").upper()
    match = next(
        (d for d in departures if (d.get("number") or "").replace(
            " ", "").upper() == fn_normalized),
        departures[0],
    )

    return _normalize_flight(match)


async def fetch_aircraft(registration: str) -> AircraftInfo:
    """
    Fetch and normalize aircraft details by tail number.

    Args:
        registration: Aircraft registration / tail number, e.g. "A6-ENA"

    Raises:
        httpx.HTTPStatusError: On non-2xx responses (404 = unknown registration)
    """
    url = f"{_BASE}/aircrafts/reg/{registration}"

    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers=_HEADERS, timeout=10)
        r.raise_for_status()
        raw: dict = r.json()

    # Derive age from firstFlightDate if present
    age_years: float | None = None
    first_flight = raw.get("firstFlightDate")
    if first_flight:
        try:
            first_dt = datetime.strptime(first_flight[:10], "%Y-%m-%d")
            age_years = round((datetime.now() - first_dt).days / 365.25, 1)
        except ValueError:
            pass

    return AircraftInfo(
        registration=raw.get("reg") or registration,
        icao24=raw.get("modeS") or None,
        icaoType=raw.get("modelCode") or None,
        typeName=raw.get("typeName") or raw.get("model") or None,
        airlineName=raw.get("airlineName") or None,
        airlineIata=raw.get("airlineIata") or None,
        firstFlightDate=first_flight or None,
        ageYears=age_years,
    )


async def fetch_inbound(flight_number: str, departure_date: date) -> InboundFlight | None:
    """
    Find the inbound rotation leg for a flight — the previous flight of the
    same aircraft that brings it to the origin gate.

    This is the key to early delay prediction: if the inbound is delayed,
    the outbound will almost certainly follow.

    Strategy:
      1. Call fetch_flight() to get the outbound's aircraft registration
      2. Query GET /flights/reg/{registration}/{date} to get all flights
         that aircraft operated on the same date
      3. Find the leg whose destination matches the outbound origin — that's
         the inbound rotation

    Args:
        flight_number: IATA flight number of the outbound leg, e.g. "EK203"
        departure_date: Departure date of the outbound leg

    Returns:
        InboundFlight if found, None if the aircraft registration is unknown
        or no matching inbound leg exists for that date

    Raises:
        httpx.HTTPStatusError: On unexpected API errors
    """
    # Step 1: get the outbound to find the aircraft registration
    outbound = await fetch_flight(flight_number, departure_date)
    reg = outbound.get("aircraftReg")
    if not reg:
        return None  # aircraft not yet assigned

    origin_iata = outbound["origin"]["iata"]

    # Step 2: get all flights for this aircraft on the departure date
    url = f"{_BASE}/flights/reg/{reg}/{departure_date.isoformat()}"
    params = {"withAircraftImage": "false", "withLocation": "false"}

    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers=_HEADERS, params=params, timeout=10)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        all_flights: list[dict] = r.json()

    if not all_flights:
        return None

    # Step 3: find the leg that arrived at the outbound origin airport
    inbound_raw = next(
        (
            f for f in all_flights
            if (f.get("arrival") or {}).get("airport", {}).get("iataCode") == origin_iata
            and (f.get("number") or "").replace(" ", "").upper()
            # exclude the outbound itself
            != flight_number.replace(" ", "").upper()
        ),
        None,
    )

    if not inbound_raw:
        return None

    dep = inbound_raw.get("departure") or {}
    arr = inbound_raw.get("arrival") or {}
    sched_arr = _pick_time(arr.get("scheduledTime"))
    estim_arr = _pick_time(arr.get("revisedTime")) or sched_arr

    return InboundFlight(
        flightNumber=inbound_raw.get("number") or "",
        origin=_parse_airport(dep.get("airport") or {}),
        destination=_parse_airport(arr.get("airport") or {}),
        scheduledArrival=sched_arr,
        estimatedArrival=estim_arr,
        delayMinutes=_delay_minutes(sched_arr, estim_arr),
        status=inbound_raw.get("status") or "Unknown",
        aircraftReg=reg,
    )


async def fetch_flight_plan(
    flight_number: str, departure_date: date
) -> list[FlightPlanWaypoint]:
    """
    Fetch flight plan waypoints for a specific flight number and date.

    Uses the same /flights/number endpoint as fetch_flight but with
    withFlightPlan=true, which costs x2 API units on the free tier.

    AeroDataBox returns waypoints as a list of {lat, lon, name} objects
    inside the flight object under the "waypoints" key.

    Args:
        flight_number: IATA flight number, e.g. "EK203"
        departure_date: Local departure date

    Returns:
        Ordered list of {lat, lng, name} waypoints, or empty list if none
        are available in the response.

    Raises:
        httpx.HTTPStatusError: On non-2xx responses
    """
    url = f"{_BASE}/flights/number/{flight_number}/{departure_date.isoformat()}"
    params = {
        "withAircraftImage": "false",
        "withLocation": "false",
        "withFlightPlan": "true",
        "dateLocalRole": "Departure",
    }
    headers = {**_HEADERS, "Accept": "application/json"}

    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers=headers, params=params, timeout=10)
        r.raise_for_status()
        departures: list[dict] = r.json()

    if not departures:
        return []

    fn_normalized = flight_number.replace(" ", "").upper()
    match = next(
        (d for d in departures if (d.get("number") or "").replace(
            " ", "").upper() == fn_normalized),
        departures[0],
    )

    raw_waypoints: list[dict] = match.get("waypoints") or []
    result: list[FlightPlanWaypoint] = []
    for wp in raw_waypoints:
        lat = wp.get("lat")
        # AeroDataBox uses "lon" in most responses
        lng = wp.get("lon") or wp.get("lng")
        if lat is None or lng is None:
            continue
        result.append(FlightPlanWaypoint(
            lat=float(lat),
            lng=float(lng),
            name=wp.get("name") or wp.get("fix") or "",
        ))

    return result


async def fetch_airport_delays(icao: str) -> AirportDelays | None:
    """
    Fetch historical departure delay statistics for an airport.

    AeroDataBox endpoint: GET /airports/icao/{icao}/delays

    Args:
        icao: ICAO airport code, e.g. "OMDB"

    Returns:
        AirportDelays with avgDelayMinutes, delayIndex, and sampleSize,
        or None if the endpoint returns 404 or no usable data.

    Raises:
        httpx.HTTPStatusError: On unexpected non-2xx responses
    """
    url = f"{_BASE}/airports/icao/{icao}/delays"
    headers = {**_HEADERS, "Accept": "application/json"}

    async with httpx.AsyncClient() as client:
        r = await client.get(url, headers=headers, timeout=10)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        raw: dict = r.json()

    if not raw:
        return None

    # AeroDataBox may nest data under a "delays" key or return it flat
    data = raw.get("delays") or raw

    avg = data.get("avgDelay") or data.get("averageDelay") or data.get("avgDelayMinutes")
    index = data.get("delayIndex") or data.get("index")
    count = data.get("count") or data.get("sampleSize") or data.get("totalCount")

    if avg is None:
        return None

    return AirportDelays(
        avgDelayMinutes=float(avg),
        delayIndex=float(index) if index is not None else 0.0,
        sampleSize=int(count) if count is not None else 0,
    )
