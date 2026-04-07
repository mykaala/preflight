'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { AnimatePresence, motion } from 'framer-motion';
import AtmosphereView from './AtmosphereView';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Airport {
	iata: string;
	icao: string;
	name: string;
	lat: number;
	lng: number;
	municipality?: string;
	timezone?: string;
}

interface FlightInfo {
	flightNumber: string;
	airline: string;
	airlineIata: string;
	origin: Airport;
	destination: Airport;
	scheduledDeparture: string;
	scheduledArrival: string;
	estimatedDeparture: string;
	estimatedArrival: string;
	gate: string | null;
	terminal: string | null;
	status: string;
	aircraftReg: string | null;
	aircraftModel: string | null;
	delayMinutes: number;
}

interface AircraftInfo {
	registration: string;
	typeName: string | null;
	airlineName: string | null;
	ageYears: number | null;
}

interface InboundFlight {
	flightNumber: string;
	origin: Airport;
	destination: Airport;
	scheduledArrival: string;
	estimatedArrival: string;
	delayMinutes: number;
	status: string;
}

interface MetarData {
	flight_rules: string;
	wind_direction: { value: number } | null;
	wind_speed: { value: number } | null;
	wind_gust: { value: number } | null;
	visibility: { repr: string; value: number | null } | null;
	clouds: { type: string; altitude: number; repr: string }[];
	temperature: { value: number } | null;
	raw: string;
	sanitized?: string;
}

interface TafForecast {
	start_time: { dt: string };
	end_time: { dt: string };
	flight_rules: string;
	wind_direction: { value: number } | null;
	wind_speed: { value: number } | null;
	visibility: { repr: string; value: number | null } | null;
	clouds: { type: string; altitude: number; repr: string }[];
}

interface TafData {
	forecast: TafForecast[];
	raw: string;
}

interface Pirep {
	lat: number;
	lon: number;
	fltLvl: number | null;
	tbInt1: string | null;
	tbInt2: string | null;
	icgInt1: string | null;
	rawOb: string;
	pirepType: string;
}

interface Sigmet {
	hazard: string;
	severity: number | null;
	validTimeFrom: number;
	validTimeTo: number;
	rawAirSigmet: string;
	coords: { lat: number; lon: number }[];
	airSigmetType: string;
}

interface WindLevel {
	pressureHpa: number;
	altitudeFt: number;
	speedKt: number;
	directionDeg: number;
}

interface RouteWind {
	lat: number;
	lng: number;
	routeProgressPct: number;
	levels: WindLevel[];
}

interface AirspaceItem {
	name: string;
	type: number;
	icaoClass: number;
	lowerLimit: { value: number; unit: number };
	upperLimit: { value: number; unit: number };
	geometry: GeoJSON.Geometry;
}

interface Narrative {
	summary: string;
	turbulence: string;
	jetStream: string;
	delayRisk: string;
	originWeather: string;
	destWeather: string;
	windAltitude: string;
	weatherAlerts: string[];
}

interface FlightPlanWaypoint {
	lat: number;
	lng: number;
	name: string;
}

interface AirportDelays {
	avgDelayMinutes: number;
	delayIndex: number;
	sampleSize: number;
}

interface PreflightData {
	flight: FlightInfo;
	aircraft: AircraftInfo | null;
	inbound: InboundFlight | null;
	origin: Airport;
	destination: Airport;
	flightPlan: FlightPlanWaypoint[];
	delays: {
		origin: AirportDelays | null;
		destination: AirportDelays | null;
	};
	weather: {
		originMetar: MetarData | null;
		destMetar: MetarData | null;
		destTaf: TafData | null;
		pireps: Pirep[];
		sigmets: Sigmet[];
	};
	atmosphere: { routeWinds: RouteWind[] };
	airspace: AirspaceItem[];
	narrative: Narrative;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
	const s = status.toLowerCase();
	if (s.includes('cancel')) return '#ffb4ab';
	if (s.includes('depart') || s.includes('airborne') || s.includes('enroute')) return '#aac7ff';
	if (s.includes('arrived') || s.includes('landed')) return '#53e16f';
	if (s.includes('gate') || s.includes('boarding') || s.includes('closed')) return '#ffb874';
	return '#c0c6d6';
}

function flightRulesColor(fr: string): string {
	if (fr === 'VFR') return '#53e16f';
	if (fr === 'MVFR') return '#ffb874';
	if (fr === 'IFR') return '#ffb4ab';
	if (fr === 'LIFR') return '#cf6679';
	return '#c0c6d6';
}

function parseUtc(utcStr: string): Date | null {
	if (!utcStr) return null;
	try {
		return new Date(utcStr.replace(' ', 'T').replace(/Z$/, '+00:00'));
	} catch {
		return null;
	}
}

function toLocalTime(utcStr: string, tz: string | undefined): string {
	if (!tz) return '—';
	const d = parseUtc(utcStr);
	if (!d || isNaN(d.getTime())) return '—';
	try {
		return new Intl.DateTimeFormat('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: tz
		}).format(d);
	} catch {
		return '—';
	}
}

function tzAbbr(tz: string | undefined): string {
	if (!tz) return '';
	try {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZoneName: 'short',
			timeZone: tz
		}).formatToParts(new Date());
		return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
	} catch {
		return '';
	}
}

function localTimeWithZone(utcStr: string, tz: string | undefined): string {
	const t = toLocalTime(utcStr, tz);
	if (t === '—') return '—';
	const abbr = tzAbbr(tz);
	return abbr ? `${t} ${abbr}` : t;
}

function fmtWind(metar: MetarData): string {
	if (!metar.wind_speed) return '—';
	const dir = metar.wind_direction?.value ?? 0;
	const spd = metar.wind_speed.value;
	const gst = metar.wind_gust ? `G${metar.wind_gust.value}` : '';
	return `${String(dir).padStart(3, '0')}° / ${spd}${gst}kt`;
}

function fmtVis(metar: MetarData): string {
	if (!metar.visibility) return '—';
	const v = metar.visibility.value;
	if (v === null) return metar.visibility.repr;
	if (v >= 9999) return 'CAVOK';
	return v >= 1000 ? `${(v / 1000).toFixed(1)}km` : `${v}m`;
}

function fmtClouds(metar: MetarData): string {
	if (!metar.clouds || metar.clouds.length === 0) return 'CLEAR';
	return metar.clouds.map((c) => c.repr).join(' ');
}

function tbColor(intensity: string | null): string {
	if (!intensity) return '#8b91a0';
	const i = intensity.toUpperCase();
	if (i.includes('SEV') || i.includes('EXTM')) return '#ffb4ab';
	if (i.includes('MOD')) return '#ffb874';
	if (i.includes('LGT')) return '#53e16f';
	return '#8b91a0';
}

function gcWaypoints(oLat: number, oLng: number, dLat: number, dLng: number, n = 64): [number, number][] {
	const toRad = (d: number) => (d * Math.PI) / 180;
	const toDeg = (r: number) => (r * 180) / Math.PI;

	const lat1 = toRad(oLat),
		lng1 = toRad(oLng);
	const lat2 = toRad(dLat),
		lng2 = toRad(dLng);

	const d =
		2 *
		Math.asin(
			Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2)
		);

	return Array.from({ length: n }, (_, i) => {
		const f = i / (n - 1);
		const A = Math.sin((1 - f) * d) / Math.sin(d);
		const B = Math.sin(f * d) / Math.sin(d);
		const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
		const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
		const z = A * Math.sin(lat1) + B * Math.sin(lat2);
		return [toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))] as [number, number];
	});
}

// ── New helpers ────────────────────────────────────────────────────────────────

function cityName(airport: Airport): string {
	return airport.municipality || airport.iata;
}

function airportName(airport: Airport): string {
	return airport.name;
}

function departsIn(utcStr: string): string {
	if (!utcStr) return '';
	const d = parseUtc(utcStr);
	if (!d || isNaN(d.getTime())) return '';
	const diffMin = Math.round((d.getTime() - Date.now()) / 60000);
	if (diffMin < -300) return '';
	if (diffMin < 0) return `Departed ${Math.abs(diffMin)}m ago`;
	if (diffMin < 60) return `Departs in ${diffMin}m`;
	const h = Math.floor(diffMin / 60);
	const m = diffMin % 60;
	return m > 0 ? `Departs in ${h}h ${m}m` : `Departs in ${h}h`;
}

function windSentence(metar: MetarData): string {
	if (!metar.wind_speed) return 'Calm';
	const spd = metar.wind_speed.value;
	if (spd < 3) return 'Calm';
	const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
	const dir = metar.wind_direction?.value;
	const dirStr = dir != null ? dirs[Math.round(dir / 45) % 8] : null;
	const gustStr = metar.wind_gust ? `, gusting ${metar.wind_gust.value} kt` : '';
	return dirStr ? `${spd} kt from ${dirStr}${gustStr}` : `${spd} kt${gustStr}`;
}

function tafCondition(p: TafForecast): string {
	if (p.flight_rules === 'LIFR') return 'Very low visibility';
	if (p.flight_rules === 'IFR') return 'Poor visibility';
	if (p.flight_rules === 'MVFR') return 'Reduced visibility';
	const clouds = p.clouds || [];
	if (clouds.some((c) => c.type === 'OVC')) return 'Overcast';
	if (clouds.some((c) => c.type === 'BKN')) return 'Mostly cloudy';
	if (clouds.some((c) => c.type === 'SCT')) return 'Partly cloudy';
	return 'Clear';
}

function statusLabel(status: string): string {
	const s = status.toLowerCase();
	if (s.includes('cancel')) return 'Cancelled';
	if (s.includes('airborne') || s.includes('enroute')) return 'In flight';
	if (s.includes('depart')) return 'Departed';
	if (s.includes('arrived') || s.includes('landed')) return 'Arrived';
	if (s.includes('boarding')) return 'Boarding';
	if (s.includes('gate')) return 'At gate';
	if (s.includes('on time') || s.includes('schedule')) return 'On time';
	return status;
}

function flightDuration(dep: string, arr: string): string {
	const d = parseUtc(dep),
		a = parseUtc(arr);
	if (!d || !a || isNaN(d.getTime()) || isNaN(a.getTime())) return '—';
	const mins = Math.round((a.getTime() - d.getTime()) / 60000);
	const h = Math.floor(mins / 60),
		m = mins % 60;
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Design constants ───────────────────────────────────────────────────────────

const INTER = 'var(--font-family-sans)';
const DISPLAY = 'var(--font-family-display)';
const MONO = 'var(--font-family-mono)';

// TYPE SCALE — Stitch "Flight Briefing App / Celestial Navigator"
const TYPE = {
	PRIMARY: {
		fontFamily: DISPLAY,
		fontSize: '28px',
		fontWeight: 700,
		lineHeight: 1.2,
		color: '#e2e2e8'
	} as React.CSSProperties,
	PRIMARY_VALUE: {
		fontFamily: DISPLAY,
		fontSize: '16px',
		fontWeight: 600,
		lineHeight: 1.3,
		color: '#e2e2e8'
	} as React.CSSProperties,
	SECONDARY: {
		fontFamily: INTER,
		fontSize: '14px',
		fontWeight: 600,
		lineHeight: 1.4,
		color: '#e2e2e8'
	} as React.CSSProperties,
	LABEL: {
		fontFamily: INTER,
		fontSize: '11px',
		fontWeight: 500,
		color: '#8b91a0',
		textTransform: 'uppercase',
		letterSpacing: '0.12em'
	} as React.CSSProperties,
	BODY: {
		fontFamily: INTER,
		fontSize: '13px',
		fontWeight: 400,
		lineHeight: 1.6,
		color: '#c0c6d6'
	} as React.CSSProperties,
	META: {
		fontFamily: MONO,
		fontSize: '11px',
		fontWeight: 400,
		color: '#8b91a0'
	} as React.CSSProperties,
	SUBTEXT: {
		fontFamily: INTER,
		fontSize: '12px',
		fontWeight: 400,
		color: '#c0c6d6'
	} as React.CSSProperties
};

// GLASS CARD SYSTEM — tonal layering, no hard borders (Flight Briefing App palette)
const GLASS_BASE: React.CSSProperties = {
	background: '#1a1c20',
	backdropFilter: 'blur(20px) saturate(180%)',
	WebkitBackdropFilter: 'blur(20px) saturate(180%)',
	border: '1px solid rgba(255, 255, 255, 0.05)',
	borderRadius: '20px'
};

const CARD: React.CSSProperties = {
	...GLASS_BASE,
	padding: '16px 18px',
	marginBottom: '12px',
	boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(170, 199, 255, 0.05)',
	transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
};

const CARD_ELEVATED: React.CSSProperties = {
	...GLASS_BASE,
	padding: '18px 20px',
	marginBottom: '12px',
	background: '#282a2e',
	border: '1px solid rgba(170, 199, 255, 0.08)',
	boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(170, 199, 255, 0.07)'
};

const getCardHoverStyle = (isHovered: boolean): React.CSSProperties => ({
	...CARD,
	...(isHovered && {
		background: '#1e2024',
		border: '1px solid rgba(170, 199, 255, 0.1)',
		boxShadow: '0 12px 40px rgba(0, 0, 0, 0.32), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
		transform: 'translateY(-2px)'
	})
});

const PANEL: React.CSSProperties = {
	background: 'transparent',
	display: 'flex',
	flexDirection: 'column',
	overflow: 'hidden'
};

const DIVIDER: React.CSSProperties = {
	height: '1px',
	background: 'linear-gradient(90deg, rgba(170,199,255,0) 0%, rgba(170,199,255,0.08) 50%, rgba(170,199,255,0) 100%)',
	margin: '16px 0'
};

// ── Semantic colors — Stitch "Flight Briefing App" design tokens ───────────────
const C_GREEN = '#53e16f';
const C_YELLOW = '#ffb868';
const C_ORANGE = '#ffb868';
const C_BLUE = '#aac7ff';
const C_RED = '#ffb4ab';

const COLORS = {
	green:  { base: '#53e16f',  light: 'rgba(83, 225, 111, 0.15)', pale: 'rgba(83, 225, 111, 0.07)' },
	yellow: { base: '#ffb868',  light: 'rgba(255, 184, 104, 0.15)', pale: 'rgba(255, 184, 104, 0.07)' },
	orange: { base: '#ffb868',  light: 'rgba(255, 184, 104, 0.15)', pale: 'rgba(255, 184, 104, 0.07)' },
	blue:   { base: '#aac7ff',  light: 'rgba(170, 199, 255, 0.15)', pale: 'rgba(170, 199, 255, 0.07)' },
	red:    { base: '#ffb4ab',  light: 'rgba(255, 180, 171, 0.15)', pale: 'rgba(255, 180, 171, 0.07)' }
};

// ── Reusable Components ────────────────────────────────────────────────────────

interface StatusPillProps {
	label: string;
	color: 'green' | 'yellow' | 'orange' | 'blue' | 'red';
	size?: 'sm' | 'md';
}

function StatusPill({ label, color, size = 'md' }: StatusPillProps) {
	const col = COLORS[color];
	const sizeMap = {
		sm: { padding: '3px 10px', fontSize: '11px' },
		md: { padding: '6px 12px', fontSize: '12px' }
	};
	const sz = sizeMap[size];

	return (
		<span
			style={{
				display: 'inline-block',
				fontFamily: INTER,
				fontWeight: 600,
				color: col.base,
				background: col.pale,
				border: `1px solid ${col.light}`,
				borderRadius: '8px',
				...sz,
				whiteSpace: 'nowrap'
			}}
		>
			{label}
		</span>
	);
}

interface GlassCardProps {
	children: React.ReactNode;
	label?: string;
	variant?: 'default' | 'elevated';
	interactive?: boolean;
	onClick?: () => void;
	style?: React.CSSProperties;
}

function GlassCard({ children, label, variant = 'default', interactive = false, onClick, style }: GlassCardProps) {
	const [hovered, setHovered] = useState(false);
	const baseStyle = variant === 'elevated' ? CARD_ELEVATED : CARD;
	const cardStyle = interactive ? getCardHoverStyle(hovered) : baseStyle;

	return (
		<div
			style={{
				...cardStyle,
				...style,
				cursor: interactive ? 'pointer' : 'default'
			}}
			onMouseEnter={() => interactive && setHovered(true)}
			onMouseLeave={() => interactive && setHovered(false)}
			onClick={onClick}
		>
			{label && <div style={TYPE.LABEL}>{label}</div>}
			{children}
		</div>
	);
}

// ── Left Panel Helpers ──────────────────────────────────────────────────────────

const AIRCRAFT_CONTEXT: Record<string, string> = {
	A380: 'Double-deck widebody · One of the quietest long-haul cabins',
	A350: 'Lower cabin altitude · Wider seats · Modern widebody',
	'787': 'Lower cabin altitude · Higher humidity · Larger windows',
	'777': 'Very large twin-aisle · Strong performer on long routes',
	A330: 'Twin-aisle widebody · Common on medium to long-haul routes',
	A321: 'Stretched single-aisle · Used on longer narrowbody routes',
	A320: 'Narrow-body workhorse · Common on short to medium routes',
	'737': 'Short to medium-haul workhorse · Most common commercial jet',
	'757': 'Narrow-body with powerful engines · Thinner long-haul routes',
	E195: 'Regional jet · Comfortable 2-2 seating throughout',
	E190: 'Regional jet · Comfortable for shorter hops',
	E175: 'Regional jet · 2-2 cabin all the way back',
	CRJ: 'Regional jet · Compact cabin · Short regional routes'
};

function aircraftContext(typeName: string | null, model: string | null): string | null {
	const name = typeName || model;
	if (!name) return null;
	for (const [key, value] of Object.entries(AIRCRAFT_CONTEXT)) {
		if (name.includes(key)) return value;
	}
	return null;
}

function weatherDisplay(metar: MetarData | null): { icon: string; summary: string } | null {
	if (!metar) return null;

	// Determine icon
	let icon = '☀️';
	if (metar.raw?.includes('TS')) icon = '⛈️';
	else if (metar.raw?.includes('SN') || metar.clouds?.some((c) => c.repr?.includes('SN'))) icon = '🌨️';
	else if (metar.visibility?.value != null && metar.visibility.value < 1000) icon = '🌫️';
	else if (metar.flight_rules === 'LIFR') icon = '🌫️';
	else if (metar.flight_rules === 'IFR') icon = '🌧️';
	else if (metar.flight_rules === 'MVFR') icon = '🌥️';
	else {
		const clouds = metar.clouds || [];
		if (clouds.some((c) => c.type === 'OVC')) icon = '☁️';
		else if (clouds.some((c) => c.type === 'BKN')) icon = '🌥️';
		else if (clouds.some((c) => c.type === 'SCT')) icon = '⛅';
	}

	// Build summary: "16°C · Clear · Good visibility"
	const parts: string[] = [];

	// Temperature
	if (metar.temperature?.value != null) {
		parts.push(`${metar.temperature.value}°C`);
	}

	// Condition
	let condition = 'Clear';
	if (metar.flight_rules === 'LIFR') condition = 'Dense fog';
	else if (metar.flight_rules === 'IFR') condition = 'Low cloud';
	else if (metar.flight_rules === 'MVFR') condition = 'Hazy';
	else {
		const clouds = metar.clouds || [];
		if (clouds.some((c) => c.type === 'OVC')) condition = 'Overcast';
		else if (clouds.some((c) => c.type === 'BKN')) condition = 'Mostly cloudy';
		else if (clouds.some((c) => c.type === 'SCT')) condition = 'Partly cloudy';
	}
	parts.push(condition);

	// Visibility (only if not obvious)
	if (metar.visibility?.value != null && metar.visibility.value < 9000) {
		if (metar.visibility.value < 1000) parts.push('Low visibility');
		else if (metar.visibility.value < 5000) parts.push('Reduced visibility');
		else if (metar.visibility.value < 9000) parts.push('Good visibility');
	} else if (metar.visibility?.repr === 'CAVOK') {
		// CAVOK is implicit in "Clear", don't repeat
	}

	return { icon, summary: parts.join(' · ') };
}

function windLabel(speed: number | null): string {
	if (!speed || speed === 0) return 'Calm';
	if (speed <= 10) return 'Light winds';
	if (speed <= 20) return 'Moderate winds';
	if (speed <= 30) return 'Fresh winds';
	return 'Strong winds';
}

function visibilityColor(condition: string): string {
	if (condition === 'Very low visibility') return '#ffb4ab'; // Red - critical
	if (condition === 'Poor visibility') return '#FF9500'; // Orange - significant
	if (condition === 'Reduced visibility') return '#FFB84D'; // Light orange - marginal
	if (condition === 'Overcast') return '#9BA5B5'; // Gray
	if (condition === 'Mostly cloudy') return '#A8B4C4'; // Light gray
	if (condition === 'Partly cloudy') return '#B8C4D4'; // Lighter gray
	return '#6BA3FF'; // Blue - clear/good
}

function windColor(label: string): string {
	if (label === 'Calm') return '#53e16f'; // Green - calm
	if (label === 'Light winds') return '#6BA3FF'; // Blue - light
	if (label === 'Moderate winds') return '#FFB84D'; // Orange - moderate
	if (label === 'Fresh winds') return '#FF9500'; // Dark orange - fresh
	if (label === 'Strong winds') return '#ffb4ab'; // Red - strong
	return '#B8C4D4'; // Gray - unknown
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function WeatherCard({
	label,
	icaoCode,
	metar,
	narrativeText
}: {
	label: string;
	icaoCode: string;
	metar: MetarData | null;
	narrativeText: string;
}) {
	if (!metar)
		return (
			<div style={{ ...CARD, marginBottom: 0 }}>
				<div style={TYPE.LABEL}>{label}</div>
				<div style={{ ...TYPE.BODY, color: 'rgba(255,255,255,0.25)' }}>No data</div>
			</div>
		);

	const display = weatherDisplay(metar);

	return (
		<div style={{ ...CARD, marginBottom: 0, padding: '16px 18px' }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
				<div style={{ ...TYPE.LABEL, fontSize: '11px', letterSpacing: '0.08em' }}>{label}</div>
				<span style={{ ...TYPE.META, fontSize: '11px', letterSpacing: '0.08em' }}>{icaoCode}</span>
			</div>
			{display && (
				<div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
					<span style={{ fontSize: '28px', lineHeight: 1, flexShrink: 0, marginTop: '2px' }}>{display.icon}</span>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
						<div style={{ ...TYPE.PRIMARY_VALUE, fontSize: '16px', fontWeight: 600, letterSpacing: '-0.3px' }}>
							{display.summary.split(' · ')[0]}
						</div>
						<div style={{ ...TYPE.BODY, fontSize: '12px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.3 }}>
							{display.summary.split(' · ').slice(1).join(' · ')}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// ── Flight Summary Card ────────────────────────────────────────────────────────

function FlightSummaryCard({ data }: { data: PreflightData }) {
	const { flight, origin, destination, narrative } = data;
	const duration = flightDuration(flight.scheduledDeparture, flight.scheduledArrival);
	const delayText = flight.delayMinutes === 0 ? 'On Time' : `+${flight.delayMinutes} min`;
	const delayCol = flight.delayMinutes === 0 ? C_GREEN : C_ORANGE;
	const statusLabel_ = statusLabel(flight.status);
	const statusCol = statusColor(flight.status);

	return (
		<div
			className='absolute top-6 left-1/2 -translate-x-1/2 z-10 w-[680px]'
			style={{
				...GLASS_BASE,
				padding: '20px 40px',
				boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
				backdropFilter: 'blur(20px)',
				WebkitBackdropFilter: 'blur(20px)'
			}}
		>
			{/* Top row: Flight info + Route */}
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
				{/* Flight identifier */}
				<div>
					<div style={{ fontFamily: INTER, fontSize: '18px', fontWeight: 600, color: '#fff' }}>
						{flight.flightNumber.replace(' ', '')}
					</div>
					<div style={{ fontFamily: INTER, fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: '0px' }}>
						{flight.airline}
					</div>
				</div>

				{/* Route */}
				<div style={{ textAlign: 'right' }}>
					<div style={{ fontFamily: INTER, fontSize: '21px', fontWeight: 600, letterSpacing: '-0.6px', color: '#fff' }}>
						{airportName(origin)} → {airportName(destination)}
					</div>
				</div>
			</div>

			{/* Status details + Narrative row */}
			<div
				style={{
					display: 'flex',
					gap: '40px',
					alignItems: 'flex-start'
				}}
			>
				<div>
					<div
						style={{
							fontFamily: INTER,
							fontSize: '11px',
							color: 'rgba(255,255,255,0.4)',
							textTransform: 'uppercase',
							letterSpacing: '0.5px',
							marginBottom: '2px'
						}}
					>
						Status
					</div>
					<div style={{ fontFamily: INTER, fontSize: '13px', fontWeight: 500, color: statusCol }}>{statusLabel_}</div>
				</div>
				<div>
					<div
						style={{
							fontFamily: INTER,
							fontSize: '11px',
							color: 'rgba(255,255,255,0.4)',
							textTransform: 'uppercase',
							letterSpacing: '0.5px',
							marginBottom: '2px'
						}}
					>
						Duration
					</div>
					<div style={{ fontFamily: INTER, fontSize: '13px', fontWeight: 500, color: '#fff' }}>{duration}</div>
				</div>
				{flight.delayMinutes !== 0 && (
					<div>
						<div
							style={{
								fontFamily: INTER,
								fontSize: '11px',
								color: 'rgba(255,255,255,0.4)',
								textTransform: 'uppercase',
								letterSpacing: '0.5px',
								marginBottom: '2px'
							}}
						>
							Delay
						</div>
						<div style={{ fontFamily: INTER, fontSize: '13px', fontWeight: 500, color: delayCol }}>{delayText}</div>
					</div>
				)}
				{/* Narrative summary */}
				<div style={{ flex: 1 }}>
					<div
						style={{
							fontFamily: INTER,
							fontSize: '11px',
							color: 'rgba(255,255,255,0.4)',
							textTransform: 'uppercase',
							letterSpacing: '0.5px',
							marginBottom: '2px'
						}}
					>
						Summary
					</div>
					<p style={{ fontFamily: INTER, fontSize: '13px', color: '#fff', margin: 0, lineHeight: 1.4 }}>
						{narrative.summary}
					</p>
				</div>
			</div>
		</div>
	);
}

function TafCard({ taf, tz, landingTime }: { taf: TafData | null; tz: string | undefined; landingTime: string }) {
	if (!taf || !taf.forecast?.length)
		return (
			<div style={CARD}>
				<div style={TYPE.LABEL}>Arrival forecast</div>
				<div style={{ ...TYPE.BODY, color: 'rgba(255,255,255,0.25)' }}>No data</div>
			</div>
		);

	const landingDate = new Date(landingTime);

	// Collapse consecutive duplicate conditions, limit to 3 forecasts
	const uniqueForecast: Array<{
		p: TafForecast;
		hoursBeforeLanding: string;
		cond: string;
		wind: string;
		visColor: string;
		windCol: string;
	}> = [];
	for (let i = 0; i < taf.forecast.length && uniqueForecast.length < 3; i++) {
		const p = taf.forecast[i];
		const cond = tafCondition(p);
		const wind = windLabel(p.wind_speed?.value ?? null);
		const visColor = visibilityColor(cond);
		const windCol = windColor(wind);

		// Check if same as last entry
		const last = uniqueForecast[uniqueForecast.length - 1];
		if (last && last.cond === cond && last.wind === wind) {
			// Skip duplicate
			continue;
		}

		// Calculate hours before/after landing
		let hoursBeforeLanding = '—';
		if (p.start_time?.dt) {
			const forecastTime = new Date(p.start_time.dt);
			const hoursUntilForecast = (landingDate.getTime() - forecastTime.getTime()) / (1000 * 60 * 60);
			if (hoursUntilForecast !== 0) {
				const rounded = Math.round(hoursUntilForecast * 10) / 10;
				if (hoursUntilForecast > 0) {
					hoursBeforeLanding = rounded === 1 ? '1 hour' : `${rounded} hours`;
				} else {
					const afterRounded = Math.round(Math.abs(hoursUntilForecast) * 10) / 10;
					hoursBeforeLanding = afterRounded === 1 ? '1 hour after landing' : `${afterRounded} hours after landing`;
				}
			}
		}

		uniqueForecast.push({ p, hoursBeforeLanding, cond, wind, visColor, windCol });
	}

	return (
		<div style={CARD}>
			<div style={{ ...TYPE.LABEL, marginBottom: '12px' }}>Arrival forecast</div>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
				{uniqueForecast.map((item, i) => (
					<div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
						{uniqueForecast.length > 1 && (
							<span style={{ ...TYPE.META, fontSize: '10px' }}>
								{item.hoursBeforeLanding}
								{item.hoursBeforeLanding !== '—' && !item.hoursBeforeLanding.includes('after') ? ' before landing' : ''}
							</span>
						)}
						<div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
							<div style={{ flex: 1 }}>
								<div style={{ ...TYPE.BODY, color: item.visColor, lineHeight: 1.4 }}>{item.cond}</div>
							</div>
							<div style={{ flex: 1 }}>
								<div style={{ ...TYPE.BODY, color: item.windCol, lineHeight: 1.4 }}>{item.wind}</div>
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function LeftPanel({
	data,
	width = 280,
	onResizeStart
}: {
	data: PreflightData;
	width?: number;
	onResizeStart?: () => void;
}) {
	const { flight, aircraft, inbound, origin, destination, weather, narrative } = data;

	const depTime = flight.estimatedDeparture || flight.scheduledDeparture || '';
	const depIn = departsIn(depTime);

	return (
		<div
			style={{
				...PANEL,
				width: `${width}px`,
				flexShrink: 0,
				overflowY: 'auto',
				padding: '24px 20px',
				background: 'rgba(17, 19, 24, 0.6)',
				backdropFilter: 'blur(20px)',
				WebkitBackdropFilter: 'blur(20px)',
				borderRight: '1px solid rgba(255, 255, 255, 0.04)',
				position: 'relative',
				scrollbarWidth: 'none',
				msOverflowStyle: 'none'
			}}
			className=''
		>
			<div
				onMouseDown={onResizeStart}
				style={{
					position: 'absolute',
					right: 0,
					top: 0,
					bottom: 0,
					width: '4px',
					cursor: 'col-resize',
					background: 'transparent',
					transition: 'background-color 0.2s',
					zIndex: 10
				}}
				onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(59, 130, 246, 0.5)')}
				onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
			/>

			{/* Route */}
			<div style={{ ...CARD_ELEVATED, marginBottom: '12px' }}>
				{/* Flight ID row */}
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
					<span
						style={{
							fontFamily: INTER,
							fontSize: '11px',
							color: 'rgba(255,255,255,0.4)',
							letterSpacing: '0.08em',
							textTransform: 'uppercase'
						}}
					>
						{flight.airline}
					</span>
					<span
						style={{
							fontFamily: MONO,
							fontSize: '13px',
							fontWeight: 600,
							color: 'rgba(255,255,255,0.7)',
							letterSpacing: '0.5px'
						}}
					>
						{flight.flightNumber.replace(' ', '')}
					</span>
				</div>

				{/* Route with times */}
				<div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '14px' }}>
					<div style={{ flex: 1 }}>
						<div
							style={{
								fontFamily: INTER,
								fontSize: '18px',
								fontWeight: 600,
								color: '#fff',
								lineHeight: 1.1,
								marginBottom: '4px'
							}}
						>
							{cityName(origin)}
						</div>
						<div style={{ fontFamily: MONO, fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>
							{toLocalTime(flight.scheduledDeparture, origin.timezone)}
						</div>
					</div>

					<div style={{ color: 'rgba(255,255,255,0.25)', fontSize: '16px', paddingTop: '4px', flexShrink: 0 }}>→</div>

					<div style={{ flex: 1, textAlign: 'right' }}>
						<div
							style={{
								fontFamily: INTER,
								fontSize: '18px',
								fontWeight: 600,
								color: '#fff',
								lineHeight: 1.1,
								marginBottom: '4px'
							}}
						>
							{cityName(destination)}
						</div>
						<div style={{ fontFamily: MONO, fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>
							{(() => {
								const arrTime = toLocalTime(flight.scheduledArrival, destination.timezone);
								return arrTime === '—' ? 'TBD' : arrTime;
							})()}
						</div>
					</div>
				</div>

				<div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
					{/* Countdown — prominent */}
					{depIn && (
						<div
							style={{
								fontFamily: INTER,
								fontSize: '20px',
								fontWeight: 700,
								color: '#fff',
								marginBottom: '14px',
								letterSpacing: '-0.4px'
							}}
						>
							{depIn}
						</div>
					)}

					{/* Gate / Terminal pills */}
					{(flight.gate || flight.terminal) && (
						<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
							{flight.terminal && (
								<span
									style={{
										fontFamily: INTER,
										fontSize: '12px',
										fontWeight: 500,
										color: 'rgba(255,255,255,0.75)',
										background: 'rgba(255,255,255,0.08)',
										border: '1px solid rgba(255,255,255,0.12)',
										borderRadius: '10px',
										padding: '6px 12px',
										transition: 'all 0.2s ease'
									}}
								>
									Gate {flight.gate}
								</span>
							)}
							{flight.gate && (
								<span
									style={{
										fontFamily: INTER,
										fontSize: '12px',
										fontWeight: 500,
										color: 'rgba(255,255,255,0.75)',
										background: 'rgba(255,255,255,0.08)',
										border: '1px solid rgba(255,255,255,0.12)',
										borderRadius: '10px',
										padding: '6px 12px',
										transition: 'all 0.2s ease'
									}}
								>
									Terminal {flight.terminal}
								</span>
							)}
						</div>
					)}
				</div>
			</div>
			{/* Your flight card */}
			<div style={CARD}>
				<div style={{ ...TYPE.LABEL, marginBottom: '10px', marginTop: '4px' }}>Aircraft</div>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
					<div style={{ ...TYPE.PRIMARY_VALUE, fontSize: '16px', fontWeight: 600, letterSpacing: '-0.3px' }}>
						{aircraft?.typeName ?? flight.aircraftModel ?? 'Aircraft type unknown'}
					</div>
					{/* Aircraft context commented out for now */}
					{/* {(() => {
						const context = aircraftContext(aircraft?.typeName ?? null, flight.aircraftModel ?? null);
						return context ? (
							<div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', lineHeight: 1.4 }}>
								{context}
							</div>
						) : null;
					})()} */}
					<div
						style={{
							...TYPE.BODY,
							fontSize: '12px',
							color: aircraft?.registration ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)',
							fontStyle: aircraft?.registration ? 'normal' : 'italic'
						}}
					>
						{aircraft?.registration ? (
							<>
								{aircraft.registration}
								{aircraft.ageYears != null ? ` · ${aircraft.ageYears} years old` : ''}
							</>
						) : (
							'Tail number not assigned yet'
						)}
					</div>
				</div>
				{inbound && (
					<div
						style={{
							fontFamily: INTER,
							fontSize: '12px',
							color: 'rgba(255,255,255,0.4)',
							marginTop: '6px',
							paddingTop: '50px',
							borderTop: '1px solid rgba(255,255,255,0.06)'
						}}
					>
						Arriving from {airportName(origin)} as{' '}
						<span style={{ color: 'rgba(255,255,255,0.65)', fontFamily: MONO }}>
							{inbound.flightNumber.replace(' ', '')}
						</span>
						{inbound.delayMinutes > 0 ? (
							<span style={{ color: '#ffb4ab' }}> · {inbound.delayMinutes} min late</span>
						) : (
							<span style={{ color: '#53e16f' }}> · on time</span>
						)}
					</div>
				)}
			</div>
			{/* Weather — stacked vertically */}
			<div
				style={{
					...TYPE.LABEL,
					marginTop: '-4px',
					marginBottom: '12px',
					paddingBottom: '8px',
					borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
				}}
			>
				Weather
			</div>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '12px' }}>
				<WeatherCard
					label={origin.iata}
					icaoCode={origin.icao}
					metar={weather.originMetar}
					narrativeText={narrative.originWeather}
				/>
				<WeatherCard
					label={destination.iata}
					icaoCode={destination.icao}
					metar={weather.destMetar}
					narrativeText={narrative.destWeather}
				/>
			</div>
			<TafCard
				taf={weather.destTaf}
				tz={destination.timezone}
				landingTime={flight.estimatedArrival || flight.scheduledArrival}
			/>
		</div>
	);
}

// ── Map component ──────────────────────────────────────────────────────────────

function MapView({ data }: { data: PreflightData }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<mapboxgl.Map | null>(null);

	useEffect(() => {
		if (!containerRef.current || mapRef.current) return;

		const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
		if (!token) return;
		mapboxgl.accessToken = token;

		const { origin, destination, weather, flightPlan } = data;
		const map = new mapboxgl.Map({
			container: containerRef.current,
			style: 'mapbox://styles/mapbox/dark-v11',
			projection: 'globe',
			center: [(origin.lng + destination.lng) / 2, (origin.lat + destination.lat) / 2],
			zoom: 2,
			antialias: true
		});
		mapRef.current = map;

		map.on('style.load', () => {
			map.setFog({
				color: '#111318',
				'high-color': '#0c0e12',
				'space-color': '#111318',
				'horizon-blend': 0.04,
				'star-intensity': 0.6
			});

			// ── Route arc ──────────────────────────────────────────────────────────
			const planPoints = flightPlan && flightPlan.length >= 2 ? flightPlan : null;
			const wps: [number, number][] = planPoints
				? planPoints.map((wp) => [wp.lng, wp.lat])
				: gcWaypoints(origin.lat, origin.lng, destination.lat, destination.lng);
			const routeGeoJson: GeoJSON.Feature<GeoJSON.LineString> = {
				type: 'Feature',
				properties: {},
				geometry: { type: 'LineString', coordinates: wps }
			};

			map.addSource('route', { type: 'geojson', data: routeGeoJson });
			map.addLayer({
				id: 'route-line',
				type: 'line',
				source: 'route',
				paint: {
					'line-color': '#aac7ff',
					'line-width': 1.5,
					'line-dasharray': [3, 4],
					'line-opacity': 0.75
				}
			});

			// ── Flight plan unavailable label ──────────────────────────────────────
			// if (!planPoints) {
			// 	const midLng = (origin.lng + destination.lng) / 2;
			// 	const midLat = (origin.lat + destination.lat) / 2;
			// 	const labelGeoJson: GeoJSON.Feature<GeoJSON.Point> = {
			// 		type: 'Feature',
			// 		properties: { label: 'FLIGHT PLAN UNAVAILABLE' },
			// 		geometry: { type: 'Point', coordinates: [midLng, midLat] }
			// 	};
			// 	map.addSource('flight-plan-label', { type: 'geojson', data: labelGeoJson });
			// 	map.addLayer({
			// 		id: 'flight-plan-unavailable-label',
			// 		type: 'symbol',
			// 		source: 'flight-plan-label',
			// 		layout: {
			// 			'text-field': ['get', 'label'],
			// 			'text-font': ['DIN Pro Mono Medium', 'Arial Unicode MS Regular'],
			// 			'text-size': 10,
			// 			'text-anchor': 'center'
			// 		},
			// 		paint: {
			// 			'text-color': 'rgba(226, 75, 74, 0.6)',
			// 			'text-halo-color': '#111318',
			// 			'text-halo-width': 1.5
			// 		}
			// 	});
			// }

			// ── Airport markers ────────────────────────────────────────────────────
			const airports: GeoJSON.FeatureCollection = {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						properties: { label: origin.iata },
						geometry: { type: 'Point', coordinates: [origin.lng, origin.lat] }
					},
					{
						type: 'Feature',
						properties: { label: destination.iata },
						geometry: { type: 'Point', coordinates: [destination.lng, destination.lat] }
					}
				]
			};

			map.addSource('airports', { type: 'geojson', data: airports });
			map.addLayer({
				id: 'airport-dots',
				type: 'circle',
				source: 'airports',
				paint: {
					'circle-radius': 5,
					'circle-color': '#aac7ff',
					'circle-opacity': 0.9,
					'circle-stroke-width': 6,
					'circle-stroke-color': '#aac7ff',
					'circle-stroke-opacity': 0.15
				}
			});
			map.addLayer({
				id: 'airport-labels',
				type: 'symbol',
				source: 'airports',
				layout: {
					'text-field': ['get', 'label'],
					'text-font': ['DIN Pro Mono Medium', 'Arial Unicode MS Regular'],
					'text-size': 12,
					'text-anchor': 'bottom',
					'text-offset': [0, -0.8]
				},
				paint: {
					'text-color': '#aac7ff',
					'text-halo-color': '#111318',
					'text-halo-width': 2
				}
			});

			// ── Airspace ──────────────────────────────────────────────────────────
			const airspaceFeatures: GeoJSON.Feature[] = data.airspace
				.filter((a) => a.geometry)
				.map((a) => ({
					type: 'Feature' as const,
					properties: { name: a.name },
					geometry: a.geometry
				}));

			if (airspaceFeatures.length > 0) {
				map.addSource('airspace', {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: airspaceFeatures }
				});
				map.addLayer({
					id: 'airspace-border',
					type: 'line',
					source: 'airspace',
					paint: {
						'line-color': '#9b59b6',
						'line-width': 0.5,
						'line-opacity': 0.2
					}
				});
			}

			// ── Fit bounds ────────────────────────────────────────────────────────
			const bounds = new mapboxgl.LngLatBounds(
				[Math.min(origin.lng, destination.lng) - 4, Math.min(origin.lat, destination.lat) - 4],
				[Math.max(origin.lng, destination.lng) + 4, Math.max(origin.lat, destination.lat) + 4]
			);
			map.fitBounds(bounds, { padding: 80, duration: 1800 });
		});

		return () => {
			map.remove();
			mapRef.current = null;
		};
	}, [data]);

	const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

	if (!token)
		return (
			<div
				style={{
					width: '100%',
					height: '100%',
					background: '#111318',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center'
				}}
			>
				<span style={{ fontFamily: MONO, fontSize: '12px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em' }}>
					NEXT_PUBLIC_MAPBOX_TOKEN not set
				</span>
			</div>
		);

	return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

// ── Right panel helpers ────────────────────────────────────────────────────────

function regionFromCoords(lat: number, lon: number): string {
	if (lon >= -60 && lon <= -10 && lat >= 25 && lat <= 70) return 'over the Atlantic';
	if ((lon >= 140 || lon <= -120) && lat >= 0 && lat <= 70) return 'over the Pacific';
	if (lon >= 20 && lon <= 50 && lat >= 40 && lat <= 70) return 'Eastern Europe';
	if (lon >= -10 && lon <= 20 && lat >= 35 && lat <= 70) return 'Western Europe';
	if (lon >= -90 && lon <= -60 && lat >= 25 && lat <= 60) return 'Eastern North America';
	if (lon >= -130 && lon <= -90 && lat >= 25 && lat <= 60) return 'Western North America';
	if (lon >= 30 && lon <= 60 && lat >= 10 && lat <= 40) return 'the Middle East';
	if (lon >= 60 && lon <= 140 && lat >= 10 && lat <= 70) return 'Asia';
	if (lon >= -20 && lon <= 50 && lat >= -35 && lat <= 25) return 'Africa';
	if (lon >= -90 && lon <= -30 && lat >= -60 && lat <= 15) return 'South America';
	return 'the region';
}

function tbIntensityLabel(intensity: string | null): string {
	if (!intensity) return 'Unknown';
	const i = intensity.toUpperCase();
	if (i.includes('EXTM')) return 'Extreme';
	if (i.includes('SEV') && i.includes('MOD')) return 'Moderate to Severe';
	if (i.includes('SEV')) return 'Severe';
	if (i.includes('MOD') && i.includes('LGT')) return 'Light to Moderate';
	if (i.includes('MOD')) return 'Moderate';
	if (i.includes('LGT')) return 'Light';
	if (i.includes('NEG') || i.includes('NONE')) return 'None';
	return intensity;
}

function tbSeverityRank(intensity: string | null): number {
	if (!intensity) return 0;
	const i = intensity.toUpperCase();
	if (i.includes('EXTM')) return 5;
	if (i.includes('SEV')) return 4;
	if (i.includes('MOD')) return 3;
	if (i.includes('LGT')) return 2;
	return 1;
}

function gcDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

function pirepRouteProgressPct(pirep: Pirep, origin: Airport, destination: Airport): number {
	const total = gcDistanceKm(origin.lat, origin.lng, destination.lat, destination.lng);
	if (total === 0) return 0;
	const fromOrigin = gcDistanceKm(origin.lat, origin.lng, pirep.lat, pirep.lon);
	return Math.min(1, Math.max(0, fromOrigin / total));
}

function sigmetHazardLabel(hazard: string): string {
	const h = hazard.toUpperCase();
	if (h.includes('CONVECTIVE') || h.includes('TS')) return 'Thunderstorms';
	if (h.includes('TURB')) return 'Turbulence';
	if (h.includes('ICE') || h.includes('ICG') || h.includes('FZRA')) return 'Icing';
	if (h.includes('VA') || h.includes('VOLCANIC')) return 'Volcanic Ash';
	if (h.includes('DUST') || h.includes('SAND')) return 'Dust/Sand Storm';
	return hazard;
}

function sigmetPlainEnglish(hazard: string): string {
	const h = hazard.toUpperCase();
	if (h.includes('CONVECTIVE') || h.includes('TS')) return 'Thunderstorm activity near your route';
	if (h.includes('TURB')) return 'Turbulence zone reported';
	if (h.includes('ICE') || h.includes('ICG') || h.includes('FZRA')) return 'Icing conditions reported';
	if (h.includes('IFR') || h.includes('LIFR') || h.includes('MVFR')) return 'Low visibility conditions';
	return 'Weather advisory near your route';
}

function sigmetNearAirport(sigmet: Sigmet, airport: Airport): boolean {
	for (const coord of sigmet.coords) {
		if (gcDistanceKm(coord.lat, coord.lon, airport.lat, airport.lng) < 300) return true;
	}
	return false;
}

function windDirectionLabel(deg: number): string {
	const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
	return dirs[Math.round(deg / 22.5) % 16];
}

function pressureToAltFt(hpa: number): number {
	if (hpa === 200) return 38600;
	if (hpa === 250) return 34000;
	if (hpa === 300) return 30000;
	return Math.round((1 - Math.pow(hpa / 1013.25, 0.190284)) * 145366.45);
}

function jetImpactLabel(avgTailwind: number): string {
	if (avgTailwind > 20) return 'Strong tailwind — flight may arrive early';
	if (avgTailwind >= 5) return 'Tailwind — slight arrival boost';
	if (avgTailwind > -5) return 'Crosswind — minimal time impact';
	if (avgTailwind >= -20) return 'Headwind — expect longer flight';
	return 'Strong headwind — possible delay';
}

// ── Chevron icon ───────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
	return (
		<motion.svg
			animate={{ rotate: open ? 180 : 0 }}
			transition={{ duration: 0.2 }}
			width='14'
			height='14'
			viewBox='0 0 14 14'
			fill='none'
			style={{ flexShrink: 0 }}
		>
			<path
				d='M3 5L7 9L11 5'
				stroke='rgba(255,255,255,0.35)'
				strokeWidth='1.5'
				strokeLinecap='round'
				strokeLinejoin='round'
			/>
		</motion.svg>
	);
}

// ── Expandable card ────────────────────────────────────────────────────────────

function ExpandableCard({
	label,
	badge,
	children,
	style,
	isExpanded,
	onToggle
}: {
	label: string;
	badge: React.ReactNode;
	children: React.ReactNode;
	style?: React.CSSProperties;
	isExpanded?: boolean;
	onToggle?: () => void;
}) {
	const open = isExpanded ?? false;
	const handleClick = onToggle ? () => onToggle() : () => {};

	return (
		<div
			style={{
				...CARD,
				marginBottom: 0,
				cursor: 'pointer',
				userSelect: 'none',
				display: 'flex',
				flexDirection: 'column',
				...style
			}}
			onClick={handleClick}
		>
			<div style={{ display: 'flex', flexDirection: 'column' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<span style={{ ...TYPE.LABEL, flex: 1 }}>{label}</span>
					<ChevronIcon open={open} />
				</div>
				<div style={{ marginTop: '10px', height: '28px', display: 'flex', alignItems: 'center' }}>{badge}</div>
			</div>
			<AnimatePresence initial={false}>
				{open && (
					<motion.div
						key='expanded'
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: 'auto', opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
						style={{ overflow: 'hidden' }}
						onClick={(e) => e.stopPropagation()}
					>
						<div style={{ paddingTop: '14px' }}>{children}</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

// ── Right panel ────────────────────────────────────────────────────────────────

function RightPanel({
	data,
	width = 300,
	onResizeStart
}: {
	data: PreflightData;
	width?: number;
	onResizeStart?: () => void;
}) {
	const { weather, atmosphere, flight, narrative, origin, destination, delays } = data;
	const inbound = data.inbound;

	// Delay risk
	const delayRiskColor = flight.delayMinutes > 30 ? C_RED : flight.delayMinutes > 0 ? C_ORANGE : C_GREEN;
	const delayRiskLabel = flight.delayMinutes > 30 ? 'High' : flight.delayMinutes > 0 ? 'Elevated' : 'Low';
	const delayRiskPillColor: 'red' | 'orange' | 'green' =
		delayRiskColor === C_RED ? 'red' : delayRiskColor === C_ORANGE ? 'orange' : 'green';

	function airportDelayText(d: AirportDelays): string {
		if (d.avgDelayMinutes < 10) return 'typically on time';
		if (d.avgDelayMinutes <= 20) return `averages ~${Math.round(d.avgDelayMinutes)} min delay`;
		return `frequently delays ~${Math.round(d.avgDelayMinutes)} min — build in buffer`;
	}

	// Turbulence
	const turbulenceLabel = (() => {
		const n = narrative.turbulence.toLowerCase();
		if (n.includes('severe')) return 'Rough';
		if (n.includes('moderate') || n.includes('bumps')) return 'Moderate bumps';
		if (n.includes('light')) return 'Light bumps';
		return 'Smooth';
	})();
	const turbulenceColor = (() => {
		const n = narrative.turbulence.toLowerCase();
		if (n.includes('severe')) return C_RED;
		if (n.includes('moderate')) return C_ORANGE;
		if (n.includes('light')) return C_YELLOW;
		return C_GREEN;
	})();
	const turbPillColor: 'red' | 'yellow' | 'green' =
		turbulenceColor === C_RED
			? 'red'
			: turbulenceColor === C_YELLOW
				? 'yellow'
				: 'green';

	// Jet stream
	const avgJetSpeed = (() => {
		const levels = atmosphere.routeWinds
			.map((w) => w.levels.find((l) => l.pressureHpa === 250))
			.filter((l): l is WindLevel => l != null);
		return levels.length ? Math.round(levels.reduce((s, l) => s + l.speedKt, 0) / levels.length) : null;
	})();
	const jetLabel =
		avgJetSpeed == null ? 'No data' : avgJetSpeed < 50 ? 'Weak' : avgJetSpeed < 80 ? 'Moderate' : 'Strong';

	// PIREPs sorted by severity
	const relevantPireps = [...weather.pireps]
		.filter((p) => p.tbInt1)
		.sort((a, b) => tbSeverityRank(b.tbInt1) - tbSeverityRank(a.tbInt1));

	// Flight duration in minutes
	const durationMin = (() => {
		const d = parseUtc(flight.scheduledDeparture),
			a = parseUtc(flight.scheduledArrival);
		if (!d || !a || isNaN(d.getTime()) || isNaN(a.getTime())) return 0;
		return Math.round((a.getTime() - d.getTime()) / 60000);
	})();

	// Flight Time Impact — tailwind component at cruise levels (FL340=250hPa, FL380=200hPa)
	const flightTimeImpact = (() => {
		const toRad = (d: number) => (d * Math.PI) / 180;
		const lat1 = toRad(origin.lat),
			lon1 = toRad(origin.lng);
		const lat2 = toRad(destination.lat),
			lon2 = toRad(destination.lng);
		const dLon = lon2 - lon1;
		const bearing =
			((Math.atan2(
				Math.sin(dLon) * Math.cos(lat2),
				Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
			) *
				180) /
				Math.PI +
				360) %
			360;

		const levelsAt250 = atmosphere.routeWinds
			.map((w) => w.levels.find((l) => l.pressureHpa === 250))
			.filter((l): l is WindLevel => l != null);
		const levelsAt200 = atmosphere.routeWinds
			.map((w) => w.levels.find((l) => l.pressureHpa === 200))
			.filter((l): l is WindLevel => l != null);
		const levels = levelsAt250.length >= levelsAt200.length ? levelsAt250 : levelsAt200;

		if (levels.length === 0) return null;

		// Wind direction is FROM — tailwind = -cos(windDir - bearing) * speed
		const avgTailwind =
			levels.reduce((sum, l) => sum + -Math.cos(toRad(l.directionDeg - bearing)) * l.speedKt, 0) / levels.length;

		const deltaMin = durationMin > 0 ? (avgTailwind / 480) * durationMin : 0;
		const rounded = Math.round(deltaMin / 5) * 5;
		return { rounded, avgTailwind };
	})();

	// SIGMETs near origin
	const originSigmets = weather.sigmets.filter((s) => sigmetNearAirport(s, origin));

	// Shared text styles (all Inter for expanded content)
	const T = {
		sectionLabel: {
			fontFamily: INTER,
			fontSize: '11px',
			fontWeight: 600,
			color: 'rgba(255,255,255,0.3)',
			textTransform: 'uppercase' as const,
			letterSpacing: '0.1em',
			marginBottom: '10px'
		},
		value: { fontFamily: INTER, fontSize: '16px', fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.3 },
		sub: { fontFamily: INTER, fontSize: '13px', fontWeight: 400, color: 'rgba(255,255,255,0.45)', lineHeight: 1.4 },
		accent: (color: string) => ({ fontFamily: INTER, fontSize: '14px', fontWeight: 600, color, lineHeight: 1.3 }),
		impact: {
			fontFamily: INTER,
			fontSize: '13px',
			fontWeight: 400,
			color: 'rgba(255,255,255,0.55)',
			lineHeight: 1.5,
			marginTop: '3px'
		}
	};

	// Expandable card state — only one can be open at a time
	const [expandedCardIndex, setExpandedCardIndex] = useState<number | null>(null);

	const handleCardToggle = (index: number) => {
		setExpandedCardIndex(expandedCardIndex === index ? null : index);
	};

	return (
		<div
			style={{
				...PANEL,
				width: `${width}px`,
				flexShrink: 0,
				overflow: 'hidden',
				padding: '24px 20px 16px',
				background: 'rgba(17, 19, 24, 0.6)',
				backdropFilter: 'blur(20px)',
				WebkitBackdropFilter: 'blur(20px)',
				borderLeft: '1px solid rgba(255, 255, 255, 0.04)',
				position: 'relative',
				boxSizing: 'border-box'
			}}
		>
			<div
				onMouseDown={onResizeStart}
				style={{
					position: 'absolute',
					left: 0,
					top: 0,
					bottom: 0,
					width: '4px',
					cursor: 'col-resize',
					background: 'transparent',
					transition: 'background-color 0.2s',
					zIndex: 10
				}}
				onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(59, 130, 246, 0.5)')}
				onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
			/>

			{/* Header */}
			<div
				style={{
					...TYPE.LABEL,
					flexShrink: 0,
					marginBottom: '14px',
					paddingBottom: '8px',
					borderBottom: '1px solid rgba(255,255,255,0.06)'
				}}
			>
				Route Outlook
			</div>

			{/* Expandable cards — take 60% of space by default */}
			<div
				style={{
					flex: expandedCardIndex === null ? 3 : 1,
					display: 'flex',
					flexDirection: 'column',
					gap: '8px',
					minHeight: 0,
					overflowY: 'auto',
					scrollbarWidth: 'thin',
					scrollbarColor: 'rgba(255,255,255,0.15) transparent',
					transition: 'flex 0.3s ease'
				}}
			>
				{/* Delay Risk */}
				<ExpandableCard
					label='Delay Risk'
					badge={<StatusPill label={delayRiskLabel} color={delayRiskPillColor} size='sm' />}
					isExpanded={expandedCardIndex === 0}
					onToggle={() => handleCardToggle(0)}
					style={{ flex: expandedCardIndex === 0 ? 1 : 0, minHeight: 85 }}
				>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
						{/* Current flight status */}
						<div>
							<div style={T.sectionLabel}>Current status</div>
							<div style={{ fontFamily: INTER, fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>
								{flight.delayMinutes === 0
									? 'Flight on schedule — no current delays'
									: flight.delayMinutes === 1
										? 'Flight delayed 1 minute'
										: `Flight delayed ${flight.delayMinutes} minutes`}
							</div>
						</div>

						{/* Inbound aircraft */}
						<div>
							<div style={T.sectionLabel}>Inbound aircraft</div>
							{inbound ? (
								<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
									<div
										style={{
											display: 'flex',
											justifyContent: 'space-between',
											alignItems: 'baseline'
										}}
									>
										<span
											style={{ fontFamily: INTER, fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}
										>
											{inbound.flightNumber.replace(' ', '')}
										</span>
										<span style={{ fontFamily: INTER, fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
											{inbound.origin.iata} → {inbound.destination.iata}
										</span>
									</div>
									<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
										<span
											style={{
												fontFamily: INTER,
												fontSize: '12px',
												fontWeight: 500,
												color: statusColor(inbound.status)
											}}
										>
											{statusLabel(inbound.status)}
										</span>
										<span
											style={{
												fontFamily: INTER,
												fontSize: '12px',
												fontWeight: 500,
												color: inbound.delayMinutes > 0 ? C_ORANGE : C_GREEN
											}}
										>
											{inbound.delayMinutes === 0
												? 'On time'
												: inbound.delayMinutes === 1
													? '1 min late'
													: `${inbound.delayMinutes} min late`}
										</span>
									</div>
								</div>
							) : (
								<div style={{ fontFamily: INTER, fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>
									No inbound leg found
								</div>
							)}
						</div>

						{/* SIGMETs */}
						{originSigmets.length > 0 && (
							<div>
								<div style={T.sectionLabel}>SIGMETs near {origin.iata}</div>
								<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
									{originSigmets.map((s, i) => (
										<div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
											<div style={{ width: 3, height: 16, borderRadius: 2, background: C_ORANGE, flexShrink: 0 }} />
											<span style={{ fontFamily: INTER, fontSize: '13px', color: C_ORANGE }}>
												{sigmetHazardLabel(s.hazard)}
											</span>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Airport delays */}
						{(delays?.origin || delays?.destination) && (
							<div>
								<div style={T.sectionLabel}>Airport conditions</div>
								<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
									{delays.origin && (
										<div style={{ display: 'flex', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
											<span>{origin.iata}</span>
											<span>{airportDelayText(delays.origin)}</span>
										</div>
									)}
									{delays.destination && (
										<div style={{ display: 'flex', gap: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
											<span>{destination.iata}</span>
											<span>{airportDelayText(delays.destination)}</span>
										</div>
									)}
								</div>
							</div>
						)}
					</div>
				</ExpandableCard>

				{/* Turbulence */}
				<ExpandableCard
					label='Turbulence'
					badge={<StatusPill label={turbulenceLabel} color={turbPillColor} size='sm' />}
					isExpanded={expandedCardIndex === 1}
					onToggle={() => handleCardToggle(1)}
					style={{ flex: expandedCardIndex === 1 ? 1 : 0, minHeight: 85 }}
				>
					{relevantPireps.length === 0 ? (
						<p
							style={{
								fontFamily: INTER,
								fontSize: '13px',
								color: 'rgba(255,255,255,0.35)',
								lineHeight: 1.5,
								margin: 0
							}}
						>
							No PIREP reports along this route.
						</p>
					) : (
						<div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
							{relevantPireps.slice(0, 6).map((p, i) => {
								const pct = pirepRouteProgressPct(p, origin, destination);
								const hourEst = durationMin > 0 ? Math.round((pct * durationMin) / 60) : null;
								return (
									<div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
										<div
											style={{
												width: 3,
												borderRadius: 2,
												background: tbColor(p.tbInt1),
												alignSelf: 'stretch',
												flexShrink: 0,
												minHeight: 14
											}}
										/>
										<div style={{ flex: 1, minWidth: 0 }}>
											<div
												style={{
													display: 'flex',
													justifyContent: 'space-between',
													alignItems: 'center',
													marginBottom: '3px'
												}}
											>
												<span style={T.accent(tbColor(p.tbInt1))}>{tbIntensityLabel(p.tbInt1)}</span>
												{p.fltLvl != null && (
													<span style={{ fontFamily: INTER, fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>
														FL{p.fltLvl}
													</span>
												)}
											</div>
											<div style={T.sub}>{regionFromCoords(p.lat, p.lon)}</div>
											{hourEst != null && (
												<div
													style={{
														fontFamily: INTER,
														fontSize: '12px',
														color: 'rgba(255,255,255,0.35)',
														marginTop: '2px'
													}}
												>
													Expect bumps around hour {hourEst}
												</div>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</ExpandableCard>

				{/* Jet Stream */}
				<ExpandableCard
					label='Jet Stream'
					badge={<StatusPill label={jetLabel} color='blue' size='sm' />}
					isExpanded={expandedCardIndex === 2}
					onToggle={() => handleCardToggle(2)}
					style={{ flex: expandedCardIndex === 2 ? 1 : 0, minHeight: 85 }}
				>
					{atmosphere.routeWinds.length === 0 ? (
						<p
							style={{
								fontFamily: INTER,
								fontSize: '13px',
								color: 'rgba(255,255,255,0.35)',
								lineHeight: 1.5,
								margin: 0
							}}
						>
							No wind data available.
						</p>
					) : (
						<div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
							{([200, 250, 300] as number[]).map((hpa) => {
								const toRad = (d: number) => (d * Math.PI) / 180;
								const lat1 = toRad(origin.lat),
									lon1 = toRad(origin.lng);
								const lat2 = toRad(destination.lat),
									lon2 = toRad(destination.lng);
								const dLon = lon2 - lon1;
								const bearing =
									((Math.atan2(
										Math.sin(dLon) * Math.cos(lat2),
										Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
									) *
										180) /
										Math.PI +
										360) %
									360;

								const levels = atmosphere.routeWinds
									.map((w) => w.levels.find((l) => l.pressureHpa === hpa))
									.filter((l): l is WindLevel => l != null);
								if (levels.length === 0) return null;
								const avgSpeed = Math.round(levels.reduce((s, l) => s + l.speedKt, 0) / levels.length);
								const avgDir = Math.round(levels.reduce((s, l) => s + l.directionDeg, 0) / levels.length);
								const altFt = pressureToAltFt(hpa);
								const avgTailwind =
									levels.reduce((sum, l) => sum + -Math.cos(toRad(l.directionDeg - bearing)) * l.speedKt, 0) /
									levels.length;
								const impact = jetImpactLabel(avgTailwind);
								return (
									<div key={hpa} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
										<div
											style={{
												width: 3,
												borderRadius: 2,
												background: 'rgba(59,130,246,0.5)',
												alignSelf: 'stretch',
												flexShrink: 0,
												minHeight: 14
											}}
										/>
										<div style={{ flex: 1, minWidth: 0 }}>
											<div
												style={{
													display: 'flex',
													justifyContent: 'space-between',
													alignItems: 'center',
													marginBottom: '3px'
												}}
											>
												<span
													style={{
														fontFamily: INTER,
														fontSize: '13px',
														fontWeight: 600,
														color: 'rgba(255,255,255,0.85)'
													}}
												>
													{avgSpeed} kt {windDirectionLabel(avgDir)}
												</span>
												<span style={{ fontFamily: INTER, fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
													{Math.round(altFt / 100) * 100} ft
												</span>
											</div>
											<div style={T.sub}>{hpa} hPa</div>
											<div style={T.impact}>{impact}</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</ExpandableCard>

				{/* Flight Time Impact */}
				<ExpandableCard
					label='Flight Time Impact'
					badge={
						flightTimeImpact == null || Math.abs(flightTimeImpact.rounded) < 5 ? (
							<span
								style={{
									display: 'inline-block',
									fontFamily: INTER,
									fontWeight: 600,
									fontSize: '11px',
									color: 'rgba(255,255,255,0.6)',
									background: 'rgba(255,255,255,0.08)',
									border: '1px solid rgba(255,255,255,0.15)',
									borderRadius: '8px',
									padding: '3px 10px',
									whiteSpace: 'nowrap'
								}}
							>
								On schedule
							</span>
						) : flightTimeImpact.rounded > 0 ? (
							<span
								style={{
									display: 'inline-block',
									fontFamily: INTER,
									fontWeight: 600,
									fontSize: '11px',
									color: '#22c55e',
									background: 'rgba(34,197,94,0.12)',
									border: '1px solid rgba(34,197,94,0.25)',
									borderRadius: '8px',
									padding: '3px 10px',
									whiteSpace: 'nowrap'
								}}
							>
								~{flightTimeImpact.rounded} min faster
							</span>
						) : (
							<span
								style={{
									display: 'inline-block',
									fontFamily: INTER,
									fontWeight: 600,
									fontSize: '11px',
									color: '#f97316',
									background: 'rgba(249,115,22,0.12)',
									border: '1px solid rgba(249,115,22,0.25)',
									borderRadius: '8px',
									padding: '3px 10px',
									whiteSpace: 'nowrap'
								}}
							>
								~{Math.abs(flightTimeImpact.rounded)} min longer
							</span>
						)
					}
					isExpanded={expandedCardIndex === 3}
					onToggle={() => handleCardToggle(3)}
					style={{ flex: expandedCardIndex === 3 ? 1 : 0, minHeight: 85 }}
				>
					<p
						style={{
							fontFamily: INTER,
							fontSize: '13px',
							color: 'rgba(255,255,255,0.45)',
							lineHeight: 1.5,
							margin: 0
						}}
					>
						{flightTimeImpact == null || Math.abs(flightTimeImpact.rounded) < 5
							? 'Winds are roughly balanced — flight time should match schedule'
							: flightTimeImpact.rounded > 0
								? 'Strong tailwinds at cruise altitude — expect an early arrival'
								: 'Headwinds at cruise altitude today — captain may adjust to find smoother air'}
					</p>
				</ExpandableCard>

				{/* Weather Alerts */}
				<ExpandableCard
					label='Weather Alerts'
					badge={
						weather.sigmets.length === 0 ? (
							<StatusPill label='Clear' color='green' size='sm' />
						) : (
							<StatusPill
								label={`${weather.sigmets.length} alert${weather.sigmets.length !== 1 ? 's' : ''}`}
								color='orange'
								size='sm'
							/>
						)
					}
					isExpanded={expandedCardIndex === 4}
					onToggle={() => handleCardToggle(4)}
					style={{ flex: expandedCardIndex === 4 ? 1 : 0, minHeight: 95 }}
				>
					{weather.sigmets.length === 0 ? (
						<p
							style={{
								fontFamily: INTER,
								fontSize: '13px',
								color: 'rgba(255,255,255,0.35)',
								lineHeight: 1.5,
								margin: 0
							}}
						>
							No active weather alerts along the route.
						</p>
					) : (
						<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
							{weather.sigmets.map((s, i) => {
								const alertTiming = (() => {
									const depTime = parseUtc(flight.scheduledDeparture);
									if (!depTime || !s.validTimeTo) return null;
									const depTimeUnix = depTime.getTime() / 1000;
									const minutesFromDep = (s.validTimeTo - depTimeUnix) / 60;
									if (minutesFromDep < 0) return 'before departure';
									if (durationMin > 0 && minutesFromDep > durationMin) return 'after landing';
									const hoursIntoFlight = Math.round(minutesFromDep / 60);
									return `${hoursIntoFlight} hour${hoursIntoFlight === 1 ? '' : 's'} into your flight`;
								})();
								return (
									<div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
										<div
											style={{
												width: 3,
												height: 14,
												borderRadius: 2,
												background: C_ORANGE,
												flexShrink: 0,
												marginTop: '2px'
											}}
										/>
										<span
											style={{ fontFamily: INTER, fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}
										>
											{sigmetPlainEnglish(s.hazard)}
											{alertTiming && (
												<span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400 }}> — {alertTiming}</span>
											)}
										</span>
									</div>
								);
							})}
						</div>
					)}
				</ExpandableCard>
			</div>

			{/* Atmosphere chart — at bottom, takes 40% of space by default */}
			{atmosphere.routeWinds.length > 0 && (
				<div
					style={{
						flex: expandedCardIndex === null ? 2 : 0,
						display: 'flex',
						flexDirection: 'column',
						minHeight: 0,
						marginTop: '14px',
						transition: 'flex 0.3s ease'
					}}
				>
					<div
						style={{
							fontFamily: INTER,
							fontSize: '10px',
							fontWeight: 600,
							color: 'rgba(255,255,255,0.3)',
							textTransform: 'uppercase',
							letterSpacing: '0.1em',
							marginBottom: '6px',
							flexShrink: 0
						}}
					>
						Wind at altitude
					</div>
					<div
						style={{
							flex: 1,
							minHeight: 120,
							...CARD,
							padding: 0,
							overflow: 'hidden',
							marginBottom: 0
						}}
					>
						<AtmosphereView
							routeWinds={atmosphere.routeWinds}
							originIata={data.origin.iata}
							destIata={data.destination.iata}
						/>
					</div>
				</div>
			)}
		</div>
	);
}

// ── Loading screen ─────────────────────────────────────────────────────────────

const LOADING_MESSAGES = [
	'Fetching flight data…',
	'Loading aircraft info…',
	'Checking weather conditions…',
	'Retrieving route information…',
	'Analyzing altitude data…',
	'Gathering atmosphere metrics…',
	'Preparing flight details…',
	'Synchronizing flight data…',
	'Loading performance metrics…',
	'Fetching navigation data…'
];

function StarCanvas() {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d')!;

		const setSize = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
		};
		setSize();
		window.addEventListener('resize', setSize);

		const stars = Array.from({ length: 160 }, () => ({
			x: Math.random() * window.innerWidth,
			y: Math.random() * window.innerHeight,
			r: Math.random() * 0.85 + 0.15,
			alpha: Math.random() * 0.75 + 0.1,
			phase: Math.random() * Math.PI * 2,
			freq: Math.random() * 0.008 + 0.003
		}));

		const bright = Array.from({ length: 12 }, () => ({
			x: Math.random() * window.innerWidth,
			y: Math.random() * window.innerHeight,
			r: Math.random() * 1.2 + 0.8,
			alpha: Math.random() * 0.5 + 0.4,
			phase: Math.random() * Math.PI * 2,
			freq: Math.random() * 0.005 + 0.002
		}));

		let frame: number;
		let t = 0;

		const tick = () => {
			t++;
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			for (const s of stars) {
				const a = s.alpha * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.phase + t * s.freq)));
				ctx.beginPath();
				ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
				ctx.fill();
			}

			for (const s of bright) {
				const a = s.alpha * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(s.phase + t * s.freq)));
				const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4);
				grad.addColorStop(0, `rgba(180,210,255,${a.toFixed(3)})`);
				grad.addColorStop(1, 'rgba(180,210,255,0)');
				ctx.beginPath();
				ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
				ctx.fillStyle = grad;
				ctx.fill();

				ctx.beginPath();
				ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(220,235,255,${a.toFixed(3)})`;
				ctx.fill();
			}

			frame = requestAnimationFrame(tick);
		};
		tick();

		return () => {
			window.removeEventListener('resize', setSize);
			cancelAnimationFrame(frame);
		};
	}, []);

	return (
		<canvas
			ref={ref}
			style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
		/>
	);
}

function LoadingScreen({ flightNumber }: { flightNumber: string }) {
	const [msgIdx, setMsgIdx] = useState(0);

	useEffect(() => {
		setMsgIdx(Math.floor(Math.random() * LOADING_MESSAGES.length));
		const id = setInterval(() => setMsgIdx((i) => (i + 1) % LOADING_MESSAGES.length), 2800);
		return () => clearInterval(id);
	}, []);

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.25 }}
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 1000,
				background: '#111318',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 28
			}}
		>
			<StarCanvas />

			<motion.div
				animate={{ rotate: 360 }}
				transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
				style={{
					width: 44,
					height: 44,
					borderRadius: '50%',
					border: '1.5px solid rgba(170,199,255,0.12)',
					borderTopColor: 'rgba(170,199,255,0.8)',
					position: 'relative',
					zIndex: 1
				}}
			/>

			<div
				style={{
					fontFamily: INTER,
					fontSize: 26,
					fontWeight: 600,
					letterSpacing: '0.1em',
					color: 'rgba(255,255,255,0.88)',
					position: 'relative',
					zIndex: 1
				}}
			>
				{flightNumber}
			</div>

			<AnimatePresence mode='wait'>
				<motion.div
					key={msgIdx}
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -6 }}
					transition={{ duration: 0.28, ease: 'easeOut' }}
					style={{
						fontFamily: INTER,
						fontSize: 10,
						letterSpacing: '0.12em',
						color: 'rgba(255,255,255,0.55)',
						textTransform: 'uppercase',
						position: 'relative',
						zIndex: 1
					}}
				>
					{LOADING_MESSAGES[msgIdx]}
				</motion.div>
			</AnimatePresence>

			<div
				style={{
					position: 'absolute',
					bottom: 36,
					fontFamily: INTER,
					fontSize: 9,
					letterSpacing: '0.2em',
					color: 'rgba(255,255,255,0.1)',
					zIndex: 1
				}}
			>
				Preflight
			</div>
		</motion.div>
	);
}

// ── Main page ──────────────────────────────────────────────────────────────────

function FlightPageInner() {
	const { flightNumber } = useParams<{ flightNumber: string }>();
	const router = useRouter();
	const searchParams = useSearchParams();

	const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

	const [leftWidth, setLeftWidth] = useState(280);
	const [rightWidth, setRightWidth] = useState(300);
	const [isDragging, setIsDragging] = useState(false);
	const isDraggingLeftRef = useRef(false);
	const isDraggingRightRef = useRef(false);

	const { data, error, isLoading } = useQuery<PreflightData>({
		queryKey: ['preflight', flightNumber, date],
		queryFn: async () => {
			const r = await fetch(`/api/preflight/${flightNumber}?date=${date}`);
			if (!r.ok) throw new Error(`${r.status} — flight not found`);
			return r.json();
		},
		staleTime: 60 * 60 * 1000 // 1 hour
	});

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (isDraggingLeftRef.current) {
				const newWidth = Math.max(250, Math.min(e.clientX, window.innerWidth - rightWidth - 400));
				setLeftWidth(newWidth);
			}
			if (isDraggingRightRef.current) {
				const newWidth = Math.max(250, Math.min(window.innerWidth - e.clientX, window.innerWidth - leftWidth - 400));
				setRightWidth(newWidth);
			}
		};

		const handleMouseUp = () => {
			isDraggingLeftRef.current = false;
			isDraggingRightRef.current = false;
			setIsDragging(false);
		};

		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);

		return () => {
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		};
	}, [leftWidth, rightWidth]);

	if (error)
		return (
			<div
				style={{
					width: '100vw',
					height: '100vh',
					background: '#111318',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: '12px'
				}}
			>
				<div style={{ fontFamily: MONO, fontSize: '14px', color: '#ffb4ab', letterSpacing: '0.04em' }}>
					{flightNumber} · {(error as Error).message}
				</div>
				<button
					onClick={() => router.push('/')}
					style={{
						background: 'none',
						border: 'none',
						fontFamily: INTER,
						fontSize: '13px',
						color: 'rgba(255,255,255,0.35)',
						cursor: 'pointer'
					}}
				>
					← Back to search
				</button>
			</div>
		);

	if (isLoading || !data) return <LoadingScreen flightNumber={flightNumber} />;

	const handleLeftMouseDown = () => {
		isDraggingLeftRef.current = true;
		setIsDragging(true);
	};

	const handleRightMouseDown = () => {
		isDraggingRightRef.current = true;
		setIsDragging(true);
	};

	const { flight, origin, destination } = data;

	const sideNavItems = [
		{ icon: 'assessment', label: 'Overview', active: true },
		{ icon: 'cyclone', label: 'Meteorology', active: false },
		{ icon: 'explore', label: 'Navigation', active: false },
		{ icon: 'weight', label: 'Payload', active: false },
		{ icon: 'shield', label: 'Safety', active: false }
	];

	return (
		<div
			style={{
				width: '100vw',
				height: '100vh',
				background: '#111318',
				display: 'flex',
				flexDirection: 'column',
				overflow: 'hidden',
				fontFamily: INTER,
				userSelect: isDragging ? 'none' : 'auto',
				cursor: isDragging ? 'col-resize' : 'default'
			}}
		>
			{/* ── Top Nav ── */}
			<header
				style={{
					position: 'fixed',
					top: 0,
					left: 0,
					right: 0,
					zIndex: 50,
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'center',
					padding: '0 32px',
					height: 80,
					flexShrink: 0,
					background: 'rgba(17,19,24,0.6)',
					backdropFilter: 'blur(20px) saturate(180%)',
					WebkitBackdropFilter: 'blur(20px) saturate(180%)',
					boxShadow: '0 20px 50px rgba(10,132,255,0.08)'
				}}
			>
				<div
					style={{
						fontFamily: DISPLAY,
						fontSize: 16,
						fontWeight: 800,
						letterSpacing: '0.22em',
						color: '#aac7ff',
						textTransform: 'uppercase'
					}}
				>
					Preflight
				</div>
				<nav style={{ display: 'flex', gap: 40, alignItems: 'center' }}>
					{['Briefing', 'Weather', 'Routes', 'Fleet'].map((item, i) => (
						<span
							key={item}
							style={{
								fontFamily: DISPLAY,
								fontSize: 14,
								fontWeight: 500,
								color: i === 0 ? '#aac7ff' : '#c0c6d6',
								borderBottom: i === 0 ? '2px solid #aac7ff' : '2px solid transparent',
								paddingBottom: 2,
								cursor: 'default',
								letterSpacing: '-0.01em'
							}}
						>
							{item}
						</span>
					))}
				</nav>
				<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
					{['notifications', 'settings'].map((icon) => (
						<button
							key={icon}
							onClick={icon === 'notifications' ? undefined : undefined}
							style={{
								background: 'none',
								border: 'none',
								cursor: 'pointer',
								padding: 8,
								borderRadius: '50%',
								color: '#aac7ff',
								display: 'flex',
								alignItems: 'center',
								transition: 'background 0.2s'
							}}
							onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
							onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
						>
							<span className='material-symbols-outlined' style={{ fontSize: 22 }}>{icon}</span>
						</button>
					))}
				</div>
			</header>

			{/* ── Body (sidebar + panels) ── */}
			<div style={{ display: 'flex', flexDirection: 'row', flex: 1, marginTop: 80, overflow: 'hidden' }}>
				{/* ── Sidebar ── */}
				<aside
					style={{
						width: 256,
						flexShrink: 0,
						height: '100%',
						display: 'flex',
						flexDirection: 'column',
						padding: '24px 0',
						background: 'rgba(17,19,24,0.4)',
						backdropFilter: 'blur(16px)',
						WebkitBackdropFilter: 'blur(16px)',
						borderRight: '1px solid rgba(255,255,255,0.04)'
					}}
				>
					{/* Flight identifier */}
					<div style={{ padding: '0 24px', marginBottom: 32 }}>
						<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
							<div
								style={{
									width: 40,
									height: 40,
									borderRadius: 10,
									background: 'rgba(62,144,255,0.15)',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									color: '#aac7ff',
									flexShrink: 0
								}}
							>
								<span className='material-symbols-outlined' style={{ fontSize: 20 }}>rocket_launch</span>
							</div>
							<div>
								<div style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 700, color: '#e2e2e8' }}>
									{flight.flightNumber.replace(' ', '')}
								</div>
								<div
									style={{
										fontFamily: INTER,
										fontSize: 10,
										color: '#c0c6d6',
										textTransform: 'uppercase',
										letterSpacing: '0.12em',
										marginTop: 2
									}}
								>
									{origin.iata}–{destination.iata}
								</div>
							</div>
						</div>
					</div>

					{/* Nav items */}
					<nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
						{sideNavItems.map(({ icon, label, active }) => (
							<div
								key={label}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 16,
									padding: '12px 24px',
									background: active
										? 'linear-gradient(90deg, rgba(170,199,255,0.12) 0%, transparent 100%)'
										: 'transparent',
									borderLeft: active ? '3px solid #aac7ff' : '3px solid transparent',
									color: active ? '#aac7ff' : '#c0c6d6',
									cursor: 'default',
									transition: 'all 0.2s'
								}}
								onMouseEnter={(e) => {
									if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
								}}
								onMouseLeave={(e) => {
									if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
								}}
							>
								<span className='material-symbols-outlined' style={{ fontSize: 20 }}>{icon}</span>
								<span
									style={{
										fontFamily: INTER,
										fontSize: 11,
										fontWeight: 500,
										textTransform: 'uppercase',
										letterSpacing: '0.1em'
									}}
								>
									{label}
								</span>
							</div>
						))}
					</nav>

					{/* Generate PDF */}
					<div style={{ padding: '0 24px' }}>
						<button
							style={{
								width: '100%',
								padding: '12px',
								background: 'rgba(51,53,57,0.3)',
								color: '#aac7ff',
								border: '1px solid rgba(65,71,84,0.3)',
								borderRadius: 8,
								fontFamily: INTER,
								fontSize: 11,
								fontWeight: 700,
								textTransform: 'uppercase',
								letterSpacing: '0.12em',
								cursor: 'pointer',
								transition: 'all 0.2s'
							}}
							onMouseEnter={(e) => {
								(e.currentTarget as HTMLElement).style.background = 'rgba(51,53,57,0.6)';
							}}
							onMouseLeave={(e) => {
								(e.currentTarget as HTMLElement).style.background = 'rgba(51,53,57,0.3)';
							}}
						>
							Generate PDF
						</button>
					</div>
				</aside>

				{/* ── Main 3-panel area ── */}
				<div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minWidth: 0 }}>
					<LeftPanel data={data} width={leftWidth} onResizeStart={handleLeftMouseDown} />
					<div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
						<MapView data={data} />
						<FlightSummaryCard data={data} />
					</div>
					<RightPanel data={data} width={rightWidth} onResizeStart={handleRightMouseDown} />
				</div>
			</div>
		</div>
	);
}

export default function FlightPage() {
	return (
		<Suspense fallback={<LoadingScreen flightNumber='…' />}>
			<FlightPageInner />
		</Suspense>
	);
}
