#!/usr/bin/env node
// Palette validator: checks hex colors for distinguishability and WCAG contrast on given surface.
const args = process.argv.slice(2);
const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'light';
const surface = args.includes('--surface') ? args[args.indexOf('--surface') + 1] : (mode === 'light' ? '#ffffff' : '#0a0a0a');
const flagVals = new Set([mode, surface]);
const colors = args.filter(a => /^#[0-9a-fA-F]{6}$/.test(a) && !flagVals.has(a));
if (colors.length < 2) { console.error('need ≥2 hex colors'); process.exit(1); }
const lum = hex => { const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4); return 0.2126*r + 0.7152*g + 0.0722*b; };
const contrast = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x,y) => y-x); return (l1+0.05)/(l2+0.05); };
const surfLum = lum(surface);
let issues = [];
for (const c of colors) {
  const ct = contrast(c, surface);
  if (ct < 3.0) issues.push(`${c}: contrast ${ct.toFixed(1)} on ${surface} < 3.0`);
}
for (let i = 0; i < colors.length; i++) for (let j = i+1; j < colors.length; j++) {
  const ct = contrast(colors[i], colors[j]);
  if (ct < 1.3) issues.push(`${colors[i]} vs ${colors[j]}: contrast ${ct.toFixed(2)} < 1.3 (indistinguishable)`);
}
if (issues.length) { console.error('FAIL:\n' + issues.join('\n')); process.exit(1); }
console.log(`PASS: ${colors.length} colors, min surface contrast ${Math.min(...colors.map(c => contrast(c, surface))).toFixed(1)}, mode=${mode}`);
