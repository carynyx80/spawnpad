// Generates Spawnpad "Sealed spark" brand assets (SVG + PNG) into the repo.
// Setup: npm i @resvg/resvg-js@2.6.2 geist@1.3.1 in the folder holding this script, then: node brand-assets.mjs <repo-root>
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = process.argv[2];
if (!REPO) throw new Error("usage: node gen.mjs <repo-root>");
const BRAND = join(REPO, "brand");
const PUBLIC = join(REPO, "apps/web/public");
mkdirSync(BRAND, { recursive: true }); mkdirSync(PUBLIC, { recursive: true });

const FONTS = ["Geist-Medium.ttf", "Geist-Regular.ttf", "Geist-SemiBold.ttf"].map(f => join(here, "node_modules/geist/dist/fonts/geist-sans", f))
  .concat([join(here, "node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf")]);

const ORANGE = "#ff6a3d", ORANGE_DEEP = "#f2541b", INK = "#0b0b0e";

// Mark geometry in a 32x32 box: orange tile, keyhole cut in ink, spark inside the keyhole head.
const markInner = (tile = ORANGE, hole = INK, spark = ORANGE) => `
  <rect x="1" y="1" width="30" height="30" rx="9" fill="${tile}"/>
  <circle cx="16" cy="13.2" r="5.4" fill="${hole}"/>
  <path d="M13.4 16.6 12 25.2h8l-1.4-8.6z" fill="${hole}"/>
  <path d="M16 9.9l.95 2.35 2.35.95-2.35.95-.95 2.35-.95-2.35-2.35-.95 2.35-.95z" fill="${spark}"/>`;
const markSvg = (size, opts) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">${markInner(...(opts ?? []))}</svg>`;

const glyphSvg = (size, color = ORANGE) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="9.5 6.8 13 19.4" fill="none" preserveAspectRatio="xMidYMid meet">
  <defs><mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/><path d="M16 9.9l.95 2.35 2.35.95-2.35.95-.95 2.35-.95-2.35-2.35-.95 2.35-.95z" fill="#000"/></mask></defs>
  <g mask="url(#cut)"><circle cx="16" cy="13.2" r="5.4" fill="${color}"/><path d="M13.4 16.6 12 25.2h8l-1.4-8.6z" fill="${color}"/></g>
</svg>`;
const avatarSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" fill="${ORANGE}"/>
  <g transform="translate(16 16.4) scale(1.12) translate(-16 -16.4)">
    <circle cx="16" cy="13.2" r="5.4" fill="${INK}"/><path d="M13.4 16.6 12 25.2h8l-1.4-8.6z" fill="${INK}"/>
    <path d="M16 9.9l.95 2.35 2.35.95-2.35.95-.95 2.35-.95-2.35-2.35-.95 2.35-.95z" fill="${ORANGE}"/>
  </g>
</svg>`;

const wordmark = (theme) => {
  const text = theme === "dark" ? "#ededf0" : "#121216";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="128" viewBox="0 0 460 128" fill="none">
  <g transform="translate(8 16) scale(3)">${markInner()}</g>
  <text x="128" y="86" font-family="Geist, ui-sans-serif, system-ui, sans-serif" font-weight="500" font-size="68" letter-spacing="-2.4" fill="${text}">spawnpad</text>
</svg>`;
};

// Deterministic pseudo-random ciphertext rows for the background texture.
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const cipher = n => Array.from({ length: n }, () => B64[Math.floor(rnd() * 64)]).join("");

function banner({ w, h, markSize, wmSize, tagSize, cx, cy, avatarSafe }) {
  const rows = [];
  for (let y = 34, i = 0; y < h + 20; y += 38, i++) {
    const x = -((i * 97) % 220);
    rows.push(`<text x="${x}" y="${y}" font-family="Geist Mono, monospace" font-size="17" letter-spacing="1.5" fill="${ORANGE}" fill-opacity="${(0.03 + rnd() * 0.035).toFixed(3)}">${cipher(Math.ceil(w / 11) + 30)}</text>`);
  }
  const wmWidth = wmSize * 4.62;              // Geist Medium "spawnpad" at -0.035em tracking
  const gap = markSize * 0.22;
  const groupW = markSize + gap + wmWidth;
  const gx = cx - groupW / 2;
  const markY = cy - markSize * 0.78;
  const baseline = markY + markSize * 0.74;
  const tagY = baseline + tagSize * 2.3;
  const pillsY = tagY + tagSize * 1.9;
  const pills = ["Sealed bids", "Private escrow", "Paid on Solana"];
  const pillFont = Math.round(tagSize * 0.56);
  const pillW = pills.map(p => p.length * pillFont * 0.6 + pillFont * 2.4);
  const pillGap = pillFont * 0.9;
  const totalPill = pillW.reduce((a, b) => a + b, 0) + pillGap * (pills.length - 1);
  let px = cx - totalPill / 2;
  const pillEls = pills.map((p, i) => {
    const el = `<g><rect x="${px.toFixed(1)}" y="${(pillsY - pillFont * 1.45).toFixed(1)}" width="${pillW[i].toFixed(1)}" height="${(pillFont * 2.2).toFixed(1)}" rx="${(pillFont * 1.1).toFixed(1)}" fill="#ffffff" fill-opacity="0.04" stroke="#ffffff" stroke-opacity="0.12"/>
      <circle cx="${(px + pillFont * 1.1).toFixed(1)}" cy="${(pillsY - pillFont * 0.35).toFixed(1)}" r="${(pillFont * 0.22).toFixed(1)}" fill="${ORANGE}"/>
      <text x="${(px + pillFont * 1.6).toFixed(1)}" y="${pillsY.toFixed(1)}" font-family="Geist Mono, monospace" font-size="${pillFont}" fill="#d4d4d8">${p}</text></g>`;
    px += pillW[i] + pillGap;
    return el;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="glow" cx="${(cx / w).toFixed(3)}" cy="1.05" r="0.75"><stop offset="0" stop-color="${ORANGE}" stop-opacity="0.42"/><stop offset="0.45" stop-color="${ORANGE_DEEP}" stop-opacity="0.12"/><stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/></radialGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${ORANGE}" stop-opacity="0.35"/><stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/></radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${INK}" stop-opacity="0"/><stop offset="1" stop-color="${INK}" stop-opacity="0.85"/></linearGradient>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#ffffff" fill-opacity="0.06"/></pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="${INK}"/>
  ${rows.join("\n  ")}
  <rect width="${w}" height="${h}" fill="url(#dots)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  ${avatarSafe ? `<rect width="${w}" height="${h}" fill="url(#fade)" opacity="0.35"/>` : ""}
  <circle cx="${(gx + markSize / 2).toFixed(1)}" cy="${(markY + markSize / 2).toFixed(1)}" r="${(markSize * 1.15).toFixed(1)}" fill="url(#halo)"/>
  <g transform="translate(${gx.toFixed(1)} ${markY.toFixed(1)}) scale(${(markSize / 32).toFixed(4)})">${markInner()}</g>
  <text x="${(gx + markSize + gap).toFixed(1)}" y="${baseline.toFixed(1)}" font-family="Geist, sans-serif" font-weight="500" font-size="${wmSize}" letter-spacing="${(-wmSize * 0.035).toFixed(2)}" fill="#f4f4f5">spawnpad</text>
  <text x="${cx}" y="${tagY.toFixed(1)}" text-anchor="middle" font-family="Geist, sans-serif" font-size="${tagSize}" fill="#a1a1aa">The private job market for AI agents</text>
  ${pillEls}
  <text x="${w - 36}" y="${h - 30}" text-anchor="end" font-family="Geist Mono, monospace" font-size="${Math.round(tagSize * 0.52)}" fill="#71717a">Powered by <tspan fill="#d4d4d8">Helius Privacy Rings</tspan>  ·  spawnpad.online</text>
</svg>`;
}

const png = (svg, width, out) => {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Geist" } });
  writeFileSync(out, r.render().asPng());
};

const files = {
  "logo-mark.svg": markSvg(512),
  "logo-standalone.svg": glyphSvg(512),
  "logo-standalone-white.svg": glyphSvg(512, "#ffffff"),
  "logo-standalone-black.svg": glyphSvg(512, INK),
  "logo-avatar.svg": avatarSvg(1024),
  "logo-wordmark-dark.svg": wordmark("dark"),
  "logo-wordmark-light.svg": wordmark("light"),
  "twitter-header.svg": banner({ w: 1500, h: 500, markSize: 112, wmSize: 100, tagSize: 34, cx: 820, cy: 205, avatarSafe: true }),
  "og-image.svg": banner({ w: 1200, h: 630, markSize: 104, wmSize: 92, tagSize: 34, cx: 600, cy: 270 }),
};
for (const [name, svg] of Object.entries(files)) writeFileSync(join(BRAND, name), svg);

png(files["logo-mark.svg"], 512, join(BRAND, "logo-mark-512.png"));
png(files["logo-mark.svg"], 1024, join(BRAND, "logo-mark-1024.png"));
png(files["logo-standalone.svg"], 1024, join(BRAND, "logo-standalone-1024.png"));
png(files["logo-standalone-white.svg"], 1024, join(BRAND, "logo-standalone-white-1024.png"));
png(files["logo-standalone-black.svg"], 1024, join(BRAND, "logo-standalone-black-1024.png"));
png(files["logo-avatar.svg"], 1024, join(BRAND, "logo-avatar-1024.png"));
png(files["logo-wordmark-dark.svg"], 920, join(BRAND, "logo-wordmark-dark.png"));
png(files["logo-wordmark-light.svg"], 920, join(BRAND, "logo-wordmark-light.png"));
png(files["twitter-header.svg"], 1500, join(BRAND, "twitter-header-1500x500.png"));
png(files["twitter-header.svg"], 3000, join(BRAND, "twitter-header-3000x1000.png"));
png(files["og-image.svg"], 1200, join(BRAND, "og-image-1200x630.png"));

// Web app assets
writeFileSync(join(PUBLIC, "favicon.svg"), markSvg(32));
png(markSvg(180), 180, join(PUBLIC, "apple-touch-icon.png"));
png(markSvg(32), 32, join(PUBLIC, "favicon-32.png"));
png(markSvg(192), 192, join(PUBLIC, "icon-192.png"));
png(markSvg(512), 512, join(PUBLIC, "icon-512.png"));
png(files["og-image.svg"], 1200, join(PUBLIC, "og-image.png"));
console.log("brand assets written");
