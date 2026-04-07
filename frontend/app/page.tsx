'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';

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

// ── Date parser ────────────────────────────────────────────────────────────────
const MONTH_MAP: Record<string, number> = {
	jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
	apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
	aug: 7, august: 7, sep: 8, sept: 8, september: 8,
	oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};

function resolveYear(month: number, day: number, today: Date, explicitYear?: number): number {
	if (explicitYear !== undefined) return explicitYear;
	const thisYear = today.getFullYear();
	const candidate = new Date(thisYear, month, day);
	const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	return candidate >= todayMidnight ? thisYear : thisYear + 1;
}

function parseFlexDate(raw: string, today: Date): Date | null {
	const s = raw.trim().toLowerCase().replace(/[,./]/g, ' ').replace(/\s+/g, ' ');
	if (!s) return null;
	const parts = s.split(' ');

	const isoMatch = raw.trim().match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
	if (isoMatch) {
		const y = parseInt(isoMatch[1]), m = parseInt(isoMatch[2]) - 1, d = parseInt(isoMatch[3]);
		const dt = new Date(y, m, d);
		return isNaN(dt.getTime()) ? null : dt;
	}

	if (parts.length === 2 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
		const a = parseInt(parts[0]), b = parseInt(parts[1]);
		let month: number, day: number;
		if (a <= 12 && b > 12) { month = a - 1; day = b; }
		else if (a > 12 && b <= 12) { month = b - 1; day = a; }
		else { month = a - 1; day = b; }
		if (month < 0 || month > 11 || day < 1 || day > 31) return null;
		return new Date(resolveYear(month, day, today), month, day);
	}

	if (parts.length === 3) {
		for (const perm of [[0,1,2],[1,0,2],[0,2,1],[2,0,1]] as [number,number,number][]) {
			const [yi, mi, di] = perm;
			const yv = parseInt(parts[yi]), mv = MONTH_MAP[parts[mi]], dv = parseInt(parts[di]);
			if (yv >= 2020 && yv <= 2099 && mv !== undefined && !isNaN(dv) && dv >= 1 && dv <= 31)
				return new Date(yv, mv, dv);
		}
		const nums = parts.map(Number);
		if (nums.every((n) => !isNaN(n))) {
			const [a, b, c] = nums;
			if (c >= 2020 && c <= 2099) {
				if (a <= 12) return new Date(c, a - 1, b);
				return new Date(c, b - 1, a);
			}
		}
	}

	if (parts.length === 2) {
		for (const [mi, di] of [[0,1],[1,0]] as [number,number][]) {
			const dayStr = parts[di].replace(/(?<=\d)(st|nd|rd|th)$/, '');
			const mv = MONTH_MAP[parts[mi]], dv = parseInt(dayStr);
			if (mv !== undefined && !isNaN(dv) && dv >= 1 && dv <= 31)
				return new Date(resolveYear(mv, dv, today), mv, dv);
		}
	}

	const fallback = new Date(raw.trim());
	if (!isNaN(fallback.getTime())) return fallback;
	return null;
}

function fmtDate(d: Date): string {
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
		.replace(',', '').toUpperCase();
}

function toISODate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

// ── Star Canvas ────────────────────────────────────────────────────────────────
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

// ── Loading Screen ─────────────────────────────────────────────────────────────
function LoadingScreen({ flight }: { flight: string }) {
	const [msgIdx, setMsgIdx] = useState(0);

	useEffect(() => {
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

			{/* Progress indicator */}
			<div
				style={{
					width: 192,
					height: 2,
					background: 'rgba(170,199,255,0.12)',
					borderRadius: 999,
					overflow: 'hidden',
					position: 'relative',
					zIndex: 1
				}}
			>
				<motion.div
					animate={{ x: ['-100%', '100%'] }}
					transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
					style={{
						position: 'absolute',
						inset: 0,
						background: 'linear-gradient(90deg, transparent, #aac7ff, transparent)',
						boxShadow: '0 0 10px rgba(170,199,255,0.5)'
					}}
				/>
			</div>

			<div
				style={{
					fontFamily: 'var(--font-family-display)',
					fontSize: 26,
					fontWeight: 700,
					letterSpacing: '-0.02em',
					color: '#e2e2e8',
					position: 'relative',
					zIndex: 1
				}}
			>
				{flight}
			</div>

			<AnimatePresence mode='wait'>
				<motion.div
					key={msgIdx}
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -6 }}
					transition={{ duration: 0.28, ease: 'easeOut' }}
					style={{
						fontFamily: 'var(--font-family-sans)',
						fontSize: 10,
						letterSpacing: '0.2em',
						color: '#c0c6d6',
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
					fontFamily: 'var(--font-family-sans)',
					fontSize: 9,
					letterSpacing: '0.2em',
					color: 'rgba(170,199,255,0.15)',
					zIndex: 1,
					textTransform: 'uppercase'
				}}
			>
				Preflight
			</div>
		</motion.div>
	);
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const DISPLAY = 'var(--font-family-display)';
const SANS = 'var(--font-family-sans)';
const MONO = 'var(--font-family-mono)';

const glassPanel: React.CSSProperties = {
	backdropFilter: 'blur(20px) saturate(180%)',
	WebkitBackdropFilter: 'blur(20px) saturate(180%)',
	background: 'rgba(51, 53, 57, 0.4)',
	border: '1px solid rgba(255, 255, 255, 0.05)',
	borderRadius: 12
};

// ── Page ───────────────────────────────────────────────────────────────────────
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

const containerVariants = {
	hidden: { opacity: 0 },
	show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } }
};

const itemVariants = {
	hidden: { opacity: 0, y: 20 },
	show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE_OUT_EXPO } }
};

export default function Home() {
	const dateInputRef = useRef<HTMLInputElement>(null);

	const [flightValue, setFlightValue] = useState('');
	const [dateValue, setDateValue] = useState('');
	const [flightFocused, setFlightFocused] = useState(false);
	const [dateFocused, setDateFocused] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	const router = useRouter();
	const today = new Date();

	const parsedDate: Date | null = dateValue.trim() ? parseFlexDate(dateValue, today) : null;
	const dateValid = parsedDate !== null;
	const flightReady = !!flightValue.trim();

	// Mouse-tracked nebula
	const rawX = useMotionValue(0.5);
	const rawY = useMotionValue(0.5);
	const springX = useSpring(rawX, { stiffness: 50, damping: 28 });
	const springY = useSpring(rawY, { stiffness: 50, damping: 28 });
	const nebulaX = useTransform(springX, [0, 1], ['-8vw', '8vw']);
	const nebulaY = useTransform(springY, [0, 1], ['-8vh', '8vh']);

	function handleMouseMove(e: React.MouseEvent) {
		rawX.set(e.clientX / window.innerWidth);
		rawY.set(e.clientY / window.innerHeight);
	}

	function navigate() {
		const fn = flightValue.trim().toUpperCase();
		if (!fn) return;
		setSubmitting(true);
		const url = parsedDate ? `/flight/${fn}?date=${toISODate(parsedDate)}` : `/flight/${fn}`;
		setTimeout(() => router.push(url), 320);
	}

	function handleFlightKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (!dateValue.trim() && flightValue.trim()) {
				dateInputRef.current?.focus();
			} else {
				navigate();
			}
		}
	}

	function handleDateKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter') { e.preventDefault(); navigate(); }
		if (e.key === 'Escape') { setDateValue(''); dateInputRef.current?.blur(); }
	}

	return (
		<>
			<AnimatePresence>
				{submitting && <LoadingScreen key='loading' flight={flightValue.trim().toUpperCase()} />}
			</AnimatePresence>

			<div
				style={{ position: 'fixed', inset: 0, background: '#111318', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
				onMouseMove={handleMouseMove}
			>
				{/* Starfield */}
				<StarCanvas />

				{/* Mouse-tracked nebula */}
				<motion.div
					style={{
						position: 'absolute',
						top: '50%',
						left: '50%',
						transform: 'translate(-50%, -50%)',
						width: '140%',
						height: '140%',
						background: 'radial-gradient(circle at center, rgba(62,144,255,0.08) 0%, rgba(17,19,24,1) 70%)',
						pointerEvents: 'none',
						x: nebulaX,
						y: nebulaY
					}}
				/>

				{/* ── Top Navigation ── */}
				<motion.nav
					initial={{ opacity: 0, y: -8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, ease: 'easeOut' }}
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
					<div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
						{[
							{ label: 'Briefing', active: true },
							{ label: 'Weather', active: false },
							{ label: 'Routes', active: false },
							{ label: 'Fleet', active: false }
						].map(({ label, active }) => (
							<span
								key={label}
								style={{
									fontFamily: DISPLAY,
									fontSize: 14,
									fontWeight: 500,
									letterSpacing: '-0.01em',
									color: active ? '#aac7ff' : '#c0c6d6',
									borderBottom: active ? '2px solid #aac7ff' : '2px solid transparent',
									paddingBottom: 2,
									cursor: 'default',
									transition: 'color 0.2s'
								}}
							>
								{label}
							</span>
						))}
					</div>
					<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
						{['notifications', 'settings'].map((icon) => (
							<button
								key={icon}
								style={{
									background: 'none',
									border: 'none',
									cursor: 'pointer',
									padding: 8,
									borderRadius: '50%',
									color: '#c0c6d6',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									transition: 'background 0.2s'
								}}
								onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
								onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
							>
								<span className='material-symbols-outlined' style={{ fontSize: 20 }}>{icon}</span>
							</button>
						))}
					</div>
				</motion.nav>

				{/* ── Main Content ── */}
				<main
					style={{
						flex: 1,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						position: 'relative',
						padding: '80px 24px 80px',
						zIndex: 10
					}}
				>
					<motion.div
						variants={containerVariants}
						initial='hidden'
						animate='show'
						style={{
							width: '100%',
							maxWidth: 672,
							textAlign: 'center',
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: 0
						}}
					>
						{/* ── Header ── */}
						<motion.header variants={itemVariants} style={{ marginBottom: 48 }}>
							<h1
								style={{
									fontFamily: DISPLAY,
									fontSize: 'clamp(42px, 6vw, 72px)',
									fontWeight: 800,
									letterSpacing: '-0.03em',
									color: '#ffffff',
									textShadow: '0 0 80px rgba(62,144,255,0.2)',
									lineHeight: 1.05,
									marginBottom: 16
								}}
							>
								Preflight Briefing
							</h1>
							<p
								style={{
									fontFamily: SANS,
									fontSize: 18,
									fontWeight: 300,
									color: '#c0c6d6',
									lineHeight: 1.6,
									maxWidth: 480,
									margin: '0 auto'
								}}
							>
								Understand your flight before you take off — weather, turbulence, and what to expect along the way.
							</p>
						</motion.header>

						{/* ── Search Card ── */}
						<motion.div
							variants={itemVariants}
							style={{
								...glassPanel,
								padding: 8,
								width: '100%',
								maxWidth: 560,
								boxShadow: '0 40px 60px rgba(170,199,255,0.05)',
								marginBottom: 16
							}}
						>
							<div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
								{/* Flight Number Input */}
								<div style={{ flex: 1, position: 'relative' }}>
									<div
										style={{
											position: 'absolute',
											left: 16,
											top: '50%',
											transform: 'translateY(-50%)',
											pointerEvents: 'none',
											color: 'rgba(170,199,255,0.5)',
											display: 'flex',
											alignItems: 'center'
										}}
									>
										<span className='material-symbols-outlined' style={{ fontSize: 20 }}>flight_takeoff</span>
									</div>
									<input
										type='text'
										value={flightValue}
										onChange={(e) => setFlightValue(e.target.value)}
										onKeyDown={handleFlightKeyDown}
										onFocus={() => setFlightFocused(true)}
										onBlur={() => setFlightFocused(false)}
										placeholder='Flight Number (e.g. AA100)'
										autoComplete='off'
										autoCorrect='off'
										autoCapitalize='characters'
										spellCheck={false}
										style={{
											width: '100%',
											background: flightFocused ? 'rgba(40,42,46,0.8)' : 'rgba(40,42,46,0.4)',
											border: 'none',
											borderRadius: 8,
											outline: flightFocused ? '2px solid rgba(170,199,255,0.4)' : '2px solid transparent',
											fontFamily: SANS,
											fontSize: 14,
											fontWeight: 500,
											color: '#e2e2e8',
											padding: '20px 16px 20px 48px',
											transition: 'all 200ms ease',
											boxSizing: 'border-box',
											letterSpacing: '0.06em',
											textTransform: 'uppercase'
										}}
									/>
								</div>

								{/* Date Input */}
								<div style={{ flex: 1, position: 'relative' }}>
									<div
										style={{
											position: 'absolute',
											left: 16,
											top: '50%',
											transform: 'translateY(-50%)',
											pointerEvents: 'none',
											color: 'rgba(170,199,255,0.5)',
											display: 'flex',
											alignItems: 'center'
										}}
									>
										<span className='material-symbols-outlined' style={{ fontSize: 20 }}>calendar_today</span>
									</div>
									<input
										ref={dateInputRef}
										type='text'
										value={dateValue}
										onChange={(e) => setDateValue(e.target.value)}
										onKeyDown={handleDateKeyDown}
										onFocus={() => setDateFocused(true)}
										onBlur={() => setDateFocused(false)}
										placeholder='Today'
										autoComplete='off'
										autoCorrect='off'
										spellCheck={false}
										style={{
											width: '100%',
											background: dateFocused ? 'rgba(40,42,46,0.8)' : 'rgba(40,42,46,0.4)',
											border: 'none',
											borderRadius: 8,
											outline: dateFocused
												? dateValue && !dateValid
													? '2px solid rgba(255,180,171,0.4)'
													: '2px solid rgba(170,199,255,0.4)'
												: '2px solid transparent',
											fontFamily: SANS,
											fontSize: 14,
											fontWeight: 500,
											color: dateValue && !dateValid ? '#ffb4ab' : '#e2e2e8',
											padding: '20px 16px 20px 48px',
											transition: 'all 200ms ease',
											boxSizing: 'border-box',
											letterSpacing: '0.03em'
										}}
									/>
								</div>
							</div>
						</motion.div>

						{/* Date validation feedback */}
						<div style={{ height: 20, marginBottom: 8, width: '100%', maxWidth: 560, textAlign: 'left', paddingLeft: 2 }}>
							<AnimatePresence mode='wait'>
								{dateValid ? (
									<motion.span
										key='valid'
										initial={{ opacity: 0 }}
										animate={{ opacity: 1 }}
										exit={{ opacity: 0 }}
										style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', color: '#c0c6d6' }}
									>
										{fmtDate(parsedDate!)}
									</motion.span>
								) : dateValue && !dateValid ? (
									<motion.span
										key='invalid'
										initial={{ opacity: 0 }}
										animate={{ opacity: 1 }}
										exit={{ opacity: 0 }}
										style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', color: '#ffb4ab' }}
									>
										UNRECOGNIZED DATE
									</motion.span>
								) : null}
							</AnimatePresence>
						</div>

						{/* ── CTA Button ── */}
						<motion.div variants={itemVariants} style={{ marginBottom: 32 }}>
							<motion.button
								onClick={navigate}
								disabled={!flightReady}
								whileTap={flightReady ? { scale: 0.97 } : {}}
								whileHover={flightReady ? { scale: 1.02 } : {}}
								transition={{ type: 'spring', stiffness: 400, damping: 25 }}
								style={{
									display: 'inline-flex',
									alignItems: 'center',
									gap: 12,
									padding: '20px 48px',
									background: flightReady
										? 'linear-gradient(135deg, #aac7ff 0%, #3e90ff 100%)'
										: 'rgba(51,53,57,0.6)',
									border: 'none',
									borderRadius: 8,
									fontFamily: DISPLAY,
									fontSize: 16,
									fontWeight: 700,
									color: flightReady ? '#003064' : '#414754',
									cursor: flightReady ? 'pointer' : 'default',
									boxShadow: flightReady
										? '0 10px 30px rgba(62,144,255,0.3), 0 0 0 1px rgba(170,199,255,0.2)'
										: 'none',
									transition: 'all 250ms ease',
									outline: 'none',
									letterSpacing: '0.01em'
								}}
							>
								<span>View Flight Briefing</span>
								{flightReady && (
									<span className='material-symbols-outlined' style={{ fontSize: 20 }}>arrow_forward</span>
								)}
							</motion.button>
						</motion.div>

						{/* ── Status Badges ── */}
						<motion.div
							variants={itemVariants}
							style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32 }}
						>
							<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
								<span
									style={{
										fontFamily: SANS,
										fontSize: 10,
										letterSpacing: '0.15em',
										color: '#c0c6d6',
										textTransform: 'uppercase'
									}}
								>
									Global Coverage
								</span>
								<span
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 6,
										fontFamily: SANS,
										fontSize: 11,
										fontWeight: 500,
										color: '#53e16f'
									}}
								>
									<span
										style={{
											width: 6,
											height: 6,
											borderRadius: '50%',
											background: '#53e16f',
											boxShadow: '0 0 8px rgba(83,225,111,0.8)'
										}}
									/>
									LIVE NETWORK ACTIVE
								</span>
							</div>

							<div style={{ width: 1, height: 32, background: 'rgba(65,71,84,0.5)' }} />

							<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
								<span
									style={{
										fontFamily: SANS,
										fontSize: 10,
										letterSpacing: '0.15em',
										color: '#c0c6d6',
										textTransform: 'uppercase'
									}}
								>
									Data Precision
								</span>
								<span
									style={{
										fontFamily: SANS,
										fontSize: 11,
										fontWeight: 500,
										color: '#e2e2e8',
										letterSpacing: '0.03em',
										textTransform: 'uppercase'
									}}
								>
									99.9% METAR Accuracy
								</span>
							</div>
						</motion.div>

						{/* Hints */}
						<motion.div
							variants={itemVariants}
							style={{
								marginTop: 16,
								fontFamily: MONO,
								fontSize: 10,
								color: '#414754',
								letterSpacing: '0.1em'
							}}
						>
							EK203 · QR007 · APR 15 · MAY 28
						</motion.div>
					</motion.div>

					{/* ── Floating Side Cards ── */}
					<motion.div
						initial={{ opacity: 0, x: -16 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.7, delay: 0.6, ease: EASE_OUT_EXPO }}
						style={{
							position: 'absolute',
							bottom: 80,
							left: 48,
							display: 'none'
						}}
						className='floating-card-left'
					>
						<div
							style={{
								...glassPanel,
								background: 'rgba(30,32,36,0.4)',
								padding: '16px 20px',
								width: 192,
								display: 'flex',
								flexDirection: 'column',
								gap: 12
							}}
						>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<span style={{ fontFamily: SANS, fontSize: 10, color: '#c0c6d6', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
									Wind Speed
								</span>
								<span className='material-symbols-outlined' style={{ fontSize: 16, color: '#aac7ff' }}>air</span>
							</div>
							<div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 800, color: '#e2e2e8', lineHeight: 1 }}>
								420<span style={{ fontSize: 12, opacity: 0.5, marginLeft: 4 }}>KTS</span>
							</div>
							<div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
								<div style={{ height: '100%', width: '66%', background: '#aac7ff', borderRadius: 999 }} />
							</div>
						</div>
					</motion.div>

					<motion.div
						initial={{ opacity: 0, x: 16 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.7, delay: 0.7, ease: EASE_OUT_EXPO }}
						style={{
							position: 'absolute',
							top: 128,
							right: 48,
							display: 'none'
						}}
						className='floating-card-right'
					>
						<div
							style={{
								...glassPanel,
								background: 'rgba(30,32,36,0.4)',
								padding: '16px 20px',
								width: 192,
								display: 'flex',
								flexDirection: 'column',
								gap: 8
							}}
						>
							<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
								<span style={{ fontFamily: SANS, fontSize: 10, color: '#c0c6d6', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
									Visibility
								</span>
								<span className='material-symbols-outlined' style={{ fontSize: 16, color: '#53e16f' }}>visibility</span>
							</div>
							<div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 800, color: '#e2e2e8', lineHeight: 1 }}>MAX</div>
							<div style={{ fontFamily: SANS, fontSize: 9, color: '#53e16f', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
								Atmospheric Optimal
							</div>
						</div>
					</motion.div>
				</main>

				{/* ── Footer ── */}
				<footer
					style={{
						position: 'relative',
						zIndex: 20,
						padding: '24px 48px',
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						borderTop: '1px solid rgba(255,255,255,0.04)',
						background: '#111318',
						flexShrink: 0
					}}
				>
					<p style={{ fontFamily: SANS, fontSize: 10, letterSpacing: '0.15em', color: '#c0c6d6', textTransform: 'uppercase' }}>
						© 2024 PREFLIGHT SYSTEMS. ALL RIGHTS RESERVED.
					</p>
					<div style={{ display: 'flex', gap: 32 }}>
						{['Terms of Flight', 'Technical Specs', 'Support'].map((link) => (
							<a
								key={link}
								href='#'
								style={{
									fontFamily: SANS,
									fontSize: 10,
									letterSpacing: '0.15em',
									color: '#c0c6d6',
									textDecoration: 'none',
									textTransform: 'uppercase',
									opacity: 0.8,
									transition: 'opacity 0.2s'
								}}
								onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
								onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
							>
								{link}
							</a>
						))}
					</div>
				</footer>
			</div>

			<style>{`
				input::placeholder { color: rgba(192,198,214,0.4); font-weight: 400; }
				input { -webkit-font-smoothing: antialiased; }
				@media (min-width: 1280px) {
					.floating-card-left { display: block !important; }
					.floating-card-right { display: block !important; }
				}
			`}</style>
		</>
	);
}
