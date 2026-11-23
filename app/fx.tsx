"use client";

import { useEffect, useRef, useState } from "react";

const RAMP = " .,:;-=+*xX#%@";

function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/**
 * A living ASCII campfire: rings of characters that flicker like embers,
 * with heat rising from the centre and a warm halo that follows the pointer.
 * Draws on a canvas, pauses off-screen, and renders one still frame when the
 * visitor prefers reduced motion.
 */
export function EmberField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const cell = { w: 9, h: 15 };
    let cols = 0;
    let rows = 0;
    let frame = 0;
    let raf = 0;
    let visible = true;
    const pointer = { x: -9999, y: -9999, active: false };
    const still = prefersReducedMotion();

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.font = "500 12px " + (getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "monospace") + ", monospace";
      context.textBaseline = "top";
      cols = Math.ceil(width / cell.w);
      rows = Math.ceil(height / cell.h);
    };

    const draw = (time: number) => {
      const width = cols * cell.w;
      const height = rows * cell.h;
      context.clearRect(0, 0, width, height);
      const t = time / 1000;
      const cx = cols / 2;
      const cy = rows * 0.44;
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const dx = (x - cx) / (cols * 0.5);
          const dy = (y - cy) / (rows * 0.62);
          const r = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);
          // Rings that slowly turn, with flicker that is stronger near the fire.
          const ring = Math.sin(r * 14 - angle * 2 - t * 0.9) * 0.5 + 0.5;
          const flicker = Math.sin(x * 12.9898 + y * 78.233 + t * 7) * 0.5 + 0.5;
          const band = Math.max(0, 1 - Math.abs(r - 0.55) * 2.1);
          let heat = ring * band * (0.55 + flicker * 0.45);
          if (r < 0.14) heat *= r / 0.14; // keep the mark readable
          // Keep the headline and copy readable: the fire burns around them, not behind them.
          const fy = y / rows;
          if (Math.abs(dx) < 0.6 && fy > 0.28 && fy < 0.98) heat *= 0.2 + Math.min(0.8, Math.max(0, (Math.abs(dx) - 0.42) * 4.4));
          if (pointer.active) {
            const px = x * cell.w - pointer.x;
            const py = y * cell.h - pointer.y;
            const d = Math.sqrt(px * px + py * py);
            heat += Math.max(0, 1 - d / 150) * 0.55;
          }
          heat = Math.min(1, heat);
          if (heat < 0.08) continue;
          const char = RAMP[Math.min(RAMP.length - 1, Math.floor(heat * RAMP.length))];
          // Cool indigo for embers, amber for the hottest cells.
          const hot = Math.max(0, (heat - 0.45) / 0.55);
          const red = Math.round(52 + (255 - 52) * hot);
          const green = Math.round(58 + (176 - 58) * hot);
          const blue = Math.round(120 + (72 - 120) * hot);
          context.fillStyle = "rgba(" + red + "," + green + "," + blue + "," + (0.25 + heat * 0.6).toFixed(2) + ")";
          context.fillText(char, x * cell.w, y * cell.h);
        }
      }
    };

    const loop = (time: number) => {
      frame += 1;
      if (visible && frame % 2 === 0) draw(time);
      raf = window.requestAnimationFrame(loop);
    };

    resize();
    if (still) draw(0);
    else raf = window.requestAnimationFrame(loop);

    const onResize = () => { resize(); if (still) draw(0); };
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active = pointer.y > -50 && pointer.y < rect.height + 50;
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(canvas);
    window.addEventListener("resize", onResize);
    if (!still) window.addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

  return <canvas ref={canvasRef} className="ember-field" aria-hidden="true" />;
}

/** Sparks drifting up from the bottom of the hero. Pure CSS; hidden for reduced motion. */
export function Sparks({ count = 18 }: { count?: number }) {
  return <div className="sparks" aria-hidden="true">
    {Array.from({ length: count }, (_, index) => {
      const seed = (index * 37) % 100;
      return <span key={index} style={{
        left: (8 + ((index * 53) % 84)) + "%",
        animationDelay: (-(seed / 100) * 9).toFixed(2) + "s",
        animationDuration: (6 + (seed % 5)) + "s",
        ["--drift" as string]: ((seed % 2 ? 1 : -1) * (10 + seed % 30)) + "px",
        ["--size" as string]: (2 + (seed % 3)) + "px",
      }} />;
    })}
  </div>;
}

const DEMO_LINES: { text: string; kind: "cmd" | "ok" | "live"; meta?: string }[] = [
  { text: "deplo deploy your-name/portfolio", kind: "cmd" },
  { text: "cloned main", kind: "ok", meta: "0.4s" },
  { text: "npm install · 412 packages", kind: "ok", meta: "18.2s" },
  { text: "vite build → dist/", kind: "ok", meta: "6.1s" },
  { text: "uploaded 37 files · 12 new", kind: "ok", meta: "1.3s" },
  { text: "portfolio.pages.dev", kind: "live", meta: "26.0s" },
];

/** A looping, illustrative deploy that types itself out in a small terminal window. */
export function DeployDemo() {
  const [shown, setShown] = useState(DEMO_LINES.length);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    setShown(0);
    let step = 0;
    const timer = window.setInterval(() => {
      step = (step + 1) % (DEMO_LINES.length + 4);
      setShown(Math.min(step, DEMO_LINES.length));
    }, 900);
    return () => window.clearInterval(timer);
  }, []);

  return <figure className="demo" aria-label="Example deploy">
    <div className="demo-bar"><i /><i /><i /><span className="mono">example deploy</span></div>
    <div className="demo-body mono">
      {DEMO_LINES.map((line, index) => <div key={line.text} className={"demo-line demo-" + line.kind + (index < shown ? " demo-in" : "")}>
        {line.kind === "cmd" ? <span className="demo-prompt">$</span> : line.kind === "live" ? <span className="demo-live">●</span> : <span className="demo-ok">✓</span>}
        <span className="demo-text">{line.kind === "live" ? <>live at <b>https://{line.text}</b></> : line.text}</span>
        {line.meta && <span className="demo-meta">{line.meta}</span>}
      </div>)}
      <span className={"demo-cursor" + (shown >= DEMO_LINES.length ? " demo-cursor-done" : "")} />
    </div>
  </figure>;
}

/** Warm light that follows the pointer across tiles and cards. */
export function useSpotlight() {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const onMove = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest?.(".tile, .card, .repo-item") as HTMLElement | null;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--mx", (event.clientX - rect.left) + "px");
      target.style.setProperty("--my", (event.clientY - rect.top) + "px");
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
}
