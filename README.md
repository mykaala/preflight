# ✈️ Preflight

**[Preflight](preflight.mykaala.com)** is a flight intelligence platform for the avitation enthusiasts and curious folks who want to know what the atmosphere is doing along their route. Drop in a flight number and date, and get wind patterns, atmospheric conditions, and routing data across the whole journey. No more flying blind. 🌤️


---

## 🚀 What it does

- 🔍 **Flight Lookup** — search by flight number + optional departure date
- 🌐 **Great Circle Route** — shortest path between airports, the way planes actually fly
- 💨 **Wind Analysis** — wind speed + direction across 6 altitude levels:
  - 850 hPa (~5,000 ft) — low-level turbulence zone 😬
  - 700 hPa (~10,000 ft) — climb/descent zone
  - 500 hPa (~18,000 ft) — mid-level winds
  - 300 hPa (~30,000 ft) — upper winds
  - 250 hPa (~34,000 ft) — typical narrowbody cruise altitude
  - 200 hPa (~38,600 ft) — typical widebody cruise altitude
- 🎞️ **Cross-Section Animation** — 3D wind viz along the actual flight path
- 🗺️ **Interactive Map** — Mapbox-powered route visualization
- ✨ **Glassmorphism UI** — smooth Framer Motion animations (it looks clean, trust)

---

## 🛠️ Stack

### Frontend
- **Framework**: Next.js 16 + React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Animations**: Framer Motion
- **Visualization**: Mapbox GL, Three.js
- **State**: TanStack Query
- **Geospatial**: Turf.js for route math

**Pages**:
- `/` — flight lookup with date input + validation
- `/flight/[flightNumber]` — route map, flight details, atmospheric viz

### Backend
- **Language**: Python 3.14
- **Weather API**: Open-Meteo (free, no key needed 🙌)

---

## 📁 Project structure
```
preflight/
├── frontend/
│   ├── app/
│   │   ├── page.tsx                        # home / flight lookup
│   │   ├── flight/[flightNumber]/page.tsx  # flight details + viz
│   │   └── layout.tsx
│   ├── package.json
│   └── tsconfig.json
│
├── backend/
│   ├── fetchers/
│   │   ├── __init__.py
│   │   └── OPENMETEO.md   # wind fetcher docs
│   └── tests/
│
└── README.md
```

---

## 🌦️ Weather data

All data from [Open-Meteo](https://open-meteo.com) — completely free, zero auth required.

- 16-day forecast window
- 6 standard pressure levels
- Concurrent requests per waypoint for speed 🏃
- **Time interpolation**: a 10-hour flight samples the forecast for the actual hour each waypoint gets overflown — not just departure conditions. Long-haul accuracy actually matters here.
- Wind speed converted from km/h to knots (× 0.539957)

> ⚠️ Historical data (Open-Meteo Historical Weather API) not yet implemented.

---

## 🧠 Dev notes

- **Next.js 16** has some breaking changes from what you might be used to — check `node_modules/next/dist/docs/` before touching stuff and keep an eye on deprecation notices
- **Date parsing** is flexible on the home page: ISO 8601, month names, abbreviated formats — it handles it
- Canvas-based starfield + Framer Motion for that polished UI feel 🌟

---

## 🤝 Contributing

Heads up — Next.js 16 has breaking changes. Skim the docs in `node_modules/next/dist/docs/` before diving into the frontend so you don't get caught off guard.

---

## 📄 License

See [LICENSE](./LICENSE).

---

**Preflight** — *know the winds before you fly.* 🌬️
