import { buildPrompt, parse, MODES } from './ooc.js';
import { SAMPLES } from './data.js';
import * as store from './store.js';
import { glyph, code } from './glyph.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const MENU = [
  ['index', '메인 대시보드'],
  ['subjects', '조사 대상 목록'],
  ['dossiers', '상세 조사 보고서'],
  ['field_notes', '현장 관찰 기록'],
  ['psychological', '성향 · 행동 패턴'],
  ['classified', '열람 제한 기록'],
  ['incident_log', '특이 사건 기록'],
];

const ST = {
  fact: { tag: '확인', cls: 'fact' },
  guess: { tag: '추정', cls: 'guess' },
  error: { tag: '오인', cls: 'error' },
  unknown: { tag: '미확인', cls: 'unknown' },
};

const view = $('#view');
const crumb = $('#crumb');
let audit = store.pref.get('audit') === '1';
let shared = null;

/* ---------- 공통 ---------- */

function fmtDate(iso, withTime = true) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '----.--.--';
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  return withTime ? `${day} ${p(d.getHours())}:${p(d.getMinutes())}` : day;
}

function toast(msg, tone = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.dataset.tone = tone;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

const nf = (text) => /data\s*not\s*found/i.test(text);
function body(text, st = '') {
  if (st === 'unknown' || nf(text)) {
    const rest = String(text).replace(/data\s*not\s*found[.\s·]*/i, '').trim();
    return `<span class="nf" data-text="DATA NOT FOUND">DATA NOT FOUND</span>${rest ? ` <span class="nf-note">${esc(rest)}</span>` : ''}`;
  }
  return esc(text);
}

function stTag(st) {
  const shown = st === 'error' && !audit ? 'fact' : st;
  const s = ST[shown] || ST.guess;
  return `<span class="st st-${s.cls}">${s.tag}</span>`;
}

function entry(item, { label = '' } = {}) {
  const isErr = item.st === 'error';
  const errOn = isErr && audit;
  return `<li class="ent${errOn ? ' is-err' : ''}${item.st === 'guess' ? ' is-guess' : ''}">
    ${label ? `<span class="ent-k">${esc(label)}</span>` : ''}
    <span class="ent-v"><span class="ent-t">${body(item.text, item.st)}</span>${errOn && item.real ? `<span class="ent-fix"><b>검수 정정</b> ${esc(item.real)}</span>` : ''}</span>
    ${stTag(item.st)}
  </li>`;
}

function threatWord(v) {
  return v >= 70 ? '높음' : v >= 40 ? '주의' : '낮음';
}

function grade(v) {
  if (v == null) return '—';
  return v >= 80 ? 'A' : v >= 60 ? 'B' : v >= 40 ? 'C' : 'D';
}

function accuracy(f) {
  const items = [...f.profile, ...f.look, ...f.traits, ...f.likes, ...f.dislikes, ...f.relations];
  const c = { fact: 0, guess: 0, error: 0, unknown: 0 };
  items.forEach((i) => { c[i.st] = (c[i.st] || 0) + 1; });
  const judged = c.fact + c.guess + c.error;
  const pct = judged ? Math.round(((c.fact + c.guess * 0.5) / judged) * 100) : null;
  return { ...c, total: items.length, pct };
}

function bar(v, cls = '') {
  const n = Math.max(0, Math.min(100, Number(v) || 0));
  return `<span class="meter ${cls}" role="img" aria-label="${n} / 100"><i style="--v:${n}%"></i></span>`;
}

function blocks(v) {
  const n = Math.round((Math.max(0, Math.min(100, Number(v) || 0)) / 100) * 20);
  return `<span class="blocks" aria-hidden="true">${'█'.repeat(n)}<span>${'░'.repeat(20 - n)}</span></span>`;
}

function subjects() {
  const map = new Map();
  for (const f of store.all()) {
    const k = f.subject;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(f);
  }
  return [...map.entries()].map(([name, list]) => ({ name, files: list }));
}

const modeChip = (m) => `<span class="mode m${m}">${MODES[m]?.code || 'MODE ??'}</span>`;
const fileLink = (f) => `#/dossiers/${encodeURIComponent(f.id)}`;
const subjLink = (name) => `#/subjects/${encodeURIComponent(name)}`;
const obsName = (f) => f.observer?.name || 'UNKNOWN';

function empty(msg = 'NO RECORDS ON FILE') {
  return `<section class="empty">
    <p class="empty-big blink-soft">${esc(msg)}</p>
    <p class="empty-sub">등록된 관찰 기록이 없습니다. 새 보고서를 접수하거나 예시 기록을 열람하십시오.</p>
    <div class="row-acts">
      <a class="btn solid" href="#/intake">+ 새 보고서 접수</a>
      <button class="btn" type="button" data-act="samples">예시 기록 불러오기</button>
    </div>
  </section>`;
}

function head(no, en, ko, extra = '') {
  return `<header class="vh">
    <p class="vh-no">${esc(no)}</p>
    <h1 class="vh-title" tabindex="-1"><span class="en">${esc(en)}</span><span class="ko">${esc(ko)}</span></h1>
    ${extra}
  </header>`;
}

/* ---------- index ---------- */

function vIndex() {
  const list = store.all();
  const subs = subjects();
  const observers = new Set(list.map(obsName));
  const incidents = list.reduce((n, f) => n + f.incidents.length, 0);
  const locked = list.reduce((n, f) => n + f.restricted.length + f.sealed.length, 0);
  const errata = list.reduce((n, f) => n + accuracy(f).error, 0);
  const maxT = (x) => Math.max(-1, ...x.files.map((f) => f.threat ?? -1));
  const hot = subs.slice().sort((a, b) => maxT(b) - maxT(a) || b.files.length - a.files.length)[0];

  const stats = [
    ['FILES', '보고서', list.length, '#/dossiers'],
    ['SUBJECTS', '조사 대상', subs.length, '#/subjects'],
    ['OBSERVERS', '관찰자', observers.size, '#/psychological'],
    ['INCIDENTS', '특이 사건', incidents, '#/incident_log'],
    ['RESTRICTED', '열람 제한', locked, '#/classified'],
  ];

  return `${head('00 / INDEX', 'CONFIDENTIAL PERSONNEL OBSERVATION DATABASE', '비밀 인물 조사 및 관찰 기록 아카이브',
    `<p class="vh-line">접속 ${esc(fmtDate(new Date().toISOString()))} · 열람자 ${esc(session())} · 저장 ${store.isPersistent() ? '이 브라우저' : '<b class="warn">불가 (임시 열람)</b>'}</p>`)}
  <section class="stats" aria-label="조사 현황">
    ${stats.map(([en, ko, n, href]) => `<a class="stat" href="${href}"><span class="stat-en">${en}</span><b class="stat-n">${String(n).padStart(2, '0')}</b><span class="stat-ko">${ko}</span></a>`).join('')}
  </section>

  <section class="grid2">
    <div class="panel">
      <h2 class="ph"><span>SELECT OBSERVER</span><em>관찰자 선택</em></h2>
      <div class="modes">
        ${[1, 2].map((m) => `<a class="mode-card" href="#/intake?mode=${m}">
          <span class="mc-code">${MODES[m].code}</span>
          <b class="mc-name">${MODES[m].name}</b>
          <span class="mc-desc">${MODES[m].desc}</span>
          <span class="mc-go">접수 개시 →</span>
        </a>`).join('')}
      </div>
    </div>
    <div class="panel">
      <h2 class="ph"><span>RECENT FILES</span><em>최근 보고서</em></h2>
      ${list.length ? `<ol class="recent">${list.slice(0, 5).map((f) => `<li><a href="${fileLink(f)}">
        <span class="r-no">${esc(f.no)}</span>
        <span class="r-main"><b>${esc(f.subject)}</b><span class="r-by">← ${esc(obsName(f))}</span></span>
        <span class="r-title">${esc(f.title || '무제 보고서')}</span>
        <span class="r-date">${esc(fmtDate(f.at, false))}</span></a></li>`).join('')}</ol>`
        : `<p class="nodata">NO RECORDS ON FILE<br><small>등록된 보고서가 없습니다.</small></p>
           <div class="row-acts"><button class="btn" type="button" data-act="samples">예시 기록 불러오기</button></div>`}
    </div>
  </section>

  <section class="grid2">
    <div class="panel">
      <h2 class="ph"><span>PRIORITY SUBJECT</span><em>최고 위험도 대상</em></h2>
      ${hot ? `<a class="hot" href="${subjLink(hot.name)}">
        <span class="hot-g">${glyph(hot.name, { size: 96 })}</span>
        <span class="hot-t"><b>${esc(hot.name)}</b>
        <span>위험도 ${maxT(hot) >= 0 ? maxT(hot) : '—'} · 관찰 보고서 ${hot.files.length}건</span>
        <span class="mono-dim">BIO-ID ${code(hot.name)}</span></span></a>` : '<p class="nodata">DATA NOT FOUND</p>'}
    </div>
    <div class="panel">
      <h2 class="ph"><span>SYSTEM STATUS</span><em>시스템 상태</em></h2>
      <ul class="sys">
        <li><span>기록 보관소</span><b>${list.length ? 'ONLINE' : 'STANDBY'}</b></li>
        <li><span>검수 대기 (오인 기록)</span><b class="${errata ? 'warn' : ''}">${errata}건</b></li>
        <li><span>봉인 문서</span><b class="${locked ? 'alert' : ''}">${list.reduce((n, f) => n + f.sealed.length, 0)}건</b></li>
        <li><span>검수 표시</span><b>${audit ? 'ON' : 'OFF'}</b></li>
      </ul>
      <div class="row-acts"><a class="btn solid" href="#/intake">+ 새 보고서 접수</a></div>
    </div>
  </section>`;
}

/* ---------- subjects ---------- */

function vSubjects() {
  const subs = subjects();
  if (!subs.length) return head('01 / SUBJECTS', 'SUBJECT REGISTRY', '조사 대상 인물 목록') + empty();
  return `${head('01 / SUBJECTS', 'SUBJECT REGISTRY', '조사 대상 인물 목록', `<p class="vh-line">등록 대상 ${subs.length}명 · PC 곁의 인물과, 그 주변을 감시 중인 인물의 파일</p>`)}
  <section class="cards">
    ${subs.map((s) => {
      const facts = s.files.flatMap((f) => f.profile.filter((p) => p.st === 'fact')).slice(0, 2);
      const obs = [...new Set(s.files.map(obsName))];
      const trust = s.files.map((f) => f.trust).filter((v) => v != null);
      const avg = trust.length ? Math.round(trust.reduce((a, b) => a + b, 0) / trust.length) : null;
      return `<a class="card" href="${subjLink(s.name)}">
        <span class="card-g">${glyph(s.name, { size: 88 })}</span>
        <span class="card-b">
          <span class="card-id">SUBJ-${code(s.name)}</span>
          <b class="card-name">${esc(s.name)}</b>
          ${facts.map((p) => `<span class="card-f"><em>${esc(p.label)}</em> ${body(p.text, p.st)}</span>`).join('')}
          <span class="card-obs">관찰자: ${obs.map(esc).join(', ')}</span>
          <span class="card-meta"><span>FILES ${String(s.files.length).padStart(2, '0')}</span><span>위험도 ${Math.max(-1, ...s.files.map((f) => f.threat ?? -1)) >= 0 ? Math.max(...s.files.map((f) => f.threat ?? 0)) : '—'}</span><span>평균 신뢰도 ${avg ?? '—'}</span></span>
        </span>
      </a>`;
    }).join('')}
  </section>`;
}

function vSubject(name) {
  const s = subjects().find((x) => x.name === name);
  if (!s) return head('01 / SUBJECTS', 'SUBJECT NOT FOUND', '등록되지 않은 대상') + `<p class="nodata big">DATA NOT FOUND</p><div class="row-acts"><a class="btn" href="#/subjects">← 대상 목록</a></div>`;
  const files = s.files;
  const facts = [];
  const seen = new Set();
  files.forEach((f) => f.profile.forEach((p) => {
    const key = p.label + '|' + p.text;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({ ...p, by: obsName(f) });
  }));

  const traitMap = new Map();
  files.forEach((f) => f.psych.forEach((p) => {
    if (!traitMap.has(p.k)) traitMap.set(p.k, []);
    traitMap.get(p.k).push({ v: p.v, by: obsName(f), why: p.why, mode: f.mode });
  }));
  const overlaps = [...traitMap.entries()].filter(([, v]) => v.length > 1);

  return `${head('01 / SUBJECTS / ' + code(name), name, '조사 대상 개인 파일', `<p class="vh-line">관찰 보고서 ${files.length}건 · 관찰자 ${new Set(files.map(obsName)).size}명</p>`)}
  <section class="subj">
    <div class="subj-id panel">
      <div class="idbox">${glyph(name, { size: 140 })}<span class="scan" aria-hidden="true"></span></div>
      <p class="mono-dim">BIO-ID ${code(name)}</p>
      <h2 class="ph"><span>MERGED PROFILE</span><em>통합 신상</em></h2>
      <ul class="ents">${facts.map((p) => entry(p, { label: p.label }).replace('</li>', `<span class="ent-src">src: ${esc(p.by)}</span></li>`)).join('')}</ul>
    </div>
    <div class="subj-cmp">
      <h2 class="ph"><span>CROSS-OBSERVER COMPARISON</span><em>관찰자별 평가 대조</em></h2>
      <div class="cmp">
        ${files.map((f) => `<article class="cmp-col panel">
          <p class="cmp-head">${modeChip(f.mode)}<a href="${fileLink(f)}">${esc(f.no)}</a></p>
          <h3 class="cmp-ob">${esc(obsName(f))}<small>${esc(f.observer?.rel || '관계 미상')}</small></h3>
          <p class="cmp-v">${f.verdict ? esc(f.verdict) : '<span class="nf">DATA NOT FOUND</span>'}</p>
          <ul class="psy">${f.psych.slice(0, 4).map((p) => `<li><span>${esc(p.k)}</span>${bar(p.v)}<b>${p.v}</b></li>`).join('')}</ul>
          <p class="cmp-trust">신뢰도 <b>${f.trust ?? '—'}</b> · 등급 <b>${grade(f.trust)}</b></p>
          ${f.comment ? `<p class="memo-line">// ${esc(f.comment)}</p>` : ''}
        </article>`).join('')}
      </div>
      ${overlaps.length ? `<div class="panel">
        <h2 class="ph"><span>DISCREPANCY</span><em>같은 항목, 다른 판정</em></h2>
        <ul class="disc">${overlaps.map(([k, v]) => {
          const vals = v.map((x) => x.v);
          const gap = Math.max(...vals) - Math.min(...vals);
          return `<li><p class="disc-k"><b>${esc(k)}</b><span class="${gap >= 25 ? 'warn' : ''}">편차 ${gap}</span></p>
            ${v.map((x) => `<p class="disc-r"><span>${esc(x.by)}</span>${bar(x.v, 'm' + x.mode)}<b>${x.v}</b></p>`).join('')}</li>`;
        }).join('')}</ul>
      </div>` : ''}
    </div>
  </section>`;
}

/* ---------- dossiers ---------- */

function vDossiers() {
  const list = store.all();
  if (!list.length) return head('02 / DOSSIERS', 'DOSSIER INDEX', '인물별 상세 조사 보고서') + empty();
  return `${head('02 / DOSSIERS', 'DOSSIER INDEX', '인물별 상세 조사 보고서', `<p class="vh-line">보고서 ${list.length}건</p>`)}
  <div class="table-wrap"><table class="tbl">
    <thead><tr><th>FILE NO</th><th>대상</th><th>관찰자</th><th>모드</th><th>제목</th><th>등록</th><th>신뢰도</th></tr></thead>
    <tbody>${list.map((f) => `<tr data-href="${fileLink(f)}">
      <td class="t-no"><a href="${fileLink(f)}">${esc(f.no)}</a></td>
      <td data-l="대상"><b>${esc(f.subject)}</b></td>
      <td data-l="관찰자">${esc(obsName(f))}</td>
      <td data-l="모드">${modeChip(f.mode)}</td>
      <td data-l="제목" class="t-title">${esc(f.title || '무제 보고서')}${f.trigger ? ` <span class="trig">사건 후속</span>` : ''}</td>
      <td data-l="등록">${esc(fmtDate(f.at, false))}</td>
      <td data-l="신뢰도">${f.trust ?? '—'} <span class="dim">(${grade(f.trust)})</span></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function sec(no, en, ko, inner, cls = '') {
  return `<section class="sec ${cls}"><h2 class="sh"><span class="sh-no">${no}</span><span class="sh-en">${en}</span><span class="sh-ko">${ko}</span></h2>${inner}</section>`;
}

function entList(items, opt) {
  return items.length ? `<ul class="ents">${items.map((i) => entry(i, opt ? opt(i) : {})).join('')}</ul>` : '<p class="nodata">DATA NOT FOUND</p>';
}

function vDossier(f, { external = false } = {}) {
  if (!f) return head('02 / DOSSIERS', 'FILE NOT FOUND', '존재하지 않는 보고서') + `<p class="nodata big">DATA NOT FOUND</p><div class="row-acts"><a class="btn" href="#/dossiers">← 보고서 목록</a></div>`;
  const acc = accuracy(f);
  const m = MODES[f.mode] || MODES[1];
  const tot = Math.max(1, acc.total);
  const seg = (k) => `<i class="seg-${k}" style="--w:${(acc[k] / tot) * 100}%"></i>`;

  return `<article class="dossier" data-mode="${f.mode}">
    <header class="d-head">
      <div class="d-meta">
        <p class="d-no">${esc(f.no || 'EO-EXT')}${external ? ' <span class="trig">외부 반입</span>' : ''}</p>
        <p class="d-mode">${modeChip(f.mode)} <span>${m.name}</span></p>
        <h1 class="d-title" tabindex="-1">${esc(f.title || '무제 보고서')}</h1>
        <p class="d-route"><span class="who">${esc(obsName(f))}</span><span class="arrow" aria-hidden="true">──▶</span><span class="who tgt">${esc(f.subject)}</span></p>
        <p class="d-ctx">${f.mode === 2 ? `감시 범위: <b>${esc(f.pc || 'PC')}</b>의 주변` : `보호 대상: <b>${esc(f.pc || 'PC')}</b> · 대상은 그 곁의 인물`}</p>
        <p class="d-sub">관찰자 신분: ${esc(f.observer?.rel || '미상')} · 등록 ${esc(fmtDate(f.at))}</p>
        ${f.threat != null ? `<p class="d-threat"><span>THREAT</span>${bar(f.threat, 'threat')}<b>${f.threat}</b><em>${threatWord(f.threat)}</em>${f.threatWhy ? `<small>${esc(f.threatWhy)}</small>` : ''}</p>` : ''}
        ${f.trigger ? `<p class="d-trig">⚠ 사건 「${esc(f.trigger)}」 발생에 따라 추가된 보고서</p>` : ''}
      </div>
      <div class="stamp" aria-hidden="true"><b>EYES ONLY</b><span>${f.threat != null ? `THREAT ${f.threat}` : `CLASSIFIED · ${grade(f.trust)}`}</span></div>
    </header>

    <div class="d-tools">
      <button class="chip-btn" type="button" data-act="audit" aria-pressed="${audit}">검수 표시 ${audit ? 'ON' : 'OFF'}</button>
      ${acc.error ? `<span class="d-hint">${audit ? `오인 기록 ${acc.error}건 정정 표시 중` : `검수 결과 오인 기록 ${acc.error}건 검출 · 검수 표시로 확인`}</span>` : ''}
      <span class="legend"><span class="st st-fact">확인</span>직접 확인 <span class="st st-guess">추정</span>관찰자 해석${audit ? ' <span class="st st-error">오인</span>사실과 다름' : ''}</span>
    </div>

    <div class="d-body">
      <aside class="d-id panel">
        <div class="idbox">${glyph(f.subject, { size: 150 })}<span class="scan" aria-hidden="true"></span></div>
        <p class="id-name">${esc(f.subject)}</p>
        <p class="mono-dim">BIO-ID ${code(f.subject)}</p>
        <dl class="id-dl">
          <dt>OBSERVER</dt><dd>${esc(obsName(f))}</dd>
          <dt>${f.mode === 2 ? 'WATCHING' : 'NEAR'}</dt><dd>${esc(f.pc || 'PC')}</dd>
          <dt>THREAT</dt><dd>${f.threat ?? '—'} / 100</dd>
          <dt>TRUST</dt><dd>${f.trust ?? '—'} / 100</dd>
          <dt>ACCURACY</dt><dd>${acc.pct ?? '—'}%</dd>
          <dt>STATUS</dt><dd>${f.mode === 2 ? 'UNDER SURVEILLANCE' : 'OBSERVED'}</dd>
        </dl>
      </aside>

      <div class="d-secs">
        ${sec('01', 'PERSONAL DATA', '기본 신상 정보', entList(f.profile, (p) => ({ label: p.label })))}
        ${sec('02', 'IDENTIFYING FEATURES', '외관 및 식별 특징', entList(f.look))}
        ${sec('03', 'BEHAVIOR', '성격 및 행동 양식', entList(f.traits))}
        ${sec('04', 'PREFERENCE / AVERSION', '선호 및 기피 요소', `<div class="two">
          <div><p class="mini">+ 선호</p>${entList(f.likes)}</div>
          <div><p class="mini">− 기피</p>${entList(f.dislikes)}</div></div>`)}
        ${sec('05', 'RELATIONS', '대인관계 분석', entList(f.relations, (r) => ({ label: r.who })))}
        ${sec('06', 'FIELD RECORD', '특이사항 및 관찰 기록', `
          ${f.notes.length ? `<ol class="log">${f.notes.map((n) => `<li><span class="log-t">${esc(n.when || '--:--')}</span><span class="log-p">${esc(n.where || '장소 미상')}</span><span class="log-x">${body(n.text, n.st)}</span></li>`).join('')}</ol>` : '<p class="nodata">DATA NOT FOUND</p>'}
          ${f.incidents.length ? `<p class="mini">! 특이 사건</p><ul class="inc">${f.incidents.map((i) => `<li><b>${esc(i.name)}</b><span>${esc(i.text)}</span></li>`).join('')}</ul>` : ''}`)}
        ${sec('07', 'ASSESSMENT', '조사자의 종합 소견', `
          <p class="verdict">${f.verdict ? esc(f.verdict) : '<span class="nf">DATA NOT FOUND</span>'}</p>
          ${f.psych.length ? `<ul class="psy wide">${f.psych.map((p) => `<li><span>${esc(p.k)}</span>${bar(p.v)}<b>${p.v}</b>${p.why ? `<small>${esc(p.why)}</small>` : ''}</li>`).join('')}</ul>` : ''}`)}
        ${sec('08', 'RELIABILITY', '신뢰도 및 정보 정확도', `
          <div class="rel">
            <div><p class="mini">출처 신뢰도 (관찰자 자기 평가)</p><p class="rel-n">${f.trust ?? '—'}<small>/100 · 등급 ${grade(f.trust)}</small></p>${blocks(f.trust)}<p class="dim">${esc(f.trustWhy || '')}</p></div>
            <div><p class="mini">정보 정확도 (아카이브 검수)</p><p class="rel-n">${acc.pct ?? '—'}<small>%${audit ? '' : ' · 검수 표시 OFF'}</small></p>
              <span class="segbar" aria-hidden="true">${seg('fact')}${seg('guess')}${audit ? seg('error') : ''}${seg('unknown')}</span>
              <p class="segkey"><span class="k-fact">확인 ${acc.fact + (audit ? 0 : acc.error)}</span><span class="k-guess">추정 ${acc.guess}</span>${audit ? `<span class="k-error">오인 ${acc.error}</span>` : ''}<span class="k-unknown">미확인 ${acc.unknown}</span></p></div>
          </div>`)}
        ${(f.restricted.length || f.sealed.length) ? sec('##', 'RESTRICTED', '열람 제한 · 비공개 기록', `
          ${f.restricted.map((r, i) => redacted(r, `${f.id}-${i}`)).join('')}
          ${f.sealed.map((s) => sealed(s)).join('')}`, 'sec-lock') : ''}
        ${f.comment ? `<section class="memo"><p class="memo-h">// PERSONAL NOTE — 공식 기록 외 · 조사자 ${esc(obsName(f))}</p><p class="memo-t" data-type>${esc(f.comment)}</p></section>` : ''}
      </div>
    </div>

    <footer class="d-foot">
      ${external
        ? `<button class="btn solid" type="button" data-act="keep">아카이브에 보관</button><a class="btn" href="#/index">닫기</a>`
        : `<button class="btn" type="button" data-act="share" data-id="${esc(f.id)}">공유 링크 복사</button>
           <button class="btn" type="button" data-act="copyfile" data-id="${esc(f.id)}">텍스트로 복사</button>
           <a class="btn" href="${subjLink(f.subject)}">대상 파일 열기</a>
           <button class="btn danger" type="button" data-act="del" data-id="${esc(f.id)}">파기</button>`}
    </footer>
  </article>`;
}

function redacted(text, key) {
  const len = Math.max(6, Math.min(40, [...text].length));
  return `<div class="redact" data-key="${esc(key)}">
    <p class="redact-t" data-text="${esc(text)}"><span class="bar" style="--n:${len}"></span></p>
    <button class="chip-btn" type="button" data-act="reveal">열람 해제</button>
  </div>`;
}

function sealed(s) {
  return `<div class="sealed">
    <p class="sealed-h"><b>ACCESS DENIED</b><span>${esc(s.name)}</span></p>
    <p class="sealed-w">봉인 사유: ${esc(s.why || '미기재')}</p>
    <button class="chip-btn alert" type="button" data-act="denied">열람 요청</button>
  </div>`;
}

/* ---------- field notes ---------- */

function filterBar(names, current, base) {
  if (names.length < 2) return '';
  return `<nav class="filters" aria-label="대상 필터">
    <a class="chip${!current ? ' on' : ''}" href="${base}">전체</a>
    ${names.map((n) => `<a class="chip${current === n ? ' on' : ''}" href="${base}?s=${encodeURIComponent(n)}">${esc(n)}</a>`).join('')}
  </nav>`;
}

function vNotes(q) {
  const files = store.all();
  if (!files.length) return head('03 / FIELD_NOTES', 'FIELD NOTES', '일상 관찰 및 현장 기록') + empty();
  const names = subjects().map((s) => s.name);
  const cur = q.get('s') || '';
  const pick = files.filter((f) => !cur || f.subject === cur);
  const rows = pick.flatMap((f) => f.notes.map((n) => ({ ...n, f })));
  return `${head('03 / FIELD_NOTES', 'FIELD NOTES', '일상 관찰 및 현장 기록', `<p class="vh-line">현장 기록 ${rows.length}건</p>`)}
  ${filterBar(names, cur, '#/field_notes')}
  ${pick.map((f) => f.notes.length ? `<section class="panel notes">
    <h2 class="ph"><span>${esc(f.no)}</span><em>${esc(obsName(f))} ──▶ ${esc(f.subject)}</em></h2>
    <ol class="log">${f.notes.map((n) => `<li><span class="log-t">${esc(n.when || '--:--')}</span><span class="log-p">${esc(n.where || '장소 미상')}</span><span class="log-x">${body(n.text, n.st)}</span></li>`).join('')}</ol>
    <p class="row-end"><a class="lnk" href="${fileLink(f)}">보고서 열기 →</a></p>
  </section>` : '').join('') || '<p class="nodata big">DATA NOT FOUND</p>'}`;
}

/* ---------- psychological ---------- */

function vPsych(q) {
  const subs = subjects();
  if (!subs.length) return head('04 / PSYCHOLOGICAL', 'BEHAVIORAL ANALYSIS', '성향 · 습관 · 행동 패턴 분석') + empty();
  const cur = q.get('s') || '';
  const pick = subs.filter((s) => !cur || s.name === cur);
  return `${head('04 / PSYCHOLOGICAL', 'BEHAVIORAL ANALYSIS', '성향 · 습관 · 행동 패턴 분석', '<p class="vh-line">수치는 관찰자가 매긴 값입니다. 관찰자가 다르면 같은 성향도 다르게 측정됩니다.</p>')}
  ${filterBar(subs.map((s) => s.name), cur, '#/psychological')}
  ${pick.map((s) => {
    const traits = new Map();
    s.files.forEach((f) => f.psych.forEach((p) => {
      if (!traits.has(p.k)) traits.set(p.k, []);
      traits.get(p.k).push({ ...p, f });
    }));
    return `<section class="panel psyblock">
      <h2 class="ph"><span>${esc(s.name)}</span><em>BIO-ID ${code(s.name)}</em></h2>
      <div class="psy-grid">
        <div>
          <p class="mini">성향 측정치</p>
          <ul class="psy wide">${[...traits.entries()].map(([k, v]) => v.map((p, i) => `<li${i ? ' class="cont"' : ''}><span>${i ? '' : esc(k)}</span>${bar(p.v, 'm' + p.f.mode)}<b>${p.v}</b><small>${esc(obsName(p.f))}${p.why ? ' · ' + esc(p.why) : ''}</small></li>`).join('')).join('')}</ul>
        </div>
        <div>
          <p class="mini">관찰된 행동 양식</p>
          ${s.files.map((f) => `<div class="by"><p class="by-h">${esc(obsName(f))}의 기록</p>${entList(f.traits)}</div>`).join('')}
        </div>
      </div>
    </section>`;
  }).join('')}`;
}

/* ---------- classified ---------- */

function vClassified() {
  const files = store.all();
  if (!files.length) return head('05 / CLASSIFIED', 'CLASSIFIED', '열람 제한 및 비공개 기록') + empty();
  const errata = files.flatMap((f) => [...f.profile, ...f.look, ...f.traits, ...f.likes, ...f.dislikes, ...f.relations].filter((i) => i.st === 'error').map((i) => ({ ...i, f })));
  return `${head('05 / CLASSIFIED', 'CLASSIFIED', '열람 제한 및 비공개 기록', '<p class="vh-line warn">이 구역의 기록은 공식 보고서에서 제외되었습니다. 열람 내역이 남습니다.</p>')}
  <section class="panel">
    <h2 class="ph"><span>PRIVATE ANNOTATIONS</span><em>조사자 비공개 메모</em></h2>
    ${files.map((f) => f.restricted.length ? `<div class="cl-file"><p class="cl-h"><a href="${fileLink(f)}">${esc(f.no)}</a> · ${esc(obsName(f))} ──▶ ${esc(f.subject)}</p>${f.restricted.map((r, i) => redacted(r, `${f.id}-${i}`)).join('')}</div>` : '').join('') || '<p class="nodata">DATA NOT FOUND</p>'}
  </section>
  <section class="panel">
    <h2 class="ph"><span>SEALED DOCUMENTS</span><em>봉인 문서</em></h2>
    ${files.flatMap((f) => f.sealed.map((s) => sealed(s).replace('<p class="sealed-w">', `<p class="sealed-w">${esc(f.subject)} 관련 · `))).join('') || '<p class="nodata">DATA NOT FOUND</p>'}
  </section>
  <section class="panel">
    <h2 class="ph"><span>ERRATA</span><em>검수 정정 기록</em></h2>
    ${errata.length ? (audit
      ? `<ul class="errata">${errata.map((e) => `<li><p class="e-src"><a href="${fileLink(e.f)}">${esc(e.f.no)}</a> · ${esc(obsName(e.f))}의 기록</p><p class="e-old">${esc(e.text)}</p><p class="e-new">→ ${esc(e.real || 'DATA NOT FOUND')}</p></li>`).join('')}</ul>`
      : `<p class="nodata">정정 기록 ${errata.length}건 · 검수 표시가 꺼져 있습니다.</p><div class="row-acts"><button class="chip-btn" type="button" data-act="audit" aria-pressed="false">검수 표시 켜기</button></div>`)
      : '<p class="nodata">DATA NOT FOUND</p>'}
  </section>`;
}

/* ---------- incident log ---------- */

function vIncidents() {
  const files = store.all();
  if (!files.length) return head('06 / INCIDENT_LOG', 'INCIDENT LOG', '특이 사건 및 돌발 상황 기록') + empty();
  const rows = [];
  files.forEach((f) => {
    rows.push({ at: f.at, kind: f.trigger ? 'TRIGGER' : 'FILED', name: f.trigger ? `「${f.trigger}」 후속 보고서 등록` : '보고서 등록', text: `${f.no} · ${obsName(f)} ──▶ ${f.subject} · ${f.title || '무제'}`, f });
    f.incidents.forEach((i) => rows.push({ at: f.at, kind: 'INCIDENT', name: i.name, text: i.text, f }));
  });
  rows.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return `${head('06 / INCIDENT_LOG', 'INCIDENT LOG', '특이 사건 및 돌발 상황 기록', `<p class="vh-line">기록 ${rows.length}건 · 새 사건이 생기면 아래 버튼으로 후속 보고서를 접수하십시오.</p>`)}
  <div class="row-acts top"><a class="btn solid" href="#/intake?trigger=1">! 사건 발생 · 후속 보고서 접수</a></div>
  <ol class="tl">${rows.map((r) => `<li class="tl-${r.kind.toLowerCase()}">
    <span class="tl-at">${esc(fmtDate(r.at))}</span>
    <span class="tl-k">${r.kind}</span>
    <div class="tl-b"><b>${esc(r.name)}</b><p>${esc(r.text)}</p><a class="lnk" href="${fileLink(r.f)}">${esc(r.f.no)} 열기 →</a></div>
  </li>`).join('')}</ol>`;
}

/* ---------- intake ---------- */

const draft = { mode: 1, observer: '', subject: '', pc: '', trigger: '', answer: '' };
try { Object.assign(draft, JSON.parse(store.pref.get('draft') || '{}')); } catch { /* ignore */ }
const saveDraft = () => store.pref.set('draft', JSON.stringify(draft));

function vIntake(q, { first = false } = {}) {
  if (q.get('mode') && vIntake.applied !== location.hash) {
    draft.mode = q.get('mode') === '2' ? 2 : 1;
    vIntake.applied = location.hash;
  }
  const wantTrig = q.get('trigger') === '1';
  const m = draft.mode;
  const openOpt = wantTrig || !!(draft.observer || draft.subject || draft.trigger);
  const top = first
    ? `<header class="vh first-h">
        <p class="vh-no">CONFIDENTIAL PERSONNEL OBSERVATION DATABASE</p>
        <h1 class="vh-title" tabindex="-1"><span class="en">EYES ONLY</span><span class="ko">비밀 인물 조사 및 관찰 기록 아카이브</span></h1>
        <p class="vh-line">그 사람 곁에 누가 있는지 지켜보는 눈. 그리고 그 눈을 지켜보는 또 다른 눈.</p>
      </header>`
    : head('-- / INTAKE', 'NEW OBSERVATION FILE', '새 관찰 보고서 접수');
  return `${top}
  <form class="intake" id="intake" autocomplete="off">
    <section class="step">
      <h2 class="sh"><span class="sh-no">01</span><span class="sh-en">SELECT OBSERVER</span><span class="sh-ko">관찰 방식 선택</span></h2>
      <div class="modes" role="radiogroup" aria-label="관찰 모드">
        ${[1, 2].map((k) => `<label class="mode-card pick">
          <input type="radio" name="mode" value="${k}"${m === k ? ' checked' : ''}>
          <span class="mc-code">${MODES[k].code}</span>
          <b class="mc-name">${MODES[k].name}</b>
          <span class="mc-desc">${MODES[k].desc}</span>
        </label>`).join('')}
      </div>
      <details class="opt"${openOpt ? ' open' : ''}>
        <summary>세부 설정 <em>선택 · 비워 두면 기본값</em></summary>
        <div class="fields">
          ${m === 1
            ? `<label class="fld"><span>관찰자 (NPC) <em>비우면 NPC</em></span><input name="observer" maxlength="20" value="${esc(draft.observer)}" placeholder="예: 차도현"></label>
          <label class="fld"><span>관찰 대상 (PC 주변 인물) <em>비우면 서사에서 고름</em></span><input name="subject" maxlength="20" value="${esc(draft.subject)}" placeholder="예: 강지안"></label>`
            : `<label class="fld"><span>감시 중인 NPC <em>비우면 NPC</em></span><input name="subject" maxlength="20" value="${esc(draft.subject)}" placeholder="예: 차도현"></label>`}
          <label class="fld"><span>PC 이름 <em>비우면 PC</em></span><input name="pc" maxlength="20" value="${esc(draft.pc)}" placeholder="예: 윤해리"></label>
          <label class="fld wide"><span>계기 사건 <em>특정 사건 이후의 추가 보고서로 만들 때</em></span><input name="trigger" maxlength="30" value="${esc(draft.trigger)}" placeholder="예: 정전의 밤"${wantTrig ? ' data-focus' : ''}></label>
        </div>
      </details>
    </section>

    <section class="step">
      <h2 class="sh"><span class="sh-no">02</span><span class="sh-en">OOC</span><span class="sh-ko">요청문 보내고 답 받기</span></h2>
      <p class="hint">OOC를 채팅에 보내고, 받은 답을 통째로 복사해 넣습니다.</p>
      <div class="flow">
        <button class="btn solid" type="button" data-act="copyprompt">OOC 복사</button>
        <span class="flow-arrow" aria-hidden="true">──▶</span>
        <button class="btn solid" type="button" data-act="pasteclip">답 붙여넣기</button>
      </div>
      <div class="manual" id="manual"${draft.answer ? '' : ' hidden'}>
        <textarea name="answer" id="answer" rows="8" spellcheck="false" placeholder="모드: 01&#10;관찰자: 이름 · 대상과의 관계&#10;대상: 이름&#10;…" aria-label="채팅에서 받은 답">${esc(draft.answer)}</textarea>
        <div class="row-acts left">
          <button class="btn solid" type="submit">기록 등록</button>
          <button class="chip-btn" type="button" data-act="clearans">지우기</button>
        </div>
      </div>
      <p class="err" id="err" role="alert" hidden></p>
      <p class="minor">
        <button class="chip-btn" type="button" data-act="manual">직접 붙여넣기</button>
        <button class="chip-btn" type="button" data-act="peek" aria-expanded="false">OOC 내용 보기</button>
        <span class="count" id="pLen"></span>
      </p>
      <pre class="prompt" id="promptView" hidden></pre>
    </section>
    ${first ? '<p class="first-sample"><button class="lnk" type="button" data-act="samples">예시 기록으로 먼저 둘러보기</button></p>' : ''}
  </form>`;
}

function bindIntake() {
  const form = $('#intake');
  if (!form) return;
  const upd = () => {
    const pv = $('#promptView');
    const p = buildPrompt(draft);
    pv.textContent = p;
    $('#pLen').textContent = `${[...p].length}자`;
  };
  upd();
  const trig = form.querySelector('[data-focus]');
  if (trig) trig.focus();
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'mode') {
      const next = Number(t.value) === 2 ? 2 : 1;
      if (next !== draft.mode) { draft.mode = next; draft.subject = ''; }
      saveDraft();
      const y = window.scrollY;
      route().then(() => { window.scrollTo(0, y); $(`input[name="mode"][value="${next}"]`)?.focus({ preventScroll: true }); });
      return;
    } else if (t.name in draft) {
      draft[t.name] = t.value;
    }
    saveDraft();
    upd();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitAnswer();
  });
}

function submitAnswer() {
  const err = $('#err');
  const r = parse(draft.answer);
  if (r.error) {
    err.textContent = r.error;
    err.hidden = false;
    const box = $('#manual');
    if (box && draft.answer) box.hidden = false;
    return;
  }
  err.hidden = true;
  const file = store.add(r.data, { trigger: draft.trigger });
  draft.answer = '';
  draft.trigger = '';
  saveDraft();
  sessionStorageSafe('fresh', file.id);
  location.hash = fileLink(file);
}

function sessionStorageSafe(k, v) {
  try {
    if (v === undefined) { const x = sessionStorage.getItem('eyes_only:' + k); sessionStorage.removeItem('eyes_only:' + k); return x; }
    sessionStorage.setItem('eyes_only:' + k, v);
  } catch { return null; }
  return null;
}

/* ---------- 텍스트 내보내기 ---------- */

function asText(f) {
  const L = [];
  const stw = (s) => (s === 'error' ? (audit ? '오인' : '확인') : ST[s]?.tag || '추정');
  const row = (k, i, extra = '') => L.push(`${k}: ${extra}${i.text} · ${stw(i.st)}${audit && i.st === 'error' && i.real ? ` · 실제: ${i.real}` : ''}`);
  L.push(`[EYES ONLY] ${f.no}`, `모드: ${f.mode === 2 ? '02' : '01'}`, `관찰자: ${obsName(f)}${f.observer?.rel ? ' · ' + f.observer.rel : ''}`, `대상: ${f.subject}`, `PC: ${f.pc || 'PC'}`, `제목: ${f.title}`);
  if (f.threat != null) L.push(`위험도: ${f.threat}${f.threatWhy ? ' · ' + f.threatWhy : ''}`);
  if (f.trigger) L.push(`계기 사건: ${f.trigger}`);
  f.profile.forEach((i) => row('신상', i, `${i.label} · `));
  f.look.forEach((i) => row('외관', i));
  f.traits.forEach((i) => row('성격', i));
  f.likes.forEach((i) => row('선호', i));
  f.dislikes.forEach((i) => row('기피', i));
  f.relations.forEach((i) => row('관계', i, `${i.who} · `));
  f.notes.forEach((n) => L.push(`관찰: ${[n.when, n.where, n.text].filter(Boolean).join(' · ')}`));
  f.incidents.forEach((i) => L.push(`사건: ${i.name} · ${i.text}`));
  f.psych.forEach((p) => L.push(`심리: ${p.k} · ${p.v} · ${p.why}`));
  if (f.verdict) L.push(`소견: ${f.verdict}`);
  if (f.trust != null) L.push(`신뢰도: ${f.trust} · ${f.trustWhy}`);
  f.restricted.forEach(() => L.push('열람 제한: ████████ (ACCESS RESTRICTED)'));
  f.sealed.forEach((s) => L.push(`봉인: ${s.name} · ACCESS DENIED`));
  if (f.comment) L.push(`코멘트: ${f.comment}`);
  return L.join('\n');
}

/* ---------- 연출 ---------- */

const GLYPHS = '#%&@$*+=?/<>01ABCDEFXZ▓▒░';
function scramble(el, text, dur = 700) {
  if (reduced.matches) { el.textContent = text; return; }
  const chars = [...text];
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const n = Math.floor(chars.length * p);
    el.textContent = chars.map((c, i) => (i < n || c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function typeOut(el) {
  const text = el.textContent;
  if (reduced.matches || !text) return;
  const chars = [...text];
  el.textContent = '';
  el.classList.add('typing');
  let i = 0;
  const step = () => {
    if (!el.isConnected) return;
    i += 1 + (chars.length > 80 ? 1 : 0);
    el.textContent = chars.slice(0, i).join('');
    if (i < chars.length) setTimeout(step, 28);
    else el.classList.remove('typing');
  };
  step();
}

function watchMemo() {
  const memo = $('[data-type]', view);
  if (!memo) return;
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) { io.disconnect(); typeOut(memo); }
  }, { threshold: 0.6 });
  io.observe(memo);
}

/* ---------- 라우터 ---------- */

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/index';
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { parts, q: new URLSearchParams(qs || '') };
}

async function route() {
  if (/^#r=[jz][A-Za-z0-9_-]+$/.test(location.hash)) {
    try {
      shared = await store.unpack(location.hash.slice(3));
      render(['shared'], new URLSearchParams());
    } catch (e) {
      shared = null;
      toast('링크를 열 수 없습니다. 주소가 잘렸는지 확인하십시오.', 'alert');
      history.replaceState(null, '', location.pathname + '#/index');
      render(['index'], new URLSearchParams());
    }
    return;
  }
  const { parts, q } = parseHash();
  render(parts, q);
}

function render(parts, q) {
  const [name0 = 'index', arg] = parts;
  const first = !store.all().length && name0 !== 'shared';
  const name = first ? 'intake' : name0;
  document.body.classList.toggle('solo', first);
  let html;
  let navKey = name;
  let path = `~/${name}`;
  switch (first ? 'first' : name) {
    case 'first': html = vIntake(q, { first: true }); navKey = ''; break;
    case 'subjects': html = arg ? vSubject(arg) : vSubjects(); if (arg) path += '/' + arg; break;
    case 'dossiers': html = arg ? vDossier(store.byId(arg)) : vDossiers(); if (arg) path += '/' + (store.byId(arg)?.no || arg); break;
    case 'field_notes': html = vNotes(q); break;
    case 'psychological': html = vPsych(q); break;
    case 'classified': html = vClassified(); break;
    case 'incident_log': html = vIncidents(); break;
    case 'intake': html = vIntake(q); navKey = ''; break;
    case 'shared': html = vDossier(shared, { external: true }); navKey = 'dossiers'; path = '~/inbound/' + (shared?.no || 'EXT'); break;
    default: html = vIndex(); navKey = 'index'; path = '~/index';
  }
  view.innerHTML = html;
  crumb.textContent = path;
  $$('.rail a[data-nav]').forEach((a) => {
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  updateCounts();
  const cur = $('.rail a[aria-current]');
  if (cur && matchMedia('(max-width: 880px)').matches) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  window.scrollTo(0, 0);
  const h1 = $('h1', view);
  if (h1 && render.ready) h1.focus({ preventScroll: true });
  render.ready = true;
  if (name === 'intake') bindIntake();
  const fresh = sessionStorageSafe('fresh');
  if (fresh && name === 'dossiers' && arg === fresh) {
    view.firstElementChild?.classList.add('arrive');
    toast('새 보고서가 아카이브에 등록되었습니다.');
  }
  watchMemo();
}

function updateCounts() {
  const list = store.all();
  const n = {
    subjects: subjects().length,
    dossiers: list.length,
    field_notes: list.reduce((a, f) => a + f.notes.length, 0),
    psychological: list.reduce((a, f) => a + f.psych.length, 0),
    classified: list.reduce((a, f) => a + f.restricted.length + f.sealed.length, 0),
    incident_log: list.reduce((a, f) => a + f.incidents.length, 0),
  };
  $$('.rail [data-count]').forEach((el) => { el.textContent = n[el.dataset.count] != null ? String(n[el.dataset.count]).padStart(2, '0') : ''; });
}

/* ---------- 동작 ---------- */

function loadSamples() {
  if (store.all().some((f) => f.sample)) { toast('예시 기록이 이미 있습니다.'); return; }
  SAMPLES.forEach((s) => {
    const r = parse(s.text);
    if (r.data) store.add(r.data, { at: s.at, trigger: s.trigger, sample: true });
  });
  toast('예시 기록 3건을 불러왔습니다. 모든 인물은 허구의 성인입니다.');
  route();
}

document.addEventListener('click', async (e) => {
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a')) { location.hash = row.dataset.href; return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'samples') loadSamples();
  else if (act === 'audit') {
    audit = !audit;
    store.pref.set('audit', audit ? '1' : '');
    const y = window.scrollY;
    await route();
    window.scrollTo(0, y);
    toast(audit ? '검수 표시 ON · 사실과 다른 기록을 정정해 보여 줍니다.' : '검수 표시 OFF · 관찰자가 쓴 그대로 보여 줍니다.');
  } else if (act === 'reveal') {
    const box = b.closest('.redact');
    const t = $('.redact-t', box);
    if (box.classList.contains('open')) {
      box.classList.remove('open');
      t.innerHTML = `<span class="bar" style="--n:${Math.max(6, Math.min(40, [...t.dataset.text].length))}"></span>`;
      b.textContent = '열람 해제';
    } else {
      box.classList.add('open');
      scramble(t, t.dataset.text);
      b.textContent = '다시 봉인';
    }
  } else if (act === 'denied') {
    const box = b.closest('.sealed');
    box.classList.remove('shake');
    void box.offsetWidth;
    box.classList.add('shake');
    toast('ACCESS DENIED · 열람 권한이 부족합니다.', 'alert');
  } else if (act === 'copyprompt') {
    const ok = await copyText(buildPrompt(draft));
    toast(ok ? 'OOC 요청문을 복사했습니다. 채팅에 보내십시오.' : '복사하지 못했습니다. 내용 보기에서 직접 복사하십시오.', ok ? '' : 'alert');
    if (!ok) { $('#promptView').hidden = false; }
  } else if (act === 'peek') {
    const pv = $('#promptView');
    pv.hidden = !pv.hidden;
    b.setAttribute('aria-expanded', String(!pv.hidden));
    b.textContent = pv.hidden ? '내용 보기' : '내용 닫기';
  } else if (act === 'pasteclip') {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) throw new Error('empty');
      $('#answer').value = t;
      draft.answer = t;
      saveDraft();
      submitAnswer();
    } catch {
      toast('클립보드를 읽지 못했습니다. 입력칸에 직접 붙여 넣으십시오.', 'alert');
      $('#manual').hidden = false;
      $('#answer').focus();
    }
  } else if (act === 'manual') {
    $('#manual').hidden = false;
    $('#answer').focus();
  } else if (act === 'clearans') {
    $('#answer').value = '';
    draft.answer = '';
    saveDraft();
    $('#err').hidden = true;
  } else if (act === 'share') {
    const f = store.byId(b.dataset.id);
    if (!f) return;
    const url = `${location.origin}${location.pathname}#r=${await store.pack(f)}`;
    toast((await copyText(url)) ? '공유 링크를 복사했습니다. 서버에 저장되지 않습니다.' : '복사하지 못했습니다.');
  } else if (act === 'copyfile') {
    const f = store.byId(b.dataset.id);
    if (f) toast((await copyText(asText(f))) ? '보고서를 텍스트로 복사했습니다. 열람 제한 기록은 가려집니다.' : '복사하지 못했습니다.');
  } else if (act === 'del') {
    const f = store.byId(b.dataset.id);
    if (!f) return;
    if (!confirm(`${f.no} 보고서를 파기합니다. 되돌릴 수 없습니다.`)) return;
    store.remove(f.id);
    toast(`${f.no} 파기 완료`);
    location.hash = '#/dossiers';
  } else if (act === 'keep') {
    if (!shared) return;
    const { no, at, trigger, ...data } = shared;
    const f = store.add(data, { at, trigger });
    shared = null;
    toast('외부 보고서를 아카이브에 보관했습니다.');
    location.hash = fileLink(f);
  } else if (act === 'export') {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eyes_only_backup_${fmtDate(new Date().toISOString(), false).replace(/\./g, '')}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('백업 파일을 저장했습니다.');
  } else if (act === 'import') {
    $('#importFile').click();
  } else if (act === 'wipe') {
    if (!store.all().length) { toast('파기할 기록이 없습니다.'); return; }
    if (!confirm('아카이브의 모든 보고서를 파기합니다. 되돌릴 수 없습니다.')) return;
    store.clear();
    toast('모든 기록을 파기했습니다.');
    location.hash = '#/index';
    route();
  }
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const n = store.importList(Array.isArray(data) ? data : data.files);
    toast(`보고서 ${n}건을 반입했습니다.`);
    route();
  } catch {
    toast('백업 파일을 읽지 못했습니다.', 'alert');
  }
});

/* ---------- 부팅 · 시계 ---------- */

function session() {
  let s = sessionStorageSafe('sid');
  if (!s) s = 'GUEST-' + Math.random().toString(16).slice(2, 6).toUpperCase();
  sessionStorageSafe('sid', s);
  return s;
}

function clock() {
  const el = $('#clock');
  const tick = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

function boot() {
  const el = $('#boot');
  const seen = sessionStorageSafe('booted');
  sessionStorageSafe('booted', '1');
  if (seen || reduced.matches || !store.all().length || /^#r=/.test(location.hash)) { el.remove(); return; }
  const lines = [
    'EO-TERM v4.11 // SECURE LINE',
    'HANDSHAKE ........................ OK',
    'DECRYPTING ARCHIVE INDEX ......... OK',
    `RECORDS ON FILE .................. ${String(store.all().length).padStart(3, '0')}`,
    'CLEARANCE ........................ LEVEL 3',
    '',
    '> EYES ONLY. UNAUTHORIZED VIEWING IS LOGGED.',
  ];
  const out = $('.boot-out', el);
  let i = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.classList.add('off');
    setTimeout(() => el.remove(), 450);
  };
  const next = () => {
    if (done) return;
    if (i >= lines.length) { setTimeout(finish, 650); return; }
    out.textContent += (i ? '\n' : '') + lines[i++];
    setTimeout(next, 130 + Math.random() * 120);
  };
  el.addEventListener('click', finish);
  document.addEventListener('keydown', finish, { once: true });
  next();
}

store.load();
session();
clock();
boot();
window.addEventListener('hashchange', route);
route();
