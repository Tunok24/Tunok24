// Generates ./map.svg from your Worker stats.
// Needs: STATS_URL env var.

import fs from "node:fs/promises";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import iso from "iso-3166-1";

// ---- fetch stats
const STATS_URL = process.env.STATS_URL;
if (!STATS_URL) throw new Error("Missing STATS_URL");
const { data: counts = {} } = await fetch(STATS_URL).then(r => r.json());

// ---- fetch world topojson from CDN (stable)
const worldTopo = await fetch("https://unpkg.com/world-atlas@2/countries-110m.json").then(r => r.json());
const countries = feature(worldTopo, worldTopo.objects.countries).features;

// map alpha-2 -> feature
const byA2 = new Map();
for (const f of countries) {
  const rec = iso.whereNumeric(String(f.id));
  if (rec?.alpha2) byA2.set(rec.alpha2.toUpperCase(), f);
}

// canvas + projection
const width = 1000, height = 520;
const projection = geoMercator().scale((width/(2*Math.PI))*1.1).translate([width/2, height/1.6]);
const path = geoPath(projection);

// base land
const land = countries.map(f => `<path d="${path(f)}" fill="#d1d5db" stroke="#9ca3af" stroke-width="0.5"/>`).join("");

// bubbles
const entries = Object.entries(counts).filter(([,n]) => n>0).map(([cc,n]) => [cc.toUpperCase(), n]).sort((a,b)=>b[1]-a[1]);
const total = entries.reduce((s, [,n]) => s+n, 0);
const max = Math.max(1, ...entries.map(e=>e[1]));
const radius = n => 3 + 25*Math.sqrt(n/max);
const opacity = n => 0.25 + 0.6*Math.sqrt(n/max);

const bubbles = [];
for (const [cc, n] of entries) {
  const feat = byA2.get(cc);
  if (!feat) continue;
  const [cx, cy] = path.centroid(feat);
  bubbles.push(
    `<g><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius(n).toFixed(1)}"
       fill="#d97706" fill-opacity="${opacity(n).toFixed(2)}"
       stroke="#7c2d12" stroke-opacity="${opacity(n).toFixed(2)}"/><title>${cc}: ${n}</title></g>`
  );
}

// legend + title
const title = `Visitors by country • total: ${total}`;
const legendVals = [1, Math.max(1, Math.round(max*0.25)), Math.max(1, Math.round(max*0.6)), max];
const legend = `
  <g transform="translate(${width-180}, ${height-140})" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
    <text x="0" y="-10" font-size="12" fill="#111827">Legend</text>
    ${legendVals.map((v,i) => {
      const rr = radius(v).toFixed(1);
      const y = i*32;
      return `<g transform="translate(0,${y})">
        <circle cx="16" cy="16" r="${rr}" fill="#d97706" fill-opacity="${opacity(v).toFixed(2)}" stroke="#7c2d12" stroke-opacity="${opacity(v).toFixed(2)}"/>
        <text x="42" y="21" font-size="12" fill="#111827">${v}</text>
      </g>`;
    }).join("")}
  </g>`;

// write SVG
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  ${land}
  ${bubbles.join("")}
  <text x="20" y="36" font-size="20" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" fill="#111827">${title}</text>
  <text x="20" y="${height-14}" font-size="12" fill="#6b7280" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
    Updated: ${new Date().toISOString().slice(0,19).replace("T"," ")}
  </text>
  ${legend}
</svg>`;
await fs.writeFile("map.svg", svg, "utf8");
console.log("✅ wrote map.svg");
