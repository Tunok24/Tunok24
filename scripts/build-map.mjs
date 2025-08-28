// Generates ./map.svg using counts from your Worker stats endpoint.
//
// Inputs:
//   env.STATS_URL  -> your Cloudflare Worker /stats (returns { data: { US: 12, CA: 5, ... }, total })
//
// Output:
//   ./map.svg (committed by the workflow)

import fs from 'node:fs/promises';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import iso from 'iso-3166-1';
import world110 from 'world-atlas/countries-110m.json' assert { type: 'json' };

// ---- Fetch stats
const STATS_URL = process.env.STATS_URL;
if (!STATS_URL) {
  console.error('Missing STATS_URL env var');
  process.exit(1);
}
const stats = await fetch(STATS_URL).then(r => r.json()).catch(e => (console.error(e), null));
if (!stats || !stats.data) {
  console.error('Could not fetch stats from', STATS_URL);
  process.exit(1);
}
const counts = stats.data; // { "US": 12, "CA": 5, ... }
const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);

// ---- Prep map data
const world = feature(world110, world110.objects.countries).features;

// Build lookup: alpha-2 -> GeoJSON Feature
const byA2 = new Map();
for (const f of world) {
  const rec = iso.whereNumeric(String(f.id)); // e.g., { alpha2: 'US', alpha3: 'USA', ... }
  if (rec && rec.alpha2) byA2.set(rec.alpha2.toUpperCase(), f);
}

// ---- SVG canvas + projection
const width = 1000;
const height = 520;
const projection = geoMercator()
  .scale((width / (2 * Math.PI)) * 1.1) // slightly zoomed
  .translate([width / 2, height / 1.6]);

const path = geoPath(projection);

// ---- Build land paths
const landPaths = world.map(f => `<path d="${path(f)}" fill="#d1d5db" stroke="#9ca3af" stroke-width="0.5"/>`).join('');

// ---- Compute bubble positions
const entries = Object.entries(counts)
  .filter(([, n]) => n > 0)
  .map(([a2, n]) => [a2.toUpperCase(), n])
  .sort((a, b) => b[1] - a[1]);

const max = Math.max(1, ...entries.map(e => e[1]));
// radius: 3..28px (sqrt scale), color opacity 0.25..0.85
function radius(n) { return 3 + 25 * Math.sqrt(n / max); }
function opacity(n) { return 0.25 + 0.6 * Math.sqrt(n / max); }

const bubbles = [];
for (const [a2, n] of entries) {
  const feat = byA2.get(a2);
  if (!feat) continue; // not in world-atlas (e.g., some territories)
  const [cx, cy] = path.centroid(feat);
  const r = radius(n);
  const op = opacity(n);
  // warm orange bubbles; tooltip via <title>
  bubbles.push(
    `<g><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="#d97706" fill-opacity="${op.toFixed(2)}" stroke="#7c2d12" stroke-opacity="${op.toFixed(2)}" />
     <title>${a2}: ${n}</title></g>`
  );
}

// ---- Legend + title
const title = `Visitors by country • total: ${total}`;
const legend = `
  <g transform="translate(${width - 180}, ${height - 140})" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
    <text x="0" y="-10" font-size="12" fill="#111827">Legend</text>
    ${[1, Math.round(max * 0.25) || 1, Math.round(max * 0.6) || 1, max].map((v, i) => {
      const rr = radius(v).toFixed(1);
      const yy = i * 32;
      return `<g transform="translate(0, ${yy})">
        <circle cx="16" cy="16" r="${rr}" fill="#d97706" fill-opacity="${opacity(v).toFixed(2)}" stroke="#7c2d12" stroke-opacity="${opacity(v).toFixed(2)}"></circle>
        <text x="42" y="21" font-size="12" fill="#111827">${v}</text>
      </g>`;
    }).join('')}
  </g>`;

// ---- Compose SVG
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <g transform="translate(0,0)">
    ${landPaths}
    ${bubbles.join('')}
  </g>
  <text x="20" y="36" font-size="20" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" fill="#111827">${title}</text>
  <text x="20" y="${height - 14}" font-size="12" fill="#6b7280" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
    Source: Cloudflare Worker (${new Date().toISOString().slice(0,19).replace('T',' ')})
  </text>
  ${legend}
</svg>`;

await fs.writeFile('map.svg', svg, 'utf8');
console.log('Wrote map.svg with', entries.length, 'countries, total', total);
