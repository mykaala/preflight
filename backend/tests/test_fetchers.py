"""
Fetcher integration tests — hits real APIs with real keys.

Run:
    python backend/tests/test_fetchers.py

Test flight: EK203 (Emirates, Dubai OMDB → New York KJFK)
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# ── Constants ──────────────────────────────────────────────────────────────────

_state: dict[str, Any] = {}

FLIGHT_DATE   = date.today() + timedelta(days=1)
FLIGHT_NUMBER = "EK203"
ORIGIN_ICAO   = "OMDB"
DEST_ICAO     = "KJFK"

# OMDB: 25.25, 55.36  |  KJFK: 40.64, -73.78
ORIGIN_LAT, ORIGIN_LON =  25.25,  55.36
DEST_LAT,   DEST_LON   =  40.64, -73.78

EK203_WAYPOINTS = [
    {"lat": 25.25, "lng": 55.36},
    {"lat": 28.50, "lng": 50.00},
    {"lat": 33.00, "lng": 43.00},
    {"lat": 38.00, "lng": 35.00},
    {"lat": 42.00, "lng": 27.00},
    {"lat": 46.00, "lng": 18.00},
    {"lat": 49.00, "lng":  8.00},
    {"lat": 51.00, "lng": -10.00},
    {"lat": 52.00, "lng": -30.00},
    {"lat": 50.00, "lng": -50.00},
    {"lat": 46.00, "lng": -65.00},
    {"lat": 40.64, "lng": -73.78},
]

# ── Output helpers ─────────────────────────────────────────────────────────────

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
RESET  = "\033[0m"
BOLD   = "\033[1m"


def _pass(label: str, data: Any) -> None:
    preview = json.dumps(data, indent=2, default=str)
    if len(preview) > 1200:
        preview = preview[:1200] + "\n  ... (truncated)"
    print(f"\n{GREEN}{BOLD}✓ PASS{RESET} — {label}")
    print(preview)


def _fail(label: str, err: Exception) -> None:
    print(f"\n{RED}{BOLD}✗ FAIL{RESET} — {label}")
    print(f"  {type(err).__name__}: {err}")


def _skip(label: str, reason: str) -> None:
    print(f"\n{YELLOW}{BOLD}⊘ SKIP{RESET} — {label}")
    print(f"  {reason}")


def _header(title: str) -> None:
    print(f"\n{BOLD}{'─' * 60}{RESET}")
    print(f"{BOLD}  {title}{RESET}")
    print(f"{BOLD}{'─' * 60}{RESET}")


# ── AeroDataBox ────────────────────────────────────────────────────────────────

async def test_fetch_flight() -> bool:
    _header(f"AeroDataBox — fetch_flight({FLIGHT_NUMBER}, {FLIGHT_DATE})")
    from backend.fetchers.aerodatabox import fetch_flight
    try:
        result = await fetch_flight(FLIGHT_NUMBER, FLIGHT_DATE)
        _state["flight"] = result
        _state["aircraft_reg"] = result.get("aircraftReg")
        _pass("fetch_flight", result)
        return True
    except Exception as e:
        _fail("fetch_flight", e)
        return False


async def test_fetch_inbound() -> bool:
    _header(f"AeroDataBox — fetch_inbound({FLIGHT_NUMBER})")
    from backend.fetchers.aerodatabox import fetch_inbound
    try:
        result = await fetch_inbound(FLIGHT_NUMBER, FLIGHT_DATE)
        if result is None:
            _skip("fetch_inbound", "No inbound rotation (aircraft not yet assigned)")
            return True
        _pass("fetch_inbound", result)
        return True
    except Exception as e:
        _fail("fetch_inbound", e)
        return False


# ── Airport lookup (static CSV) ────────────────────────────────────────────────

def test_airport_lookup() -> bool:
    _header("airport_lookup — OMDB + KJFK")
    from backend.utils.airport_lookup import get_airport_by_icao
    passed = True
    for icao in [ORIGIN_ICAO, DEST_ICAO]:
        result = get_airport_by_icao(icao)
        if result:
            _pass(f"get_airport_by_icao({icao})", result)
        else:
            _fail(f"get_airport_by_icao({icao})", ValueError(f"{icao} not found"))
            passed = False
    return passed


# ── AVWX ──────────────────────────────────────────────────────────────────────

async def test_fetch_metar() -> bool:
    _header("AVWX — fetch_metar(OMDB) + fetch_metar(KJFK)")
    from backend.fetchers.avwx import fetch_metar
    passed = True
    for icao in [ORIGIN_ICAO, DEST_ICAO]:
        try:
            result = await fetch_metar(icao)
            _pass(f"fetch_metar({icao})", result)
        except Exception as e:
            _fail(f"fetch_metar({icao})", e)
            passed = False
    return passed


async def test_fetch_taf() -> bool:
    _header(f"AVWX — fetch_taf({DEST_ICAO})")
    from backend.fetchers.avwx import fetch_taf
    try:
        result = await fetch_taf(DEST_ICAO)
        _pass(f"fetch_taf({DEST_ICAO})", result)
        return True
    except Exception as e:
        _fail(f"fetch_taf({DEST_ICAO})", e)
        return False


# ── aviationweather.gov ────────────────────────────────────────────────────────

async def test_fetch_pireps() -> bool:
    _header("aviationweather — fetch_pireps (OMDB→KJFK corridor)")
    from backend.fetchers.aviationweather import fetch_pireps
    try:
        result = await fetch_pireps(ORIGIN_LAT, ORIGIN_LON, DEST_LAT, DEST_LON)
        if not result:
            _skip("fetch_pireps", "No PIREPs in corridor (valid — may be none filed)")
        else:
            _pass("fetch_pireps", result[:3])
            print(f"  ... {len(result)} total PIREPs")
        return True
    except Exception as e:
        _fail("fetch_pireps", e)
        return False


async def test_fetch_sigmets() -> bool:
    _header("aviationweather — fetch_sigmets()")
    from backend.fetchers.aviationweather import fetch_sigmets
    try:
        result = await fetch_sigmets()
        if not result:
            _skip("fetch_sigmets", "No active SIGMETs (valid)")
        else:
            _pass("fetch_sigmets", result[:2])
            print(f"  ... {len(result)} total SIGMETs")
        return True
    except Exception as e:
        _fail("fetch_sigmets", e)
        return False



# ── OpenAIP ───────────────────────────────────────────────────────────────────

async def test_fetch_airspace() -> bool:
    _header("OpenAIP — fetch_airspace (OMDB→KJFK bbox)")
    from backend.fetchers.openaip import fetch_airspace
    # bbox with 3° padding
    try:
        result = await fetch_airspace(
            min_lat=DEST_LAT   - 3,
            min_lon=DEST_LON   - 3,
            max_lat=ORIGIN_LAT + 3,
            max_lon=ORIGIN_LON + 3,
        )
        if not result:
            _skip("fetch_airspace", "No airspace found in bbox (valid)")
        else:
            _pass("fetch_airspace", result[:2])
            print(f"  ... {len(result)} total airspaces")
        return True
    except Exception as e:
        _fail("fetch_airspace", e)
        return False


# ── Open-Meteo ────────────────────────────────────────────────────────────────

async def test_fetch_route_winds() -> bool:
    _header(f"Open-Meteo — fetch_route_winds ({len(EK203_WAYPOINTS)} waypoints)")
    from backend.fetchers.openmeteo import fetch_route_winds
    departure_time = datetime(
        FLIGHT_DATE.year, FLIGHT_DATE.month, FLIGHT_DATE.day,
        8, 30, tzinfo=timezone.utc,
    )
    try:
        result = await fetch_route_winds(
            waypoints=EK203_WAYPOINTS,
            flight_date=FLIGHT_DATE.isoformat(),
            departure_time=departure_time,
            flight_duration_hours=14.0,
        )
        _pass("fetch_route_winds", {
            "total_waypoints": len(result),
            "first": result[0] if result else None,
            "last":  result[-1] if result else None,
        })
        return True
    except Exception as e:
        _fail("fetch_route_winds", e)
        return False


# ── Full route test ───────────────────────────────────────────────────────────

async def test_preflight_route() -> bool:
    _header(f"ROUTE — GET /api/preflight/{FLIGHT_NUMBER}?date={FLIGHT_DATE}")
    from backend.routes.preflight import get_preflight
    try:
        result = await get_preflight(
            flight_number=FLIGHT_NUMBER,
            date=FLIGHT_DATE.isoformat(),
        )
        # Print top-level shape with truncated nested values
        shape = {k: type(v).__name__ if not isinstance(v, (str, int, float, bool, type(None))) else v
                 for k, v in result.items()}
        _pass("preflight route shape", shape)
        # Print weather subkeys
        weather_shape = {k: (len(v) if isinstance(v, list) else type(v).__name__)
                         for k, v in result.get("weather", {}).items()}
        print(f"\n  weather: {json.dumps(weather_shape)}")
        print(f"  airspace count: {len(result.get('airspace', []))}")
        print(f"  route wind waypoints: {len(result.get('atmosphere', {}).get('routeWinds', []))}")
        return True
    except Exception as e:
        _fail("preflight route", e)
        return False


# ── Runner ─────────────────────────────────────────────────────────────────────

async def run_all() -> None:
    print(f"\n{BOLD}PREFLIGHT FETCHER TESTS{RESET}")
    print(f"Flight: {FLIGHT_NUMBER}  |  Date: {FLIGHT_DATE}  |  Route: {ORIGIN_ICAO} → {DEST_ICAO}")

    tests = [
        ("fetch_flight",       test_fetch_flight),
        ("fetch_inbound",      test_fetch_inbound),
        ("airport_lookup",     test_airport_lookup),
        ("fetch_metar (avwx)", test_fetch_metar),
        ("fetch_taf (avwx)",   test_fetch_taf),
        ("fetch_pireps",       test_fetch_pireps),
        ("fetch_sigmets",      test_fetch_sigmets),
        ("fetch_airspace",     test_fetch_airspace),
        ("fetch_route_winds",  test_fetch_route_winds),
        ("preflight route",    test_preflight_route),
    ]

    results: list[tuple[str, bool | None]] = []
    for name, fn in tests:
        passed = await fn() if inspect.iscoroutinefunction(fn) else fn()
        results.append((name, passed))

    print(f"\n{BOLD}{'═' * 60}{RESET}")
    print(f"{BOLD}  SUMMARY{RESET}")
    print(f"{BOLD}{'═' * 60}{RESET}")
    for name, passed in results:
        if passed is True:
            print(f"  {GREEN}✓{RESET}  {name}")
        elif passed is False:
            print(f"  {RED}✗{RESET}  {name}")
        else:
            print(f"  {YELLOW}⊘{RESET}  {name} (skipped)")
    print()

    failed  = sum(1 for _, p in results if p is False)
    skipped = sum(1 for _, p in results if p is None)
    if failed:
        print(f"{RED}{BOLD}{failed} failed{RESET}  |  {skipped} skipped\n")
        sys.exit(1)
    else:
        print(f"{GREEN}{BOLD}All passed{RESET}  |  {skipped} skipped\n")


if __name__ == "__main__":
    asyncio.run(run_all())
