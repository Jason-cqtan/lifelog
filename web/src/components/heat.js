import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Shared pieces of the one-hue heatmap scale used by the yearly and all-time views.
import { useEffect } from 'react';
import { useI18n } from '../i18n';
// color-mix percentage of the category color per intensity level
export const LEVEL_MIX = [0, 28, 52, 76, 100];
/**
 * Returns a value -> level (0-4) function. Quartiles of the non-zero values pick
 * the four levels, so one huge outlier does not wash out everything else.
 */
export function quartileLevels(values) {
    const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
    const q = [0.25, 0.5, 0.75].map((p) => nz[Math.floor(p * (nz.length - 1))] ?? 0);
    return (v) => (v <= 0 ? 0 : v <= q[0] ? 1 : v <= q[1] ? 2 : v <= q[2] ? 3 : 4);
}
export function levelFill(color, level) {
    return level === 0 ? 'var(--cell-empty)' : `color-mix(in oklab, ${color} ${LEVEL_MIX[level]}%, var(--surface))`;
}
export function Scale({ color }) {
    const { t } = useI18n();
    return (_jsxs("div", { className: "scale", "aria-hidden": true, children: [t.less, LEVEL_MIX.map((_, i) => (_jsx("i", { style: { background: levelFill(color, i) } }, i))), t.more] }));
}
/**
 * Hover tooltip anchored above a point given in viewport coordinates. It is
 * position: fixed so the heatmap's horizontal scroll container cannot clip it,
 * and it hides on any scroll since the anchor would then be stale.
 */
export function Tooltip({ x, y, onScroll, children }) {
    useEffect(() => {
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });
        return () => window.removeEventListener('scroll', onScroll, { capture: true });
    }, [onScroll]);
    // keep the centered bubble on screen near the left/right edges
    const left = Math.min(Math.max(x, 72), window.innerWidth - 72);
    return (_jsx("div", { className: "tooltip", style: { left, top: y }, children: children }));
}
/** Converts a point in an SVG's viewBox units to viewport coordinates. */
export function toViewport(svg, viewWidth, x, y) {
    const r = svg.getBoundingClientRect();
    const k = r.width / viewWidth;
    return { x: r.left + x * k, y: r.top + y * k };
}
/**
 * Saves a heatmap as a PNG: a title, a stats line and the grid, on the current
 * theme's surface. CSS variables don't resolve inside a standalone SVG, so every
 * mark's computed color is copied onto the clone first.
 */
export async function downloadHeatmapPng(svg, title, subtitle, filename) {
    const css = getComputedStyle(svg.closest('.panel') ?? document.body);
    const surface = css.backgroundColor;
    const ink = getComputedStyle(document.body).color;
    const muted = getComputedStyle(svg.querySelector('.axis-label') ?? svg).fill || ink;
    const clone = svg.cloneNode(true);
    const src = svg.querySelectorAll('rect, text');
    clone.querySelectorAll('rect, text').forEach((el, i) => {
        const cs = getComputedStyle(src[i]);
        el.setAttribute('fill', cs.fill);
        el.removeAttribute('class');
        if (el.tagName === 'rect')
            el.setAttribute('stroke', 'none');
        else
            el.setAttribute('style', `font: ${cs.fontSize} system-ui, -apple-system, sans-serif`);
    });
    const w = Number(svg.getAttribute('width'));
    const h = Number(svg.getAttribute('height'));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    const pad = 24;
    const head = 56;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = (w + pad * 2) * scale;
    canvas.height = (h + pad * 2 + head) * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, w + pad * 2, h + pad * 2 + head);
    ctx.fillStyle = ink;
    ctx.font = '600 17px system-ui, -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(title, pad, pad + 14);
    ctx.fillStyle = muted;
    ctx.font = '13px system-ui, -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(subtitle, pad, pad + 36);
    ctx.drawImage(img, pad, pad + head, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob)
        return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function DownloadButton({ onClick }) {
    const { t } = useI18n();
    return (_jsx("button", { className: "dl-btn", onClick: onClick, title: t.downloadPng, "aria-label": t.downloadPng, children: _jsx("svg", { viewBox: "0 0 24 24", width: "15", height: "15", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, children: _jsx("path", { d: "M12 4v11M7 10l5 5 5-5M5 20h14" }) }) }));
}
