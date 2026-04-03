'use client';

import { useEffect, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

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

interface Props {
	routeWinds: RouteWind[];
	originIata: string;
	destIata: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DATA_LEVELS = [
	{ pressure: 500, alt: 18000, label: 'FL180' },
	{ pressure: 300, alt: 30000, label: 'FL300' },
	{ pressure: 250, alt: 34000, label: 'FL340' },
	{ pressure: 200, alt: 38600, label: 'FL380' }
];

// Chart shows a slightly wider altitude band for visual breathing room
const MIN_ALT = 15000;
const MAX_ALT = 41000;
const ALT_RANGE = MAX_ALT - MIN_ALT;

const REVEAL_MS = 1800;
const FADE_MS = 400; // arrows fade in after reveal

// ── Helpers ────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}
function clamp(v: number, lo: number, hi: number) {
	return v < lo ? lo : v > hi ? hi : v;
}
function altFrac(alt: number) {
	return (alt - MIN_ALT) / ALT_RANGE;
}
function easeOut3(t: number) {
	return 1 - (1 - t) ** 3;
}

// Wind speed → RGB. Calibrated for ~0-120kt typical cruise band.
function speedRgb(kt: number): [number, number, number] {
	const stops: [number, [number, number, number]][] = [
		[0, [2, 10, 22]],
		[20, [5, 16, 36]],
		[45, [10, 28, 72]],
		[70, [16, 52, 130]],
		[88, [55, 138, 221]], // accent blue — moderate jet
		[105, [239, 159, 39]], // amber — strong jet
		[130, [226, 75, 74]] // red   — extreme
	];
	if (kt <= stops[0][0]) return stops[0][1];
	for (let i = 0; i < stops.length - 1; i++) {
		const [k0, c0] = stops[i];
		const [k1, c1] = stops[i + 1];
		if (kt <= k1) {
			const t = (kt - k0) / (k1 - k0);
			return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)].map(Math.round) as [
				number,
				number,
				number
			];
		}
	}
	return stops[stops.length - 1][1];
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AtmosphereView({ routeWinds, originIata, destIata }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		if (!routeWinds.length) return;
		const canvas = canvasRef.current;
		const container = containerRef.current;
		if (!canvas || !container) return;
		const ctx = canvas.getContext('2d')!;
		if (!ctx) return;

		// ── Size canvas at device pixel ratio ─────────────────────────────────────
		const DPR = Math.min(window.devicePixelRatio || 1, 2);
		const W = container.clientWidth;
		const H = container.clientHeight;

		canvas.width = Math.floor(W * DPR);
		canvas.height = Math.floor(H * DPR);
		canvas.style.width = `${W}px`;
		canvas.style.height = `${H}px`;
		ctx.scale(DPR, DPR);

		// ── Chart margins ─────────────────────────────────────────────────────────
		const ML = 52; // left  — altitude labels
		const MR = 76; // right — legend
		const MT = 26; // top   — title
		const MB = 28; // bottom — x labels
		const CW = W - ML - MR;
		const CH = H - MT - MB;

		const nWp = routeWinds.length;
		const nLvl = DATA_LEVELS.length;

		// ── Build data grids [waypoint][level] ────────────────────────────────────
		const speedGrid: number[][] = routeWinds.map((wp) =>
			DATA_LEVELS.map((lv) => wp.levels.find((l) => l.pressureHpa === lv.pressure)?.speedKt ?? 0)
		);
		const dirGrid: number[][] = routeWinds.map((wp) =>
			DATA_LEVELS.map((lv) => wp.levels.find((l) => l.pressureHpa === lv.pressure)?.directionDeg ?? 0)
		);

		// Precompute altitude fractions for each level (0=bottom, 1=top of chart)
		const levelFracs = DATA_LEVELS.map((l) => altFrac(l.alt));
		// levelFracs: ~[0.125, 0.625, 0.792, 0.958]

		// ── Build bilinear heatmap → offscreen canvas ─────────────────────────────
		const iW = Math.ceil(CW);
		const iH = Math.ceil(CH);
		const imgData = ctx.createImageData(iW, iH);

		for (let py = 0; py < iH; py++) {
			// py=0 is top, py=iH-1 is bottom
			// altF: 1 at top of chart, 0 at bottom
			const altF = 1 - py / (iH - 1);

			// Which level band is this pixel in?
			let lo = 0,
				hi = 1,
				bandT = 0;
			if (altF <= levelFracs[0]) {
				lo = hi = 0;
				bandT = 0;
			} else if (altF >= levelFracs[nLvl - 1]) {
				lo = hi = nLvl - 1;
				bandT = 0;
			} else {
				for (let j = 0; j < nLvl - 1; j++) {
					if (altF >= levelFracs[j] && altF <= levelFracs[j + 1]) {
						lo = j;
						hi = j + 1;
						bandT = (altF - levelFracs[j]) / (levelFracs[j + 1] - levelFracs[j]);
						break;
					}
				}
			}

			for (let px = 0; px < iW; px++) {
				const routeT = px / (iW - 1);
				const gxF = routeT * (nWp - 1);
				const gx0 = Math.floor(gxF);
				const gx1 = Math.min(gx0 + 1, nWp - 1);
				const gxT = gxF - gx0;

				// Bilinear interpolation
				const sLo = lerp(speedGrid[gx0][lo], speedGrid[gx1][lo], gxT);
				const sHi = lerp(speedGrid[gx0][hi], speedGrid[gx1][hi], gxT);
				const spd = lerp(sLo, sHi, bandT);

				const [r, g, b] = speedRgb(spd);
				const idx = (py * iW + px) * 4;
				imgData.data[idx] = r;
				imgData.data[idx + 1] = g;
				imgData.data[idx + 2] = b;
				imgData.data[idx + 3] = 255;
			}
		}

		// Bake to offscreen canvas — only drawn once
		const offscreen = document.createElement('canvas');
		offscreen.width = iW;
		offscreen.height = iH;
		const offCtx = offscreen.getContext('2d')!;
		offCtx.putImageData(imgData, 0, 0);

		// ── Animation loop ────────────────────────────────────────────────────────
		const t0 = performance.now();
		let rafId: number;

		const drawArrow = (x: number, y: number, fromDeg: number, spd: number, alpha: number) => {
			const toDeg = (fromDeg + 180) % 360;
			const rad = (toDeg * Math.PI) / 180;
			const dx = Math.sin(rad);
			const dy = -Math.cos(rad);
			const len = clamp(6 + spd * 0.08, 7, 14);

			const x0 = x - dx * len * 0.5;
			const y0 = y - dy * len * 0.5;
			const x1 = x + dx * len * 0.5;
			const y1 = y + dy * len * 0.5;

			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = spd > 88 ? '#EF9F27' : 'rgba(255,255,255,0.7)';
			ctx.lineWidth = 1;

			ctx.beginPath();
			ctx.moveTo(x0, y0);
			ctx.lineTo(x1, y1);
			ctx.stroke();

			// Arrowhead
			const angle = Math.atan2(dy, dx);
			const headLen = 3.5;
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x1 - headLen * Math.cos(angle - 0.55), y1 - headLen * Math.sin(angle - 0.55));
			ctx.moveTo(x1, y1);
			ctx.lineTo(x1 - headLen * Math.cos(angle + 0.55), y1 - headLen * Math.sin(angle + 0.55));
			ctx.stroke();
			ctx.restore();
		};

		function frame(now: number) {
			rafId = requestAnimationFrame(frame);
			const elapsed = now - t0;
			const rawT = clamp(elapsed / REVEAL_MS, 0, 1);
			const revealT = easeOut3(rawT);
			const revealX = revealT * CW;

			// Background
			ctx.fillStyle = '#050d18';
			ctx.fillRect(0, 0, W, H);

			// Subtle horizontal grid lines at each data level
			ctx.strokeStyle = 'rgba(255,255,255,0.05)';
			ctx.lineWidth = 1;
			for (let j = 0; j < nLvl; j++) {
				const y = MT + CH * (1 - levelFracs[j]);
				ctx.beginPath();
				ctx.moveTo(ML, y);
				ctx.lineTo(ML + CW, y);
				ctx.stroke();
			}

			// Subtle vertical grid lines every 25%
			for (let i = 0; i <= 4; i++) {
				const x = ML + (i / 4) * CW;
				ctx.beginPath();
				ctx.moveTo(x, MT);
				ctx.lineTo(x, MT + CH);
				ctx.stroke();
			}

			// Heatmap — clipped to revealed region
			if (revealX > 0) {
				ctx.save();
				ctx.beginPath();
				ctx.rect(ML, MT, revealX, CH);
				ctx.clip();
				ctx.drawImage(offscreen, ML, MT, CW, CH);
				ctx.restore();
			}

			// Scan line — bright leading edge during reveal
			if (rawT < 1) {
				const sx = ML + revealX;
				const scanGrad = ctx.createLinearGradient(sx - 12, 0, sx + 2, 0);
				scanGrad.addColorStop(0, 'rgba(55,138,221,0)');
				scanGrad.addColorStop(0.5, 'rgba(55,138,221,0.12)');
				scanGrad.addColorStop(1, 'rgba(55,138,221,0.55)');
				ctx.fillStyle = scanGrad;
				ctx.fillRect(sx - 12, MT, 14, CH);
			}

			// Jet stream glow — pulsing amber halo on high-speed nodes (after reveal)
			if (rawT >= 1) {
				const pulse = 0.5 + 0.5 * Math.sin((elapsed - REVEAL_MS) * 0.0018);
				for (let gx = 0; gx < nWp; gx++) {
					for (let gy = 0; gy < nLvl; gy++) {
						const spd = speedGrid[gx][gy];
						if (spd < 80) continue;
						const cx = ML + (gx / (nWp - 1)) * CW;
						const cy = MT + CH * (1 - levelFracs[gy]);
						const intensity = clamp((spd - 80) / 50, 0, 1) * pulse * 0.28;
						const r = 32;
						const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
						g.addColorStop(0, `rgba(239,159,39,${intensity})`);
						g.addColorStop(1, 'rgba(239,159,39,0)');
						ctx.fillStyle = g;
						ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
					}
				}
			}

			// Wind arrows — fade in after 30% reveal
			const arrowAlpha = clamp((elapsed - REVEAL_MS * 0.3) / FADE_MS, 0, 1) * 0.72;
			if (arrowAlpha > 0) {
				for (let gx = 0; gx < nWp; gx++) {
					const ax = ML + (gx / (nWp - 1)) * CW;
					if (ax > ML + revealX + 2) break;
					for (let gy = 0; gy < nLvl; gy++) {
						const ay = MT + CH * (1 - levelFracs[gy]);
						const spd = speedGrid[gx][gy];
						const dir = dirGrid[gx][gy];
						drawArrow(ax, ay, dir, spd, arrowAlpha);
					}
				}
			}

			// ── Chart border ───────────────────────────────────────────────────────
			ctx.strokeStyle = 'rgba(255,255,255,0.08)';
			ctx.lineWidth = 1;
			ctx.strokeRect(ML, MT, CW, CH);

			// ── Y-axis labels ──────────────────────────────────────────────────────
			ctx.font = '9px monospace';
			ctx.textAlign = 'right';
			ctx.textBaseline = 'middle';
			for (let j = 0; j < nLvl; j++) {
				const y = MT + CH * (1 - levelFracs[j]);
				ctx.fillStyle = 'rgba(255,255,255,0.3)';
				ctx.fillText(DATA_LEVELS[j].label, ML - 6, y);
			}

			// ── X-axis labels ──────────────────────────────────────────────────────
			ctx.font = '9px monospace';
			ctx.textBaseline = 'top';
			ctx.textAlign = 'left';
			ctx.fillStyle = 'rgba(255,255,255,0.3)';
			ctx.fillText(originIata, ML, MT + CH + 5);
			ctx.textAlign = 'right';
			ctx.fillText(destIata, ML + CW, MT + CH + 5);

			// ── Title ──────────────────────────────────────────────────────────────
			ctx.font = '9px monospace';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			ctx.fillStyle = 'rgba(255,255,255,0.18)';
			const titleText = `WIND PROFILE  ${originIata}→${destIata}`;
			ctx.fillText(titleText, ML, 6);

			// ── Legend ─────────────────────────────────────────────────────────────
			const lgX = ML + CW + 14;
			const lgY = MT + 4;
			const lgH = CH - 8;
			const lgW = 10;

			const lgGrad = ctx.createLinearGradient(0, lgY + lgH, 0, lgY);
			lgGrad.addColorStop(0, 'rgb(2,10,22)');
			lgGrad.addColorStop(0.35, 'rgb(10,28,72)');
			lgGrad.addColorStop(0.6, 'rgb(55,138,221)');
			lgGrad.addColorStop(0.8, 'rgb(239,159,39)');
			lgGrad.addColorStop(1.0, 'rgb(226,75,74)');

			ctx.fillStyle = lgGrad;
			ctx.fillRect(lgX, lgY, lgW, lgH);
			ctx.strokeStyle = 'rgba(255,255,255,0.1)';
			ctx.lineWidth = 0.5;
			ctx.strokeRect(lgX, lgY, lgW, lgH);

			const ticks: [number, string][] = [
				[0, '0'],
				[0.35, '45'],
				[0.6, '88'],
				[0.8, '105'],
				[1, '130+']
			];
			ctx.font = '8px monospace';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'middle';
			for (const [frac, lbl] of ticks) {
				const ty = lgY + lgH * (1 - frac);
				ctx.fillStyle = 'rgba(255,255,255,0.28)';
				ctx.fillText(lbl, lgX + lgW + 3, ty);
				ctx.strokeStyle = 'rgba(255,255,255,0.15)';
				ctx.lineWidth = 0.5;
				ctx.beginPath();
				ctx.moveTo(lgX, ty);
				ctx.lineTo(lgX + lgW, ty);
				ctx.stroke();
			}
		}

		rafId = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(rafId);
	}, [routeWinds, originIata, destIata]);

	return (
		<div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', background: '#050d18' }}>
			<canvas ref={canvasRef} style={{ display: 'block' }} />
		</div>
	);
}
