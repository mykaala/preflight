# Preflight

**Preflight** is a flight intelligence platform that provides pilots and aviation professionals with detailed weather briefings along planned flight routes. Enter a flight number and departure date to explore atmospheric conditions, wind patterns, and routing information across your entire journey.

---

## Features

- **Flight Lookup**: Search by flight number and optional departure date
- **Great Circle Route**: Calculates the shortest distance between departure and destination airports
- **Atmospheric Wind Analysis**: Visualizes wind speed and direction across 6 altitude levels:
  - 850 hPa (~5,000 ft) — Low-level turbulence zone
  - 700 hPa (~10,000 ft) — Climb/descent zone
  - 500 hPa (~18,000 ft) — Mid-level winds
  - 300 hPa (~30,000 ft) — Upper winds
  - 250 hPa (~34,000 ft) — Typical narrowbody cruise altitude
  - 200 hPa (~38,600 ft) — Typical widebody cruise altitude
- **Cross-Section Animation**: 3D visualization of wind conditions along the flight path
- **Interactive Map**: Mapbox-powered route visualization
- **Modern UI**: Glassmorphism design with smooth animations powered by Framer Motion

---

## Architecture

### Frontend

- **Framework**: Next.js 16 with React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Animations**: Framer Motion
- **Visualization**: Mapbox GL, Three.js
- **State Management**: React Query (TanStack Query)
- **Geospatial**: Turf.js for route calculations

**Key Pages**:

- `/` — Flight lookup interface with date input and validation
- `/flight/[flightNumber]` — Flight details, route map, and atmospheric visualization

### Backend

- **Language**: Python 3.14
- **API**: Open-Meteo (free, no API key required)
- **Data**: Historical and forecast weather data

**Key Module**:

- `backend/fetchers/openmeteo.py` — Fetches concurrent wind data at waypoints along flight routes with time interpolation

---

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn/pnpm
- Python 3.14+ (for backend development)

### Install & Run

**Frontend**:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Backend** (development):

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
# Run your backend service (port/command depends on your setup)
```

---

## Project Structure

```
preflight/
├── frontend/              # Next.js application
│   ├── app/              # App router pages and layouts
│   │   ├── page.tsx      # Home (flight lookup)
│   │   ├── flight/[flightNumber]/
│   │   │   └── page.tsx  # Flight details & visualization
│   │   └── layout.tsx    # Root layout
│   ├── package.json
│   └── tsconfig.json
│
├── backend/              # Python backend
│   ├── fetchers/
│   │   ├── __init__.py
│   │   └── OPENMETEO.md  # Wind fetcher documentation
│   └── tests/
│
├── README.md             # This file
```

---

## Development Notes

- **Next.js Version**: This project uses Next.js 16 with potential breaking changes from standard conventions. See `node_modules/next/dist/docs/` for API details.
- **Date Parsing**: The home page includes flexible date parsing (supports ISO 8601, month names, abbreviated formats, etc.)
- **Animations**: Uses Framer Motion for UI animations and Canvas-based starfield rendering
- **API Integration**: All weather data sourced from Open-Meteo's free API; no authentication required

---

## Weather Data

Wind data is fetched from [Open-Meteo](https://open-meteo.com) for:

- 16-day forecast windows (current implementation)
- 6 standard pressure levels
- Concurrent requests per waypoint for performance
- Time interpolation for long-haul flights (e.g., a 10-hour flight samples forecasts for the hour each waypoint will be overflown, not departure time)

### Open-Meteo API Limits

- Free tier: No API key required
- Historical data: Requires Open-Meteo Historical Weather API (not yet implemented)
- Wind speed converted from km/h to knots (× 0.539957)

---

## Contributing

When modifying the Next.js codebase, be aware that this version has breaking changes. Consult the docs in `node_modules/next/dist/docs/` and check deprecation notices before making changes.

---

## License

See [LICENSE](./LICENSE) file.

---

**Preflight** — _Know the winds before you fly._
