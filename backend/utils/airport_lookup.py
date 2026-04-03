"""
Airport lookup — loads ourairports.com airports.csv once at import time
and exposes O(1) lookups by ICAO or IATA code.

Only large_airport and medium_airport types are indexed — small airports,
heliports, seaplane bases etc. are excluded.

Data file: backend/data/airports.csv
Source: https://ourairports.com/data/airports.csv
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import TypedDict

_CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "airports.csv"

_INCLUDED_TYPES = {"large_airport", "medium_airport"}


class AirportInfo(TypedDict):
    icao: str
    iata: str
    name: str
    municipality: str
    lat: float
    lng: float
    elevation_ft: int | None
    timezone: str


def _load() -> tuple[dict[str, AirportInfo], dict[str, AirportInfo], dict[str, AirportInfo]]:
    by_icao: dict[str, AirportInfo] = {}
    by_iata: dict[str, AirportInfo] = {}
    by_municipality: dict[str, AirportInfo] = {}

    with open(_CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["type"] not in _INCLUDED_TYPES:
                continue

            icao = (row.get("icao_code") or row.get("ident") or "").strip()
            iata = (row.get("iata_code") or "").strip()

            if not icao:
                continue

            try:
                lat = float(row["latitude_deg"])
                lng = float(row["longitude_deg"])
            except (ValueError, KeyError):
                continue

            elev = row.get("elevation_ft", "").strip()
            elevation_ft: int | None = int(float(elev)) if elev else None

            # ourairports.com doesn't include timezone in the base CSV —
            # field will be empty string until a tz-enriched CSV is used
            timezone = (row.get("tz_database_timezone") or "").strip()

            info = AirportInfo(
                icao=icao,
                iata=iata,
                name=row.get("name", "").strip(),
                municipality=row.get("municipality", "").strip(),
                lat=lat,
                lng=lng,
                elevation_ft=elevation_ft,
                timezone=timezone,
            )

            by_icao[icao.upper()] = info
            if iata:
                by_iata[iata.upper()] = info
            # Municipality index: only store large_airports to avoid ambiguous
            # city matches (e.g. "New York" → KJFK, not KLGA or KEWR)
            if row["type"] == "large_airport":
                municipality_key = row.get("municipality", "").strip().upper()
                if municipality_key and municipality_key not in by_municipality:
                    by_municipality[municipality_key] = info

    return by_icao, by_iata, by_municipality


# Build maps once at module load — lookups are O(1) after this
_BY_ICAO, _BY_IATA, _BY_MUNICIPALITY = _load()


def get_airport_by_icao(icao: str) -> AirportInfo | None:
    """Return airport info for an ICAO code, or None if not found."""
    return _BY_ICAO.get(icao.upper())


def get_airport_by_iata(iata: str) -> AirportInfo | None:
    """Return airport info for an IATA code, or None if not found."""
    return _BY_IATA.get(iata.upper())


def get_airport_by_municipality(city: str) -> AirportInfo | None:
    """
    Return the primary large_airport for a city name, or None if not found.
    Uses the first large_airport encountered for that municipality.
    Useful when AeroDataBox only returns a city name with no ICAO/IATA.
    """
    return _BY_MUNICIPALITY.get(city.upper())
