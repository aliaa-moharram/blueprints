// Accent colour handling, shared by the admin form preview and the page renderer.
// The accent is used as text on the dark header, as a background behind dark text
// (pills, buttons) and for decorative marks on white. A client colour is nudged just
// enough to stay readable in those places.

export const LEAN_ACCENT = '#3dd68c';
const DARK = '#1c2024'; // header and section background
const DARK_INK = '#0f2a1e'; // Lean's text colour on its green
const WHITE = '#ffffff';

export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : null;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]) {
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function mix(hex, target, t) {
  const a = rgb(hex);
  const b = rgb(target);
  return toHex(a.map((c, i) => c + (b[i] - c) * t));
}

// Returns { accent, ink, adjusted, note } for a chosen colour.
//  - accent must stand out on the dark header (contrast >= 3)
//  - accent must not vanish on white (contrast >= 1.3)
//  - ink is the text colour placed on the accent (dark or white, whichever reads better)
export function resolveAccent(input) {
  const original = normalizeHex(input);
  if (!original) return { accent: LEAN_ACCENT, ink: DARK_INK, adjusted: false, note: 'Not a valid colour, so Lean green is used.' };
  let accent = original;
  let note = '';
  for (let i = 1; i <= 20 && contrast(accent, DARK) < 3; i++) accent = mix(original, WHITE, i * 0.05);
  if (accent !== original) note = 'Lightened slightly so it stands out on the dark header.';
  if (contrast(accent, WHITE) < 1.3) {
    const base = accent;
    for (let i = 1; i <= 20 && contrast(accent, WHITE) < 1.3; i++) accent = mix(base, DARK, i * 0.04);
    note = 'Darkened slightly so it stays visible on white.';
  }
  const ink = contrast(accent, DARK_INK) >= contrast(accent, WHITE) ? DARK_INK : WHITE;
  return { accent, ink, adjusted: accent !== original, note };
}

export function themeFor(theme) {
  if (!theme || theme.mode !== 'client') return { accent: LEAN_ACCENT, ink: DARK_INK, adjusted: false, note: '' };
  return resolveAccent(theme.color);
}
