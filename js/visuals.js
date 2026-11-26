/* 보고서 시각 요소: 위험도 계기판, 관계도, 레이더, CCTV 캡처, 도청, 포스트잇 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v) => Math.max(0, Math.min(100, Number(v) || 0));
const short = (s, n) => { const a = [...String(s || '')]; return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };

function seed(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
}

/* 위험도 계기판 */
export function gauge(v) {
  const n = clamp(v);
  const ang = -90 + (n / 100) * 180;
  const arc = (from, to, r) => {
    const p = (a) => [100 + r * Math.cos((a - 180) * Math.PI / 180), 100 + r * Math.sin((a - 180) * Math.PI / 180)];
    const [x1, y1] = p(from * 1.8);
    const [x2, y2] = p(to * 1.8);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = (i * 18 - 180) * Math.PI / 180;
    const r1 = i % 5 ? 70 : 64;
    return `<line x1="${(100 + r1 * Math.cos(a)).toFixed(1)}" y1="${(100 + r1 * Math.sin(a)).toFixed(1)}" x2="${(100 + 76 * Math.cos(a)).toFixed(1)}" y2="${(100 + 76 * Math.sin(a)).toFixed(1)}"/>`;
  }).join('');
  return `<svg class="gauge" viewBox="0 0 200 108" style="--ang:${ang}deg" aria-hidden="true">
      <path class="g-bg" d="${arc(0, 100, 84)}"/>
      <path class="g-low" d="${arc(0, 40, 84)}"/><path class="g-mid" d="${arc(40, 70, 84)}"/><path class="g-high" d="${arc(70, 100, 84)}"/>
      <g class="g-ticks">${ticks}</g>
      <g class="g-needle"><line x1="100" y1="100" x2="100" y2="34"/><circle cx="100" cy="100" r="6"/></g>
    </svg>`;
}

/* 관계도: 가운데 대상, 둘레에 관계 인물, 관찰자는 점선으로 지켜본다 */
export function relationMap(f) {
  const obs = f.observer?.name || 'UNKNOWN';
  const pc = f.pc || 'PC';
  const nodes = f.relations.slice(0, 5).map((r) => ({ who: r.who, text: r.text, st: r.st, real: r.real, pc: r.who === pc, obs: r.who === obs }));
  if (!nodes.some((n) => n.obs)) nodes.push({ who: obs, text: f.mode === 2 ? '정체 미상 · 감시 중' : '이 보고서의 관찰자', obs: true, extra: true });
  const N = nodes.length;
  const pos = nodes.map((_, i) => {
    const a = (-90 + (360 / N) * i + (N % 2 ? 0 : 180 / N)) * Math.PI / 180;
    return [50 + 38 * Math.cos(a), 50 + 36 * Math.sin(a)];
  });
  const lines = pos.map(([x, y], i) => `<line x1="50" y1="50" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="${nodes[i].obs ? 'l-obs' : nodes[i].pc ? 'l-pc' : ''}"/>`).join('');
  return `<div class="rmap" aria-label="대인관계도">
    <svg class="rmap-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
    <div class="rnode r-center" style="--x:50%;--y:50%"><span class="rn-tag">SUBJECT</span><b>${esc(f.subject)}</b></div>
    ${nodes.map((n, i) => `<div class="rnode${n.pc ? ' r-pc' : ''}${n.obs ? ' r-obs' : ''}" style="--x:${pos[i][0].toFixed(1)}%;--y:${pos[i][1].toFixed(1)}%">
      <span class="rn-tag">${n.obs ? '◉ OBSERVER' : n.pc ? 'PC' : 'CONTACT'}</span>
      <b>${esc(n.who)}</b>
      <span class="rn-t">${esc(short(n.text, 30))}</span>
    </div>`).join('')}
  </div>`;
}

/* 레이더 차트 */
export function radar(psych) {
  const items = psych.slice(0, 6);
  if (items.length < 3) return '';
  const N = items.length;
  const c = 150;
  const R = 92;
  const pt = (i, r) => {
    const a = (-90 + (360 / N) * i) * Math.PI / 180;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const ring = (k) => items.map((_, i) => pt(i, R * k).map((v) => v.toFixed(1)).join(',')).join(' ');
  const shape = items.map((p, i) => pt(i, R * clamp(p.v) / 100).map((v) => v.toFixed(1)).join(',')).join(' ');
  const labels = items.map((p, i) => {
    const [x, y] = pt(i, R + 26);
    const anchor = Math.abs(x - c) < 8 ? 'middle' : x > c ? 'start' : 'end';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle"><tspan>${esc(p.k)}</tspan><tspan class="rv" dx="5">${clamp(p.v)}</tspan></text>`;
  }).join('');
  return `<figure class="radar"><svg viewBox="-20 0 340 300" role="img" aria-label="성향 레이더: ${items.map((p) => `${esc(p.k)} ${clamp(p.v)}`).join(', ')}">
    ${[0.25, 0.5, 0.75, 1].map((k) => `<polygon class="rg" points="${ring(k)}"/>`).join('')}
    ${items.map((_, i) => { const [x, y] = pt(i, R); return `<line class="rg" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')}
    <polygon class="rs" points="${shape}"/>
    ${items.map((p, i) => { const [x, y] = pt(i, R * clamp(p.v) / 100); return `<circle class="rd" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>`; }).join('')}
    <g class="rl">${labels}</g>
  </svg></figure>`;
}

/* CCTV 캡처 */
export function cctv(notes, body) {
  if (!notes.length) return '<p class="nodata">DATA NOT FOUND</p>';
  return `<div class="cams">${notes.map((n, i) => `<figure class="cam">
    <div class="cam-screen">
      <span class="cam-id">CAM ${String(i + 1).padStart(2, '0')}</span>
      <span class="cam-rec">● REC</span>
      <span class="cam-loc">${esc(n.where || 'LOCATION UNKNOWN')}</span>
      <span class="cam-time">${esc(n.when || '--:--')}</span>
      <span class="cam-cross" aria-hidden="true"></span>
    </div>
    <figcaption>${body(n.text, n.st)}</figcaption>
  </figure>`).join('')}</div>`;
}

/* 도청 기록: 재생을 누르면 파형이 움직이고 대사가 나온다 */
export function wiretap(list) {
  if (!list.length) return '<p class="nodata">DATA NOT FOUND</p>';
  return `<div class="taps">${list.map((t, i) => {
    const r = seed(t.said);
    const bars = Array.from({ length: 36 }, () => `<i style="--h:${(18 + r() * 82).toFixed(0)}%"></i>`).join('');
    const len = Math.max(3, Math.round([...t.said].length / 4));
    return `<div class="tap">
      <p class="tap-h"><span>INTERCEPT #${String(i + 1).padStart(2, '0')}</span><span>${esc(t.where || '상황 미상')}</span><span>00:${String(len).padStart(2, '0')}</span></p>
      <div class="tap-row">
        <button class="tap-play" type="button" data-act="play" aria-label="도청 기록 ${i + 1} 재생">▶</button>
        <div class="wave" aria-hidden="true">${bars}</div>
      </div>
      <p class="tap-q" data-said="${esc(t.said)}"><span class="tap-hidden">[재생을 눌러 청취]</span></p>
    </div>`;
  }).join('')}</div>`;
}

/* 관찰자가 여백에 갈겨쓴 포스트잇 */
export function stickies(list, key) {
  if (!list.length) return '';
  const r = seed(key);
  return `<div class="stickies">${list.slice(0, 4).map((t) => `<p class="sticky" style="--r:${(r() * 8 - 4).toFixed(1)}deg">${esc(t)}</p>`).join('')}</div>`;
}

/* 사건 타임라인 */
export function timeline(incidents, trigger) {
  const rows = incidents.map((i, n) => ({ ...i, n: n + 1 }));
  if (!rows.length && !trigger) return '<p class="nodata">DATA NOT FOUND</p>';
  return `<ol class="tline">
    ${rows.map((i) => `<li class="${trigger && i.name.includes(trigger) ? 'is-trig' : ''}"><span class="tl-n">CASE ${String(i.n).padStart(2, '0')}</span><b>${esc(i.name)}</b><p>${esc(i.text)}</p></li>`).join('')}
    ${trigger ? `<li class="is-now"><span class="tl-n">NOW</span><b>「${esc(trigger)}」 이후 이 보고서 작성</b><p>계기 사건에 따라 추가된 기록.</p></li>` : ''}
  </ol>`;
}
