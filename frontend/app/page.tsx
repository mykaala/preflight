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
	jan: 0,
	january: 0,
	feb: 1,
	february: 1,
	mar: 2,
	march: 2,
	apr: 3,
	april: 3,
	may: 4,
	jun: 5,
	june: 5,
	jul: 6,
	july: 6,
	aug: 7,
	august: 7,
	sep: 8,
	sept: 8,
	september: 8,
	oct: 9,
	october: 9,
	nov: 10,
	november: 10,
	dec: 11,
	december: 11
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
		const y = parseInt(isoMatch[1]),
			m = parseInt(isoMatch[2]) - 1,
			d = parseInt(isoMatch[3]);
		const dt = new Date(y, m, d);
		return isNaN(dt.getTime()) ? null : dt;
	}

	if (parts.length === 2 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
		const a = parseInt(parts[0]),
			b = parseInt(parts[1]);
		let month: number, day: number;
		if (a <= 12 && b > 12) {
			month = a - 1;
			day = b;
		} else if (a > 12 && b <= 12) {
			month = b - 1;
			day = a;
		} else {
			month = a - 1;
			day = b;
		}
		if (month < 0 || month > 11 || day < 1 || day > 31) return null;
		return new Date(resolveYear(month, day, today), month, day);
	}

	if (parts.length === 3) {
		for (const perm of [
			[0, 1, 2],
			[1, 0, 2],
			[0, 2, 1],
			[2, 0, 1]
		] as [number, number, number][]) {
			const [yi, mi, di] = perm;
			const yv = parseInt(parts[yi]),
				mv = MONTH_MAP[parts[mi]],
				dv = parseInt(parts[di]);
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
		for (const [mi, di] of [
			[0, 1],
			[1, 0]
		] as [number, number][]) {
			const dayStr = parts[di].replace(/(?<=\d)(st|nd|rd|th)$/, '');
			const mv = MONTH_MAP[parts[mi]],
				dv = parseInt(dayStr);
			if (mv !== undefined && !isNaN(dv) && dv >= 1 && dv <= 31) return new Date(resolveYear(mv, dv, today), mv, dv);
		}
	}

	const fallback = new Date(raw.trim());
	if (!isNaN(fallback.getTime())) return fallback;
	return null;
}

function fmtDate(d: Date): string {
	return d
		.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
		.replace(',', '')
		.toUpperCase();
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

		// a handful of slightly brighter accent stars
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
				// soft glow around bright stars
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
				background: '#020408',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 28
			}}
		>
			<StarCanvas />

			{/* Orbital ring spinner */}
			<motion.div
				animate={{ rotate: 360 }}
				transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
				style={{
					width: 44,
					height: 44,
					borderRadius: '50%',
					border: '1.5px solid rgba(55,138,221,0.12)',
					borderTopColor: 'rgba(55,138,221,0.8)',
					position: 'relative',
					zIndex: 1
				}}
			/>

			<div
				style={{
					fontFamily: 'var(--font-family-sans)',
					fontSize: 26,
					fontWeight: 600,
					letterSpacing: '0.1em',
					color: 'rgba(255,255,255,0.88)',
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
						fontFamily: 'var(--font-family-mono)',
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
					fontFamily: 'var(--font-family-sans)',
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

// ── Page ───────────────────────────────────────────────────────────────────────
const containerVariants = {
	hidden: { opacity: 0 },
	show: {
		opacity: 1,
		transition: { staggerChildren: 0.1, delayChildren: 0.15 }
	}
};

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

const itemVariants = {
	hidden: { opacity: 0, y: 24 },
	show: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.7, ease: EASE_OUT_EXPO }
	}
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
		if (e.key === 'Enter') {
			e.preventDefault();
			navigate();
		}
		if (e.key === 'Escape') {
			setDateValue('');
			dateInputRef.current?.blur();
		}
	}

	return (
		<>
			<AnimatePresence>
				{submitting && <LoadingScreen key='loading' flight={flightValue.trim().toUpperCase()} />}
			</AnimatePresence>

			<div
				style={{ position: 'fixed', inset: 0, background: '#020408', overflow: 'hidden' }}
				onMouseMove={handleMouseMove}
			>
				{/* Starfield */}
				<StarCanvas />

				{/* Mouse-tracked drifting nebula */}
				<motion.div
					style={{
						position: 'absolute',
						width: '100vw',
						height: '70vh',
						left: '-10vw',
						top: '10vh',
						background: 'radial-gradient(ellipse 50% 60% at 50% 50%, rgba(55,138,221,0.055) 0%, transparent 70%)',
						pointerEvents: 'none',
						x: nebulaX,
						y: nebulaY
					}}
				/>

				{/* Static central bloom */}
				<div
					style={{
						position: 'absolute',
						inset: 0,
						background: 'radial-gradient(ellipse 55% 40% at 50% 52%, rgba(55,138,221,0.04) 0%, transparent 65%)',
						pointerEvents: 'none'
					}}
				/>

				{/* Horizon vignette */}
				<div
					style={{
						position: 'absolute',
						inset: 0,
						background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(2,4,8,0.7) 100%)',
						pointerEvents: 'none'
					}}
				/>

				{/* Content */}
				<motion.div
					variants={containerVariants}
					initial='hidden'
					animate='show'
					style={{
						position: 'absolute',
						inset: 0,
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'center'
					}}
				>
					{/* Wordmark */}
					<motion.div variants={itemVariants} style={{ textAlign: 'center', marginBottom: 36 }}>
						<div
							style={{
								fontFamily: 'var(--font-family-sans)',
								fontSize: 'clamp(36px, 5.5vw, 68px)',
								fontWeight: 700,
								letterSpacing: '0.28em',
								color: 'rgba(255,255,255,0.88)',
								textShadow: '0 0 120px rgba(55,138,221,0.35)',
								lineHeight: 1,
								marginLeft: '0.28em' // optical centering for letter-spacing
							}}
						>
							Preflight
						</div>
						<div
							style={{
								fontFamily: 'var(--font-family-mono)',
								fontSize: 9,
								letterSpacing: '0.3em',
								color: 'rgba(255,255,255,0.4)',
								marginTop: 40,
								marginLeft: '0.3em'
							}}
						>
							FLIGHT INTELLIGENCE
						</div>
					</motion.div>

					{/* Card */}
					<motion.div variants={itemVariants} style={{ width: '100%', maxWidth: 380, padding: '0 20px' }}>
						<motion.div
							whileHover={{
								boxShadow:
									'0 0 0 1px rgba(55,138,221,0.12), 0 48px 96px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)'
							}}
							transition={{ duration: 0.3 }}
							style={{
								background: 'rgba(255,255,255,0.028)',
								border: '1px solid rgba(255,255,255,0.07)',
								borderTop: '1px solid rgba(255,255,255,0.1)',
								borderRadius: 20,
								padding: '22px 22px 22px',
								backdropFilter: 'blur(48px)',
								boxShadow:
									'0 0 0 1px rgba(0,0,0,0.4), 0 32px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)'
							}}
						>
							{/* Card header */}
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
								<motion.div
									animate={{ opacity: [0.6, 1, 0.6] }}
									transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
									style={{
										width: 5,
										height: 5,
										borderRadius: '50%',
										background: '#378ADD',
										boxShadow: '0 0 8px 2px rgba(55,138,221,0.5)',
										flexShrink: 0
									}}
								/>
								<span
									style={{
										fontFamily: 'var(--font-family-mono)',
										fontSize: 9,
										letterSpacing: '0.2em',
										color: 'rgba(255,255,255,0.5)',
										textTransform: 'uppercase'
									}}
								>
									FLIGHT LOOKUP
								</span>
							</div>

							{/* Flight number input */}
							<div style={{ marginBottom: 10, position: 'relative' }}>
								<motion.div
									animate={{ opacity: flightFocused ? 1 : 0 }}
									transition={{ duration: 0.2 }}
									style={{
										position: 'absolute',
										inset: -1,
										borderRadius: 12,
										boxShadow: '0 0 0 2px rgba(55,138,221,0.25)',
										pointerEvents: 'none'
									}}
								/>
								<input
									type='text'
									value={flightValue}
									onChange={(e) => setFlightValue(e.target.value)}
									onKeyDown={handleFlightKeyDown}
									onFocus={() => setFlightFocused(true)}
									onBlur={() => setFlightFocused(false)}
									placeholder='Flight number'
									autoComplete='off'
									autoCorrect='off'
									autoCapitalize='characters'
									spellCheck={false}
									style={{
										width: '100%',
										background: flightFocused ? 'rgba(55,138,221,0.06)' : 'rgba(255,255,255,0.035)',
										border: `1px solid ${flightFocused ? 'rgba(55,138,221,0.3)' : 'rgba(255,255,255,0.07)'}`,
										borderRadius: 11,
										outline: 'none',
										fontFamily: 'var(--font-family-sans)',
										fontSize: 15,
										fontWeight: 500,
										color: '#fff',
										padding: '13px 14px',
										transition: 'all 200ms ease',
										boxSizing: 'border-box',
										letterSpacing: '0.04em'
									}}
								/>
							</div>

							{/* Date input */}
							<div style={{ marginBottom: 6, position: 'relative' }}>
								<motion.div
									animate={{ opacity: dateFocused ? 1 : 0 }}
									transition={{ duration: 0.2 }}
									style={{
										position: 'absolute',
										inset: -1,
										borderRadius: 12,
										boxShadow:
											dateValue && !dateValid ? '0 0 0 2px rgba(226,75,74,0.25)' : '0 0 0 2px rgba(55,138,221,0.25)',
										pointerEvents: 'none'
									}}
								/>
								<input
									ref={dateInputRef}
									type='text'
									value={dateValue}
									onChange={(e) => setDateValue(e.target.value)}
									onKeyDown={handleDateKeyDown}
									onFocus={() => setDateFocused(true)}
									onBlur={() => setDateFocused(false)}
									placeholder='Departure date  —  optional'
									autoComplete='off'
									autoCorrect='off'
									spellCheck={false}
									style={{
										width: '100%',
										background: dateFocused ? 'rgba(55,138,221,0.06)' : 'rgba(255,255,255,0.035)',
										border: `1px solid ${
											dateValue && !dateValid
												? 'rgba(226,75,74,0.4)'
												: dateFocused
													? 'rgba(55,138,221,0.3)'
													: 'rgba(255,255,255,0.07)'
										}`,
										borderRadius: 11,
										outline: 'none',
										fontFamily: 'var(--font-family-sans)',
										fontSize: 15,
										fontWeight: 500,
										color: dateValue && !dateValid ? 'rgba(226,75,74,0.85)' : '#fff',
										padding: '13px 14px',
										transition: 'all 200ms ease',
										boxSizing: 'border-box'
									}}
								/>
							</div>

							{/* Date feedback */}
							<AnimatePresence mode='wait'>
								{dateValid ? (
									<motion.div
										key='valid'
										initial={{ opacity: 0, y: -4 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.2 }}
										style={{
											fontFamily: 'var(--font-family-mono)',
											fontSize: 10,
											letterSpacing: '0.08em',
											color: 'rgba(255,255,255,0.6)',
											minHeight: 20,
											padding: '0 2px',
											marginBottom: 14
										}}
									>
										{fmtDate(parsedDate!)}
									</motion.div>
								) : dateValue && !dateValid ? (
									<motion.div
										key='invalid'
										initial={{ opacity: 0, y: -4 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.2 }}
										style={{
											fontFamily: 'var(--font-family-mono)',
											fontSize: 10,
											letterSpacing: '0.08em',
											color: 'rgba(226,75,74,0.9)',
											minHeight: 20,
											padding: '0 2px',
											marginBottom: 14
										}}
									>
										UNRECOGNIZED DATE
									</motion.div>
								) : (
									<div key='empty' style={{ minHeight: 20, marginBottom: 14 }} />
								)}
							</AnimatePresence>

							{/* Submit button */}
							<motion.button
								onClick={navigate}
								disabled={!flightReady}
								whileTap={flightReady ? { scale: 0.975 } : {}}
								whileHover={flightReady ? { scale: 1.01 } : {}}
								transition={{ type: 'spring', stiffness: 400, damping: 25 }}
								style={{
									width: '100%',
									background: flightReady
										? 'linear-gradient(160deg, rgba(55,138,221,0.9) 0%, rgba(30,100,185,0.95) 100%)'
										: 'rgba(255,255,255,0.05)',
									border: flightReady ? '1px solid rgba(55,138,221,0.4)' : '1px solid rgba(255,255,255,0.06)',
									borderRadius: 11,
									fontFamily: 'var(--font-family-sans)',
									fontSize: 15,
									fontWeight: 600,
									color: flightReady ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.18)',
									padding: '13px',
									cursor: flightReady ? 'pointer' : 'default',
									letterSpacing: '-0.01em',
									boxShadow: flightReady
										? '0 0 24px rgba(55,138,221,0.2), inset 0 1px 0 rgba(255,255,255,0.12)'
										: 'none',
									transition: 'all 220ms ease',
									outline: 'none'
								}}
							>
								{flightReady ? (
									<motion.span
										key='ready'
										initial={{ opacity: 0 }}
										animate={{ opacity: 1 }}
										transition={{ duration: 0.2 }}
									>
										Look up flight
									</motion.span>
								) : (
									<span>Look up flight</span>
								)}
							</motion.button>
						</motion.div>
					</motion.div>

					{/* Hints */}
					<motion.div
						variants={itemVariants}
						style={{
							textAlign: 'center',
							fontFamily: 'var(--font-family-mono)',
							fontSize: 10,
							color: 'rgba(255,255,255,0.35)',
							letterSpacing: '0.1em',
							marginTop: 22
						}}
					>
						EK203 · QR007 · APR 15 · MAY 28
					</motion.div>
				</motion.div>
			</div>

			<style>{`
				input::placeholder { color: rgba(255,255,255,0.16); font-weight: 400; }
				input { -webkit-font-smoothing: antialiased; }
			`}</style>
		</>
	);
}
