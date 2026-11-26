import { buildPrompt, parse, MODES, josa } from './ooc.js';
import { SAMPLES, SAMPLE_VER } from './data.js';
import * as store from './store.js';
import { glyph } from './glyph.js';
import { gauge, relationMap, radar, cctv, wiretap, chatLog, timeline, memoLine } from './visuals.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const view = $('#view');
const crumb = $('#crumb');
let audit = store.pref.get('audit') === '1';
let shared = null;
let tab = 'incident_log';
let openId = '';
let who = '';

/* 보고서 안의 탭. 순서대로 읽도록 다음 버튼으로 이어진다 */
const TABS = [
  ['incident_log', '사건 일지', (o) => `이 일들 때문에 ${o}의 관찰이 시작됐습니다.`],
  ['dossier', '신상 정보', (o, t) => `${josa(o, '이', '가')} 알아낸 ${t}의 신상과 인간관계 정보`],
  ['field_notes', '미행·도청', (o, t) => `${josa(o, '이', '가')} 몰래 지켜본 ${t}의 모습과 엿들은 말`],
  ['psychological', '성격 분석', (o, t) => `${josa(o, '이', '가')} 분석 및 판단한 ${t}의 성향과 습관입니다.`],
  ['classified', '숨긴 기록', (o) => `공식 보고서에서 지운 ${o}의 속마음`],
  ['overview', '최종 정리', () => ''],
];

const ST = {
  fact: { tag: '확인', cls: 'fact' },
  guess: { tag: '추정', cls: 'guess' },
  error: { tag: '오인', cls: 'error' },
  unknown: { tag: '미확인', cls: 'unknown' },
};

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
  toast.t = setTimeout(() => { t.hidden = true; }, 2800);
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
    return `<span class="nf" data-text="DATA NOT FOUND">DATA NOT FOUND</span> <span class="nf-note">${rest ? esc(rest) : '알아내지 못함'}</span>`;
  }
  return esc(text);
}

function stTag(st) {
  const shown = st === 'error' && !audit ? 'fact' : st;
  const s = ST[shown] || ST.guess;
  return `<span class="st st-${s.cls}">${s.tag}</span>`;
}

function entry(item, label = '') {
  const errOn = item.st === 'error' && audit;
  return `<li class="ent${errOn ? ' is-err' : ''}${item.st === 'guess' ? ' is-guess' : ''}">
    ${label ? `<span class="ent-k">${esc(label)}</span>` : ''}
    <span class="ent-v"><span class="ent-t">${body(item.text, item.st)}</span>${errOn && item.real ? `<span class="ent-fix"><b>실제로는</b> ${esc(item.real)}</span>` : ''}${memoLine(item.memo, who)}</span>
    ${stTag(item.st)}
  </li>`;
}

function entList(items, labelOf) {
  return items.length ? `<ul class="ents">${items.map((i) => entry(i, labelOf ? labelOf(i) : '')).join('')}</ul>` : NODATA;
}

const NODATA = '<p class="nodata">DATA NOT FOUND <small>기록 없음</small></p>';
const grade = (v) => (v == null ? '—' : v >= 80 ? 'A' : v >= 60 ? 'B' : v >= 40 ? 'C' : 'D');
const threatWord = (v) => (v >= 70 ? '높음' : v >= 40 ? '주의' : '낮음');

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

const modeChip = (m) => `<span class="mode m${m}">${MODES[m]?.label || '기록'}</span>`;
const fileLink = (f) => `#/file/${encodeURIComponent(f.id)}`;
const obsName = (f) => f.observer?.name || 'UNKNOWN';
const pcName = (f) => f.pc || 'PC';

function head(no, title, extra = '') {
  return `<header class="vh">
    <p class="vh-no">${esc(no)}</p>
    <h1 class="vh-title kr" tabindex="-1">${esc(title)}</h1>
    ${extra}
  </header>`;
}

/* ---------- 보고서 목록 ---------- */

function vFiles() {
  const list = store.all();
  return `${head('EYES ONLY · 보관함', '관찰 보고서 목록',
    `<p class="vh-line">인물 한 명당 보고서 하나. <b>파일을 눌러 열람하십시오.</b> 같은 인물을 다시 검사하면 그 인물의 보고서가 새 내용으로 바뀝니다.</p>`)}
  <section class="files" aria-label="보고서">
    ${list.map((f) => `<div class="file-wrap">
    <a class="file m${f.mode}" href="${fileLink(f)}">
      <span class="file-tab">${esc(f.no)}</span>
      <span class="file-in">
        <span class="file-g">${glyph(f.subject, { size: 78 })}</span>
        <span class="file-b">
          <span class="file-mode">${modeChip(f.mode)}</span>
          <b class="file-name">${esc(f.subject)}</b>
          <span class="file-ctx">${f.mode === 2 ? `${esc(pcName(f))} 주변을 맴도는 인물. ${esc(josa(obsName(f), '이', '가'))} 몰래 지켜봄` : `${esc(pcName(f))} 곁의 인물. ${esc(josa(obsName(f), '이', '가'))} 경계 중`}</span>
          <span class="file-title">「${esc(f.title || '무제 보고서')}」</span>
        </span>
      </span>
      <span class="file-foot">
        <span class="file-threat"><em>위험도</em>${f.threat != null ? `${bar(f.threat, 'threat')}<b>${f.threat}</b>` : '<b>—</b>'}</span>
        <span class="file-open">열람 →</span>
      </span>
    </a>
    <button class="file-del" type="button" data-act="del" data-id="${esc(f.id)}" aria-label="${esc(f.subject)} 보고서 삭제">삭제</button>
    </div>`).join('')}
    <a class="file file-new" href="#/intake">
      <span class="file-plus" aria-hidden="true">+</span>
      <b>새 보고서</b>
      <span>OOC 복사 → 답 붙여넣기</span>
    </a>
  </section>
  <p class="tools">
    <span>보관함</span>
    <button type="button" data-act="export">백업 저장</button>
    <button type="button" data-act="import">백업 반입</button>
    <button type="button" data-act="wipe" class="danger">전체 파기</button>
  </p>`;
}

/* ---------- 보고서 내부 ---------- */

function redacted(text, key) {
  const len = Math.max(6, Math.min(40, [...text].length));
  return `<div class="redact" data-key="${esc(key)}">
    <p class="redact-t" data-text="${esc(text)}"><span class="rbar" style="--n:${len}"></span></p>
    <button class="chip-btn" type="button" data-act="reveal">열람 해제</button>
  </div>`;
}


function sec(no, title, sub, inner, cls = '') {
  return `<section class="sec ${cls}"><h2 class="sh"><span class="sh-no">${no}</span><span class="sh-t">${title}</span>${sub ? `<span class="sh-ko">${sub}</span>` : ''}</h2>${inner}</section>`;
}

const notesLog = (notes) => (notes.length
  ? `<ol class="log">${notes.map((n) => `<li><span class="log-t">${esc(n.when || '--:--')}</span><span class="log-p">${esc(n.where || '장소 미상')}</span><span class="log-x">${body(n.text, n.st)}</span></li>`).join('')}</ol>`
  : NODATA);

function tabOverview(f) {
  const O = esc(obsName(f));
  const OJ = josa(O, '이', '가');
  const S = esc(f.subject);
  const P = esc(pcName(f));
  const acc = accuracy(f);
  const tot = Math.max(1, acc.total);
  const seg = (k, n) => `<i class="seg-${k}" style="--w:${(n / tot) * 100}%"></i>`;
  const shownFact = acc.fact + (audit ? 0 : acc.error);
  return `
    ${f.headline ? `<blockquote class="callout">
      <p class="callout-k">${esc(obsName(f))}의 한 줄 결론</p>
      <p class="callout-q">${esc(f.headline)}</p>
    </blockquote>` : ''}

    <div class="readouts" role="list">
      <div class="ro ro-threat" role="listitem">
        <p class="ro-k">위험도 <span>${josa(S, '이', '가')} ${P}에게 얼마나 위험한 사람인지 · ${O}의 판단</span></p>
        <p class="ro-n">${f.threat ?? '—'}<small>/100</small><em>${f.threat != null ? threatWord(f.threat) : ''}</em></p>
        ${f.threat != null ? gauge(f.threat) : ''}
        <p class="ro-c">${f.threatWhy ? esc(f.threatWhy) : `${OJ} 판단한 위험 정도`}</p>
      </div>
      <div class="ro" role="listitem">
        <p class="ro-k">이 보고서의 신빙성 <span>이 기록 내용을 얼마나 믿어도 되는지 · ${O} 스스로 평가</span></p>
        <p class="ro-n">${f.trust ?? '—'}<small>/100</small><em>등급 ${grade(f.trust)}</em></p>
        ${bar(f.trust, 'ro-bar')}
        <p class="ro-c">${f.trustWhy ? esc(f.trustWhy) : `${O}의 자기 평가`}</p>
      </div>
      <div class="ro" role="listitem">
        <p class="ro-k">직접 확인한 비율 <span>보고서 항목 중 ${OJ} 직접 보고 확인한 내용의 비율</span></p>
        <p class="ro-n">${acc.pct ?? '—'}<small>%</small><em>검수 결과</em></p>
        <span class="segbar" aria-hidden="true">${seg('fact', shownFact)}${seg('guess', acc.guess)}${audit ? seg('error', acc.error) : ''}${seg('unknown', acc.unknown)}</span>
        <p class="ro-c">확인 ${shownFact} · 추정 ${acc.guess}${audit ? ` · 오인 ${acc.error}` : ''} · 미확인 ${acc.unknown}</p>
      </div>
    </div>

    <div class="ov-split${f.scribbles.length ? '' : ' single'}">
      ${sec('01', '핵심 신상', '', entList(f.profile.slice(0, 4), (p) => p.label))}
      ${f.scribbles.length ? `<section class="margin">
        <h2 class="sh"><span class="sh-no">02</span><span class="sh-t">혼잣말</span><span class="sh-ko">보고서에는 못 쓴 ${esc(obsName(f))}의 속말</span></h2>
        ${chatLog(f.scribbles, obsName(f), f.mode)}
      </section>` : ''}
    </div>

    ${sec('03', '종합 소견', `${OJ} 내린 공식 결론`, `<p class="verdict">${f.verdict ? esc(f.verdict) : '<span class="nf">DATA NOT FOUND</span>'}</p>`)}
    ${f.comment ? `<section class="memo"><p class="memo-h">// 보고서 끝에 남긴 ${esc(obsName(f))}의 사적인 한마디</p><p class="memo-t" data-type>${esc(f.comment)}</p></section>` : ''}`;
}

function tabDossier(f) {
  const O = esc(obsName(f));
  return `
    ${sec('01', '기본 신상', '', entList(f.profile, (p) => p.label))}
    ${sec('02', '인간관계도', `가운데가 ${esc(f.subject)} · 점선은 ${O}의 시선`, `${relationMap(f)}${entList(f.relations, (r) => r.who)}`)}
    ${sec('03', '외모와 특징', '알아볼 수 있는 표시', entList(f.look))}
    ${sec('04', '좋아하는 것 · 싫어하는 것', '', `<div class="two">
      <div><p class="mini">+ 좋아하는 것</p>${entList(f.likes)}</div>
      <div><p class="mini">− 싫어하는 것</p>${entList(f.dislikes)}</div></div>`)}`;
}

function tabNotes(f) {
  return `
    ${sec('01', '미행 기록', '몰래 지켜본 장면', cctv(f.notes, body, { imgs: f.camImgs || [], editable: openId !== 'shared', who }))}
    ${sec('02', '도청 기록', '▶를 누르면 엿들은 말이 재생됩니다', wiretap(f.intercepts, who))}`;
}

function tabPsych(f) {
  const O = esc(obsName(f));
  const OJ = josa(O, '이', '가');
  const S = esc(f.subject);
  const r = radar(f.psych);
  return `
    ${sec('01', '첫인상', `${OJ} ${josa(S, '을', '를')} 처음 봤을 때`, f.first ? `<p class="impression">${esc(f.first)}</p>` : NODATA)}
    ${sec('02', '성향 점수', `${OJ} 매긴 점수 · 0~100`, f.psych.length
      ? `<div class="psy-wrap">${r}<ul class="psy wide">${f.psych.map((p) => `<li><span>${esc(p.k)}</span>${bar(p.v)}<b>${p.v}</b>${p.why ? `<small>${esc(p.why)}</small>` : ''}${p.memo ? `<small class="psy-memo">${memoLine(p.memo, who)}</small>` : ''}</li>`).join('')}</ul></div>`
      : NODATA)}
    ${sec('03', '성격과 행동 습관', '', entList(f.traits))}
    ${sec('04', '그래서 어떤 사람인가', `${OJ} 보는 ${S}`, f.person ? `<p class="impression final">${esc(f.person)}</p>` : NODATA)}`;
}

function tabClassified(f) {
  const O = esc(obsName(f));
  const raw = (f.sealed || []).map((x) => (typeof x === 'string' ? x : [x.name, x.why].filter(Boolean).join(' · ')));
  return `
    ${sec('01', `${O}의 속마음`, '공식 기록에서 지운 메모 · 눌러서 보기', f.restricted.length ? f.restricted.map((r, i) => redacted(r, `${f.id}-${i}`)).join('') : NODATA, 'sec-lock')}
    ${raw.length ? sec('02', '열람 불가', `윤리·도덕·상식의 필터를 거치지 않은 ${O}의 날것의 생각입니다. 세 번 눌러야 열립니다.`, `<div class="vault" data-n="0">
      <p class="vault-h"><b>ACCESS DENIED</b><span>열람 불가 · 승인 <i>0</i>/3</span></p>
      <div class="vault-body" hidden>${raw.map((t) => `<p class="vault-t" data-text="${esc(t)}"></p>`).join('')}</div>
      <button class="btn vault-btn" type="button" data-act="vault">열람 요청</button>
    </div>`, 'sec-lock') : ''}`;
}

function tabIncidents(f, external) {
  return `
    ${sec('01', '사건 타임라인', '오래된 일부터 순서대로', timeline(f.incidents, f.trigger, who))}`;
}

const TAB_VIEW = { overview: tabOverview, dossier: tabDossier, field_notes: tabNotes, psychological: tabPsych, classified: tabClassified, incident_log: tabIncidents };

function tabCount(f, k) {
  return {
    dossier: f.profile.length + f.look.length + f.traits.length + f.likes.length + f.dislikes.length + f.relations.length,
    field_notes: f.notes.length + (f.intercepts?.length || 0),
    psychological: f.psych.length,
    classified: f.restricted.length + (f.sealed?.length || 0),
    incident_log: f.incidents.length,
  }[k];
}

function vFile(f, { external = false } = {}) {
  if (f) { f.intercepts ||= []; f.scribbles ||= []; }
  if (!f) return head('보고서', '보고서를 찾을 수 없습니다') + '<p class="nodata big">DATA NOT FOUND</p><div class="row-acts"><a class="btn" href="#/files">← 보고서 목록</a></div>';
  who = obsName(f);
  const i = Math.max(0, TABS.findIndex(([k]) => k === tab));
  const [k, title, descFn] = TABS[i];
  const O = esc(obsName(f));
  const P = esc(pcName(f));
  const S = esc(f.subject);
  const desc = descFn(O, S);
  const OJ = josa(O, '이', '가');
  const brief = f.mode === 2
    ? `정체를 알 수 없는 <b class="o">${josa(O, '이', '가')}</b> <b class="p">${P}</b> 주변을 맴도는 <b class="s">${josa(S, '을', '를')}</b> 몰래 지켜보며 적은 기록입니다.`
    : `<b class="o">${josa(O, '이', '가')}</b> <b class="p">${P}</b> 곁에 있는 <b class="s">${josa(S, '을', '를')}</b> 경계하며 몰래 적은 관찰 기록입니다.`;
  const prev = TABS[i - 1];
  const next = TABS[i + 1];
  const acc = accuracy(f);

  return `<article class="dossier" data-mode="${f.mode}">
    <div class="d-top">
      <p class="back">${external ? '<span class="trig">외부에서 받은 보고서</span>' : '<a class="lnk" href="#/files">← 보고서 목록</a>'}</p>
      ${external
        ? '<button class="btn solid sm" type="button" data-act="keep">내 보관함에 넣기</button>'
        : `<button class="btn sm" type="button" data-act="share" data-id="${esc(f.id)}">공유 링크 복사</button>`}
    </div>
    <header class="d-head">
      <div class="d-id-mini">${glyph(f.subject, { size: 92 })}<span class="scan" aria-hidden="true"></span></div>
      <div class="d-meta">
        <p class="d-no">${modeChip(f.mode)} <span>문서번호 ${esc(f.no || 'EO-EXT')}</span></p>
        <h1 class="d-title" tabindex="-1">${esc(f.subject)}<small>「${esc(f.title || '무제 보고서')}」</small></h1>
        <p class="d-brief">${brief}</p>
        <p class="d-ctx">${O}: ${esc(f.observer?.rel || '신분 미상')}</p>
      </div>
      <div class="stamp" aria-hidden="true"><b>EYES ONLY</b><span>대외비 · 열람 주의</span></div>
    </header>

    ${acc.error ? `<div class="d-controls">
      <p class="sw-c">${audit ? `${OJ} 잘못 알고 쓴 내용 ${acc.error}건을 바로잡아 보여 주는 중입니다.` : `${OJ} 잘못 알고 쓴 내용이 ${acc.error}건 있습니다.`}</p>
      <label class="toggle">
        <span class="tg-l">오해 바로잡기</span>
        <input type="checkbox" role="switch" class="tg-in" data-toggle="audit"${audit ? ' checked' : ''}>
        <span class="tg-track" aria-hidden="true"><i></i></span>
      </label>
    </div>` : ''}
    <nav class="tabs" role="tablist" aria-label="보고서 항목">
      ${TABS.map(([tk, tt], n) => {
        const c = tabCount(f, tk);
        return `<button class="tab" type="button" role="tab" data-tab="${tk}" aria-selected="${tk === k}"${tk === k ? '' : ' tabindex="-1"'}><span class="tab-no">${String(n + 1).padStart(2, '0')}</span><span class="tab-t">${tt}${c ? ` <i>${c}</i>` : ''}</span></button>`;
      }).join('')}
    </nav>

    <div class="tab-head">
      <div class="th-main">
        <p class="tab-step">${i + 1} / ${TABS.length}</p>
        <h2 class="tab-title">${title}</h2>
        ${desc ? `<p class="tab-desc">${desc}</p>` : ''}
      </div>
    </div>
    ${k === 'dossier' || k === 'psychological' ? `<dl class="legend-line" aria-label="표시 안내">
      <div><dt><span class="st st-fact">확인</span></dt><dd>직접 본 사실</dd></div>
      <div><dt><span class="st st-guess">추정</span></dt><dd>${O}의 짐작</dd></div>
      <div><dt><span class="st st-unknown">미확인</span></dt><dd>알아내지 못함</dd></div>
      ${audit ? '<div><dt><span class="st st-error">오인</span></dt><dd>잘못 안 내용</dd></div>' : ''}
    </dl>` : ''}
    <div class="tab-body" role="tabpanel">${TAB_VIEW[k](f, external)}</div>

    <nav class="pager" aria-label="이전 · 다음 항목">
      ${prev ? `<button class="btn" type="button" data-tab="${prev[0]}">← ${prev[1]}</button>` : '<span></span>'}
      ${next ? `<button class="btn solid" type="button" data-tab="${next[0]}">다음: ${next[1]} →</button>` : (external ? '' : '<a class="btn solid" href="#/files">보고서 목록으로</a>')}
    </nav>

  </article>`;
}

/* ---------- 접수 ---------- */

const draft = { mode: 1, observer: '', subject: '', pc: '', trigger: '', answer: '', obsPick: 'auto', subPick: 'auto' };
try { Object.assign(draft, JSON.parse(store.pref.get('draft') || '{}')); } catch { /* ignore */ }
/* 임의를 고르면 이름을 비워 보내고, OOC가 AI에게 고르게 한다 */
const promptArgs = () => ({
  mode: draft.mode,
  observer: draft.mode === 1 && draft.obsPick === 'name' ? draft.observer : '',
  subject: draft.mode === 1 && draft.subPick === 'name' ? draft.subject : '',
  pc: draft.pc,
  trigger: draft.trigger,
});

function pickRow({ key, pickKey, label, autoLabel, autoDesc, ph }) {
  const v = draft[pickKey] === 'name' ? 'name' : 'auto';
  return `<div class="pick-row">
    <p class="pick-l">${label}</p>
    <div class="seg" role="radiogroup" aria-label="${label}">
      <label><input type="radio" name="${pickKey}" value="auto"${v === 'auto' ? ' checked' : ''}><span>${autoLabel}</span></label>
      <label><input type="radio" name="${pickKey}" value="name"${v === 'name' ? ' checked' : ''}><span>이름 입력</span></label>
    </div>
    ${v === 'name'
      ? `<input class="pick-in" name="${key}" maxlength="20" value="${esc(draft[key])}" placeholder="${ph}" aria-label="${label} 이름">`
      : `<p class="pick-d">${autoDesc}</p>`}
  </div>`;
}
const saveDraft = () => store.pref.set('draft', JSON.stringify(draft));

function vIntake(q, { first = false } = {}) {
  if (q.get('mode') && vIntake.applied !== location.hash) {
    draft.mode = q.get('mode') === '2' ? 2 : 1;
    vIntake.applied = location.hash;
  }
  const wantTrig = q.get('trigger') === '1';
  const m = draft.mode;
  const openOpt = wantTrig || !!(draft.pc || draft.trigger);
  const opt = `<details class="opt"${openOpt ? ' open' : ''}>
        <summary>추가 설정 <em>선택 · PC 이름, 계기 사건</em></summary>
        <div class="fields">
          <label class="fld"><span>PC 이름 <em>비우면 PC</em></span><input name="pc" maxlength="20" value="${esc(draft.pc)}" placeholder="예: 윤해리"></label>
          <label class="fld"><span>계기 사건 <em>특정 사건 이후의 보고서로</em></span><input name="trigger" maxlength="30" value="${esc(draft.trigger)}" placeholder="예: 정전의 밤"${wantTrig ? ' data-focus' : ''}></label>
        </div>
      </details>`;
  const top = first
    ? `<header class="vh first-h">
        <p class="vh-no">비밀 인물 조사 및 관찰 기록</p>
        <h1 class="vh-title" tabindex="-1"><span class="en">EYES ONLY</span></h1>
        <p class="vh-line">그 사람 곁에 누가 있는지 지켜보는 눈. 그리고 그 눈을 지켜보는 또 다른 눈.</p>
      </header>`
    : `${store.all().length ? '<p class="back"><a class="lnk" href="#/files">← 보고서 목록</a></p>' : ''}${head('새 보고서', '새 관찰 보고서 만들기')}`;
  return `${top}
  <form class="intake" id="intake" autocomplete="off">
    <section class="step">
      <h2 class="sh"><span class="sh-no">01</span><span class="sh-ko big">관찰 방식 고르기</span></h2>
      <div class="modes" role="radiogroup" aria-label="관찰 모드">
        ${[1, 2].map((k) => `<label class="mode-card pick">
          <input type="radio" name="mode" value="${k}"${m === k ? ' checked' : ''}>
          <span class="mc-code">${MODES[k].code}</span>
          <b class="mc-name kr">${MODES[k].label}</b>
          <span class="mc-desc">${MODES[k].desc}</span>
        </label>`).join('')}
      </div>
      ${m === 2 ? opt : ''}
    </section>
    ${m === 1 ? `<section class="step">
      <h2 class="sh"><span class="sh-no">02</span><span class="sh-ko big">누가 누구를 관찰할까</span></h2>
      <div class="picks">
        ${pickRow({ key: 'observer', pickKey: 'obsPick', label: '지켜보는 NPC', autoLabel: '임의', autoDesc: '등장 NPC 중 PC 곁을 가장 경계할 만한 인물을 AI가 고릅니다.', ph: '예: 차도현' })}
        <span class="pick-arrow" aria-hidden="true">──▶</span>
        ${pickRow({ key: 'subject', pickKey: 'subPick', label: '관찰 대상 (PC 곁의 인물)', autoLabel: '임의 생성', autoDesc: 'PC 곁의 인물 중 한 명을 AI가 고르고, 마땅한 인물이 없으면 새로 만듭니다.', ph: '예: 강지안' })}
      </div>
      ${opt}
    </section>` : ''}

    <section class="step">
      <h2 class="sh"><span class="sh-no">${m === 1 ? '03' : '02'}</span><span class="sh-ko big">OOC 보내고 답 붙여넣기</span></h2>
      <p class="hint">OOC를 복사해 롤플 채팅에 보내고, 받은 답을 통째로 복사한 뒤 답 붙여넣기를 누르십시오.</p>
      <div class="flow">
        <button class="btn solid" type="button" data-act="copyprompt">OOC 복사</button>
        <span class="flow-arrow" aria-hidden="true">──▶</span>
        <button class="btn solid" type="button" data-act="pasteclip">답 붙여넣기</button>
      </div>
      <div class="manual" id="manual"${draft.answer ? '' : ' hidden'}>
        <textarea name="answer" id="answer" rows="8" spellcheck="false" placeholder="모드: 01&#10;관찰자: 이름 · 대상과의 관계&#10;대상: 이름&#10;…" aria-label="채팅에서 받은 답">${esc(draft.answer)}</textarea>
        <div class="row-acts left">
          <button class="btn solid" type="submit">보고서 만들기</button>
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
    ${first ? '<p class="first-sample"><button class="lnk" type="button" data-act="samples">예시 보고서로 먼저 둘러보기</button></p>' : ''}
  </form>`;
}

function bindIntake() {
  const form = $('#intake');
  if (!form) return;
  const upd = () => {
    const p = buildPrompt(promptArgs());
    $('#promptView').textContent = p;
    $('#pLen').textContent = `${[...p].length}자`;
  };
  upd();
  const trig = form.querySelector('[data-focus]');
  if (trig) trig.focus();
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'mode' || t.name === 'obsPick' || t.name === 'subPick') {
      if (t.name === 'mode') {
        const next = Number(t.value) === 2 ? 2 : 1;
        if (next !== draft.mode) { draft.mode = next; draft.subject = ''; draft.subPick = 'auto'; }
      } else {
        draft[t.name] = t.value === 'name' ? 'name' : 'auto';
      }
      saveDraft();
      const y = window.scrollY;
      const sel = `input[name="${t.name}"][value="${t.value}"]`;
      route().then(() => {
        window.scrollTo(0, y);
        const focusIn = t.value === 'name' && t.name !== 'mode' ? $(`.pick-in[name="${t.name === 'obsPick' ? 'observer' : 'subject'}"]`) : null;
        (focusIn || $(sel))?.focus({ preventScroll: true });
      });
      return;
    }
    if (t.name in draft) draft[t.name] = t.value;
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
  const { file, replaced } = store.upsert(r.data, { trigger: draft.trigger });
  draft.answer = '';
  draft.trigger = '';
  saveDraft();
  openId = file.id;
  tab = TABS[0][0];
  ss('fresh', replaced ? 'replaced' : 'new');
  location.hash = fileLink(file);
}

function ss(k, v) {
  try {
    if (v === undefined) { const x = sessionStorage.getItem('eyes_only:' + k); sessionStorage.removeItem('eyes_only:' + k); return x; }
    sessionStorage.setItem('eyes_only:' + k, v);
  } catch { return null; }
  return null;
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
  if (!memo || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) { io.disconnect(); typeOut(memo); }
  }, { threshold: 0.6 });
  io.observe(memo);
}

/* ---------- 라우터 ---------- */

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/files';
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { parts, q: new URLSearchParams(qs || '') };
}

async function route() {
  if (/^#r=[jz][A-Za-z0-9_-]+$/.test(location.hash)) {
    try {
      shared = await store.unpack(location.hash.slice(3));
      if (openId !== 'shared') tab = TABS[0][0];
      openId = 'shared';
      render(['shared'], new URLSearchParams());
    } catch {
      shared = null;
      toast('링크를 열 수 없습니다. 주소가 잘렸는지 확인하십시오.', 'alert');
      history.replaceState(null, '', location.pathname + '#/files');
      render(['files'], new URLSearchParams());
    }
    return;
  }
  const { parts, q } = parseHash();
  render(parts, q);
}

function render(parts, q) {
  const [name0 = 'files', arg] = parts;
  const first = !store.all().length && name0 !== 'shared';
  const name = first ? 'first' : name0;
  document.body.classList.toggle('solo', first);
  document.body.dataset.view = name;
  let html;
  let path;
  switch (name) {
    case 'first': html = vIntake(q, { first: true }); path = '~/new'; break;
    case 'intake': html = vIntake(q); path = '~/new'; break;
    case 'file': {
      if (openId !== arg) { openId = arg; tab = TABS[0][0]; }
      const f = store.byId(arg);
      html = vFile(f);
      path = `~/files/${f?.no || arg}`;
      break;
    }
    case 'shared': html = vFile(shared, { external: true }); path = '~/inbound/' + (shared?.no || 'EXT'); break;
    default: openId = ''; html = vFiles(); path = '~/files';
  }
  view.innerHTML = html;
  crumb.textContent = path;
  window.scrollTo(0, 0);
  const h1 = $('h1', view);
  if (h1 && render.ready) h1.focus({ preventScroll: true });
  render.ready = true;
  if (name === 'intake' || name === 'first') bindIntake();
  const fresh = ss('fresh');
  if (fresh && name === 'file') {
    view.firstElementChild?.classList.add('arrive');
    toast(fresh === 'replaced' ? '같은 인물의 보고서를 새 내용으로 바꿨습니다.' : '보고서가 만들어졌습니다. 탭을 눌러 항목별로 열람하십시오.');
  }
  watchMemo();
}

function showTab(k) {
  tab = k;
  const ext = openId === 'shared';
  const f = ext ? shared : store.byId(openId);
  const art = $('.dossier', view);
  if (!f || !art) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = vFile(f, { external: ext });
  art.replaceWith(tmp.firstElementChild);
  const tabs = $('.tabs', view);
  window.scrollTo(0, 0);
  const cur = $('.tab[aria-selected="true"]', view);
  if (cur) { tabs.scrollLeft = cur.offsetLeft - (tabs.clientWidth - cur.offsetWidth) / 2; cur.focus({ preventScroll: true }); }
  watchMemo();
}

/* ---------- 미행 기록 사진 ---------- */

function showTabKeep() {
  const y = window.scrollY;
  showTab(tab);
  window.scrollTo(0, y);
}

async function shrinkImage(file, max = 960) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pickCamImage(i) {
  const f = store.byId(openId);
  if (!f) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('사진 파일만 넣을 수 있습니다.', 'alert'); return; }
    try {
      const data = await shrinkImage(file);
      const imgs = [...(f.camImgs || [])];
      imgs[i] = data;
      if (!store.patch(f.id, { camImgs: imgs })) { toast('저장 공간이 부족해 사진을 넣지 못했습니다. 다른 사진을 지워 보세요.', 'alert'); return; }
      showTabKeep();
      toast(`CAM ${String(i + 1).padStart(2, '0')} 화면에 사진을 넣었습니다.`);
    } catch {
      toast('사진을 읽지 못했습니다.', 'alert');
    }
  });
  input.click();
}

/* ---------- 동작 ---------- */

/* 예시는 늘 최신 1건으로: 예전 예시가 남아 있으면 지우고 새로 넣는다 */
function putSamples() {
  store.clear({ samplesOnly: true });
  SAMPLES.forEach((s) => {
    const r = parse(s.text);
    if (!r.data) return;
    const same = store.all().find((f) => f.subject === r.data.subject);
    if (same) store.remove(same.id);
    store.add({ ...r.data, sampleVer: SAMPLE_VER }, { at: s.at, trigger: s.trigger, sample: true });
  });
}

function loadSamples() {
  putSamples();
  toast('예시 보고서 1건을 넣었습니다. 모든 인물은 허구의 성인입니다.');
  const f = store.all().find((x) => x.sample);
  if (f) location.hash = fileLink(f);
}

document.addEventListener('click', async (e) => {
  const tb = e.target.closest('[data-tab]');
  if (tb) { showTab(tb.dataset.tab); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'samples') loadSamples();
  else if (act === 'play') {
    const tap = b.closest('.tap');
    const q = $('.tap-q', tap);
    if (tap.classList.contains('playing')) return;
    tap.classList.add('playing', 'played');
    b.textContent = '■';
    const said = q.dataset.said;
    q.textContent = '';
    const chars = [...said];
    let i = 0;
    const step = () => {
      if (!q.isConnected) return;
      i = reduced.matches ? chars.length : i + 1;
      q.textContent = `“${chars.slice(0, i).join('')}${i < chars.length ? '' : '”'}`;
      if (i < chars.length) setTimeout(step, 55);
      else { tap.classList.remove('playing'); b.textContent = '▶'; }
    };
    step();
  } else if (act === 'vault') {
    const v = b.closest('.vault');
    const n = Math.min(3, Number(v.dataset.n) + 1);
    v.dataset.n = String(n);
    $('.vault-h i', v).textContent = String(n);
    v.classList.remove('shake');
    void v.offsetWidth;
    if (n < 3) {
      v.classList.add('shake');
      b.textContent = n === 1 ? '한 번 더 요청' : '마지막 요청';
      return;
    }
    v.classList.add('open');
    $('.vault-h b', v).textContent = 'ACCESS GRANTED';
    $('.vault-h span', v).textContent = '열람 승인 · 3/3';
    const body = $('.vault-body', v);
    body.hidden = false;
    [...body.querySelectorAll('.vault-t')].forEach((p, k) => setTimeout(() => scramble(p, p.dataset.text, 900), k * 500));
    b.remove();
  } else if (act === 'camimg') {
    pickCamImage(Number(b.dataset.i));
  } else if (act === 'camdel') {
    const f = store.byId(openId);
    if (!f) return;
    const imgs = [...(f.camImgs || [])];
    imgs[Number(b.dataset.i)] = null;
    store.patch(f.id, { camImgs: imgs });
    showTabKeep();
  } else if (act === 'reveal') {
    const box = b.closest('.redact');
    const t = $('.redact-t', box);
    if (box.classList.contains('open')) {
      box.classList.remove('open');
      t.innerHTML = `<span class="rbar" style="--n:${Math.max(6, Math.min(40, [...t.dataset.text].length))}"></span>`;
      b.textContent = '열람 해제';
    } else {
      box.classList.add('open');
      scramble(t, t.dataset.text);
      b.textContent = '다시 가리기';
    }
  } else if (act === 'copyprompt') {
    const ok = await copyText(buildPrompt(promptArgs()));
    toast(ok ? 'OOC를 복사했습니다. 채팅에 보내고 답을 복사해 오십시오.' : '복사하지 못했습니다. OOC 내용 보기에서 직접 복사하십시오.', ok ? '' : 'alert');
    if (!ok) $('#promptView').hidden = false;
  } else if (act === 'peek') {
    const pv = $('#promptView');
    pv.hidden = !pv.hidden;
    b.setAttribute('aria-expanded', String(!pv.hidden));
    b.textContent = pv.hidden ? 'OOC 내용 보기' : 'OOC 내용 닫기';
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
  } else if (act === 'del') {
    const f = store.byId(b.dataset.id);
    if (!f || !confirm(`${f.subject}의 보고서를 삭제합니다. 되돌릴 수 없습니다.`)) return;
    store.remove(f.id);
    toast(`${f.subject}의 보고서를 삭제했습니다.`);
    if (location.hash === '#/files' || !store.all().length) route(); else location.hash = '#/files';
  } else if (act === 'keep') {
    if (!shared) return;
    const { no, at, trigger, ...data } = shared;
    const { file, replaced } = store.upsert(data, { trigger });
    shared = null;
    openId = file.id;
    toast(replaced ? '같은 인물의 보고서를 받은 내용으로 바꿨습니다.' : '보고서를 보관함에 넣었습니다.');
    location.hash = fileLink(file);
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
    if (!confirm('모든 보고서를 파기합니다. 되돌릴 수 없습니다.')) return;
    store.clear();
    toast('모든 보고서를 파기했습니다.');
    if (location.hash === '#/files') route(); else location.hash = '#/files';
  }
});

document.addEventListener('change', (e) => {
  if (e.target.dataset?.toggle !== 'audit') return;
  audit = e.target.checked;
  store.pref.set('audit', audit ? '1' : '');
  const y = window.scrollY;
  showTab(tab);
  window.scrollTo(0, y);
  $('.tg-in', view)?.focus({ preventScroll: true });
  toast(audit ? '잘못 알고 쓴 내용을 바로잡아 보여 줍니다.' : '쓴 그대로 보여 줍니다.');
});

document.addEventListener('keydown', (e) => {
  const t = e.target.closest?.('.tab');
  if (!t || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const i = TABS.findIndex(([k]) => k === t.dataset.tab);
  const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
  e.preventDefault();
  showTab(n[0]);
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

/* ---------- 시계 ---------- */

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

store.load();
if (store.all().some((f) => f.sample && f.sampleVer !== SAMPLE_VER)) putSamples();
clock();
window.addEventListener('hashchange', route);
route();
