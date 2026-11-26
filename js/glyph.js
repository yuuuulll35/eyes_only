function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => { s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) | 0; s ^= s + Math.imul(s ^ (s >>> 7), 61 | s); return ((s ^ (s >>> 14)) >>> 0) / 4294967296; };
}

export function glyph(name, { size = 120 } = {}) {
  const r = rng(hash(name));
  const c = 60;
  const tilt = (r() - 0.5) * 40;
  const squash = 0.78 + r() * 0.12;
  const wobA = 1 + Math.floor(r() * 3);
  const wobB = 3 + Math.floor(r() * 3);
  const phase = r() * Math.PI * 2;
  let d = '';
  const rings = 13;
  for (let i = 0; i < rings; i++) {
    const base = 5 + i * 3.6;
    const gapAt = r() * Math.PI * 2;
    const gapLen = 0.25 + r() * 0.7 + (i < 3 ? 0.8 : 0);
    const steps = 64;
    let pen = false;
    for (let k = 0; k <= steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const da = Math.abs(((a - gapAt + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < gapLen / 2) { pen = false; continue; }
      const rr = base * (1 + 0.06 * Math.sin(a * wobA + phase + i * 0.4) + 0.03 * Math.sin(a * wobB - phase));
      const x = c + Math.cos(a) * rr * squash;
      const y = c + 4 + Math.sin(a) * rr * (a > Math.PI ? 1.08 : 0.94);
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
    }
  }
  const dots = Array.from({ length: 3 }, () => {
    const a = r() * Math.PI * 2;
    const rr = 12 + r() * 28;
    return `<circle cx="${(c + Math.cos(a) * rr * squash).toFixed(1)}" cy="${(c + 4 + Math.sin(a) * rr).toFixed(1)}" r="1.6"/>`;
  }).join('');
  return `<svg class="glyph" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true" focusable="false"><g transform="rotate(${tilt.toFixed(1)} 60 64)"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><g fill="currentColor">${dots}</g></g></svg>`;
}

export function code(name) {
  return hash(name).toString(16).toUpperCase().padStart(8, '0').replace(/(.{4})/, '$1-');
}
