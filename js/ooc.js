const HEAD = '[OOC · EYES ONLY 관찰 기록] 잠시 역할극 중단. NPC/PC 기존설정, 관계성, 성격, 성향, 말투, 서사, 캐릭터정보, 유저노트, 로어북 종합참고. 등장인물은 모두 성인이다.';

const RULE_BASE = `- 공식 기록은 건조한 데이터베이스 문체(~함, ~임, ~로 보임). 관찰자의 성격·경계심·편견이 평가에 묻어나게 쓴다.
- 설정과 서사에 없는 정보는 지어내지 않고 DATA NOT FOUND로 쓴다. PC의 대사와 속마음은 지어내지 않는다.`;
const RULE_TAG = `- 항목 끝에 확인(서사에서 직접 본 사실), 추정(관찰자의 해석), 오인(관찰자가 잘못 안 것) 중 하나를 붙인다. 오인은 '실제: 사실'을 덧붙인다.
- 항목 절반쯤은 끝에 '· 메모: 관찰자 말투의 구어체 한마디 20자 이내'를 붙인다.
- 한 항목은 50자 이내. 표로 만들지 않는다.`;

const OUT = '[출력] 역할극 서술 없이 코드블록 하나에 아래 형식 그대로 한 항목 한 줄. 같은 머리말을 줄 수만큼 반복한다.';

/* 답이 잘리지 않도록 3부로 나눠 받는다. 각 답은 같은 보고서에 합쳐진다. */
export const PARTS = [
  { no: 1, name: '기본 신상', desc: '제목, 결론, 위험도, 신상, 외관, 취향, 관계' },
  { no: 2, name: '관찰 기록', desc: '사건, 미행, 도청, 성격, 성향 점수' },
  { no: 3, name: '속마음', desc: '숨긴 속마음, 열람 불가, 혼잣말' },
];

const FORMATS = {
  1: `제목: 20자 이내
판정: 관찰자 말투의 한 줄 결론 30자
위험도: 0~100 · 근거
첫인상: 처음 봤을 때의 인상 1문장
신상: 항목 · 내용 · 확인 (4줄)
외관: 식별 특징 · 확인 (3줄)
선호: 내용 · 확인 (2줄)
기피: 내용 · 추정 (2줄)
관계: 인물 · 관계 분석 · 추정 (2줄, 첫 줄은 PC)
소견: 종합 소견 2문장
신뢰도: 0~100 · 근거`,
  2: `사건: 사건명 · 경위와 결과 (3줄)
관찰: 일시 · 장소 · 관찰 기록 (3줄)
도청: "대상이 서사에서 실제로 한 말" · 상황 (2줄)
성격: 행동 양식 · 추정 (3줄)
심리: 성향 2~6자 · 0~100 · 근거 (4줄)
인물평: 그래서 어떤 인간이라고 보는지 1~2문장`,
  3: `열람 제한: 공식 기록에서 뺀 속마음 (2줄)
봉인: 윤리·도덕·상식 필터 없이 튀어나온 관찰자의 노골적이고 날것의 속생각.(2줄)
코멘트: 관찰자의 개인 코멘트 1~2문장
낙서: 관찰자의 구어체 혼잣말 20자 이내 (4줄)`,
};

export const MODES = {
  1: { code: 'MODE 01', name: "OBSERVER'S RECORD", label: '경계 기록', desc: 'NPC가 PC 곁의 인물을 경계하며 몰래 적은 기록' },
  2: { code: 'MODE 02', name: 'SUBJECT UNDER SURVEILLANCE', label: '감시 기록', desc: 'PC 주변을 맴도는 NPC를 정체 모를 제3자가 지켜보며 적은 기록' },
};

export function josa(word, a, b) {
  const c = word.charCodeAt(word.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return word + ((c - 0xac00) % 28 ? a : b);
  if (/^(?:N?PC)$/.test(word)) return word + ({ 을: '를', 이: '가', 은: '는', 과: '와' }[a] || b);
  const L = word.match(/(?:^|[\s\d])([A-Za-z])$/);
  if (L) return word + (/[LMNRlmnr]/.test(L[1]) ? a : b);
  return `${word}${a}(${b})`;
}

const tidyName = (s) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

export function buildPrompt({ mode = 1, observer = '', subject = '', pc = '', trigger = '', part = 1 } = {}) {
  const ob = tidyName(observer);
  const sb = tidyName(subject);
  const pn = tidyName(pc);
  const P1 = pn ? `PC(${pn})` : 'PC';
  const tr = tidyName(trigger);
  const M = mode === 2 ? '02' : '01';
  const head = `${HEAD.replace('[OOC · EYES ONLY 관찰 기록]', `[OOC · EYES ONLY 관찰 기록 ${part}/3부]`)}`;
  let brief;
  if (part > 1) {
    const o = mode === 2 ? (ob || '1부의 관찰자') : (ob || '1부의 관찰자');
    const t = sb || '1부의 대상';
    const what = mode === 2
      ? `정체불명의 제3자 ${josa(o, '이', '가')} ${P1} 주변을 맴도는 ${josa(t, '을', '를')} 지켜보며 쓴`
      : `${josa(o, '이', '가')} ${P1} 곁에 있는 ${josa(t, '을', '를')} 경계하며 몰래 관찰해 쓴`;
    brief = `앞서 받은 1부에 이어, ${what} 기밀 조사 보고서의 ${part}부를 쓴다. 관찰자와 대상은 1부와 같다.`;
    if (part === 3) brief += ' 이 부분은 공식 기록에서 뺀 관찰자의 속마음이며, 관찰자 본인의 말투로 쓴다.';
  } else if (mode === 2) {
    const n = sb || 'NPC';
    brief = `정체불명의 제3자가 ${josa(n, '을', '를')} 지켜보며 쓴 기밀 조사 보고서를 만든다. ${josa(n, '은', '는')} ${P1} 주변을 감시하듯 맴돌며 PC 곁의 인물들을 살피는 중이다. 관찰자는 정체를 밝히지 않고 코드명만 쓴다. ${n}의 감시 동선과 행동 패턴, PC와 그 주변 인물을 대하는 태도, 그렇게까지 하는 이유를 추적하고 추측한다.`;
  } else {
    const o = ob || 'NPC';
    const t = sb || '인물 한 명';
    brief = `${josa(o, '이', '가')} ${P1} 곁에 있는 ${josa(t, '을', '를')} 경계하며 몰래 관찰해 쓴 기밀 조사 보고서를 만든다. ${o}에게 대상은 PC에게 다가오는 잠재적 위협이다. 대상이 PC에게 어떤 존재인지, PC와의 거리·접촉·의도를 의심하는 눈으로 기록하고, ${o}의 경계심과 질투, 오해가 평가에 묻어난다.`;
    if (!ob) brief += ' 관찰자는 등장 NPC 중 PC 곁을 가장 경계할 만한 한 명을 고른다.';
    if (!sb) brief += " 대상은 PC 곁의 인물 중 관찰자가 아닌 한 명을 고르고, 없으면 세계관에 맞는 성인 인물을 새로 만들어 신상 첫 줄에 '구분 · 임의 생성 인물 · 확인'을 쓴다.";
  }
  if (tr && part === 1) brief += ` 이 보고서는 '${tr}' 이후 새로 추가된 기록이다.`;
  const rules = part === 3 ? RULE_BASE : `${RULE_BASE}\n${RULE_TAG}`;
  const idLines = `모드: ${M}\n관찰자: 이름 · 대상과의 관계\n대상: 이름${part === 1 ? '\nPC: 이름' : ''}`;
  return `${head}\n${brief}\n\n[작성 규칙]\n${rules}\n\n${OUT}\n${idLines}\n${FORMATS[part]}`;
}

/* ---------- parser ---------- */

const KEYS = [
  ['mode', /^모드$/],
  ['observer', /^관찰자$/],
  ['subject', /^(?:대상|조사\s*대상|관찰\s*대상)$/],
  ['pc', /^(?:PC|보호\s*대상|감시\s*범위)$/i],
  ['threat', /^(?:위험도|위협도|경계\s*등급)$/],
  ['first', /^첫\s*인상$/],
  ['person', /^(?:인물평|인물\s*평가)$/],
  ['headline', /^(?:판정|한\s*줄\s*판정)$/],
  ['intercepts', /^(?:도청|감청)$/],
  ['scribbles', /^(?:낙서|여백)$/],
  ['title', /^(?:제목|보고서\s*제목)$/],
  ['profile', /^(?:신상|기본\s*신상(?:\s*정보)?)$/],
  ['look', /^(?:외관|외형|식별\s*특징)$/],
  ['traits', /^(?:성격|행동\s*양식)$/],
  ['likes', /^선호$/],
  ['dislikes', /^기피$/],
  ['relations', /^(?:관계|대인\s*관계)$/],
  ['notes', /^(?:관찰|현장\s*기록|관찰\s*기록)$/],
  ['incidents', /^(?:사건|특이\s*사건)$/],
  ['psych', /^(?:심리|성향)$/],
  ['verdict', /^(?:소견|종합\s*소견)$/],
  ['trust', /^신뢰도$/],
  ['restricted', /^(?:열람\s*제한|비공개)$/],
  ['sealed', /^봉인$/],
  ['comment', /^(?:코멘트|개인\s*코멘트|사적\s*코멘트)$/],
];

const SEP = /\s*[·•∙|]\s*|\s+[-–—]\s+/;
const ST_RE = /^\[?\s*(확인|추정|오인|미확인|confirmed|speculative|erratum)\s*\]?\s*(?:[,:：]?\s*(.*))?$/i;
const REAL_RE = /^(?:실제|정정|사실)\s*[:：]\s*/;
const NF_RE = /data\s*not\s*found|미확인\s*정보|정보\s*없음/i;

export const LIMITS = { line: 90, name: 24, title: 32, verdict: 220, comment: 200 };

export function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if ([...t].length <= max) return t;
  return [...t].slice(0, max).join('').replace(/[\s,·.]+$/, '') + '…';
}

const PAIRS = { '"': '"', "'": "'", '“': '”', '‘': '’', '「': '」', '『': '』' };
const clean = (s) => {
  let t = String(s || '').replace(/\*\*|__|`/g, '').trim();
  while (t.length > 1 && PAIRS[t[0]] && t[t.length - 1] === PAIRS[t[0]] && !t.slice(1, -1).includes(t[0])) t = t.slice(1, -1).trim();
  return t;
};

function stOf(word) {
  const w = word.toLowerCase();
  if (w === '확인' || w === 'confirmed') return 'fact';
  if (w === '오인' || w === 'erratum') return 'error';
  if (w === '미확인') return 'unknown';
  return 'guess';
}

function splitEntry(value, fallback = 'guess') {
  const parts = value.split(SEP).map(clean).filter(Boolean);
  let st = '';
  let real = '';
  const rest = [];
  for (const p of parts) {
    const m = p.match(ST_RE);
    if (!st && m) {
      st = stOf(m[1]);
      if (m[2]) {
        const r = m[2].replace(REAL_RE, '');
        if (REAL_RE.test(m[2]) || st === 'error') real = r; else rest.push(m[2]);
      }
    } else if (REAL_RE.test(p)) {
      real = p.replace(REAL_RE, '');
    } else {
      rest.push(p);
    }
  }
  const tail = rest.length ? rest[rest.length - 1].match(/^(.*?)\s*[(\[]\s*(확인|추정|오인|미확인)\s*[)\]]\s*$/) : null;
  if (!st && tail) { rest[rest.length - 1] = tail[1]; st = stOf(tail[2]); }
  const joined = rest.join(' ');
  if (!st) st = fallback;
  if (NF_RE.test(joined) && st !== 'error') st = 'unknown';
  if (st !== 'error') real = '';
  return { parts: rest, st, real };
}

const firstNum = (s) => { const m = String(s || '').match(/-?\d+(?:\.\d+)?/); return m ? Math.max(0, Math.min(100, Math.round(Number(m[0])))) : null; };

export function looksLikePrompt(raw) {
  return /잠시 역할극 중단/.test(raw) && /\[출력\]/.test(raw);
}

export function parse(text) {
  const raw = String(text || '');
  if (!raw.trim()) return { error: '붙여 넣은 내용이 비어 있습니다.' };
  if (looksLikePrompt(raw)) return { error: 'OOC 요청문이 그대로 들어왔습니다. 채팅에서 받은 답을 복사해 붙여 주세요.' };

  const f = {
    mode: 0, observer: { name: '', rel: '' }, subject: '', pc: '', threat: null, threatWhy: '', title: '',
    profile: [], look: [], traits: [], likes: [], dislikes: [], relations: [],
    notes: [], incidents: [], psych: [], verdict: '', trust: null, trustWhy: '',
    restricted: [], sealed: [], comment: '', first: '', person: '', headline: '', intercepts: [], scribbles: [],
  };
  let hits = 0;

  for (const line0 of raw.split(/\r?\n/)) {
    const line = line0.replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*•>]\s+|#{1,6}\s+|\d+[.)]\s+)/, '').trim();
    const m = line.match(/^\[?([^:：\]]{1,12})\]?\s*[:：]\s*(.*)$/);
    if (!m) continue;
    const label = m[1].trim();
    let value = m[2].trim();
    let memo = '';
    const mm = value.match(/\s*[·•∙|]\s*메모\s*[:：]\s*(.+)$/);
    if (mm) { memo = clip(clean(mm[1]), 40); value = value.slice(0, mm.index).trim(); }
    const key = (KEYS.find(([, re]) => re.test(label)) || [])[0];
    if (!key || !value) continue;
    hits++;
    const L = LIMITS.line;
    switch (key) {
      case 'mode': f.mode = /0?2|surveillance|감시/i.test(value) ? 2 : 1; break;
      case 'observer': {
        const p = value.split(SEP).map(clean).filter(Boolean);
        f.observer = { name: clip(p[0], LIMITS.name), rel: clip(p.slice(1).join(' · '), 40) };
        break;
      }
      case 'subject': f.subject = clip(clean(value.split(SEP)[0]), LIMITS.name); break;
      case 'pc': f.pc = clip(clean(value.split(SEP)[0]), LIMITS.name); break;
      case 'threat': {
        const p = value.split(SEP).map(clean).filter(Boolean);
        f.threat = firstNum(p[0]);
        f.threatWhy = clip(p.slice(1).join(' · '), L);
        break;
      }
      case 'first': f.first = clip([f.first, clean(value)].filter(Boolean).join(' '), 120); break;
      case 'person': f.person = clip([f.person, clean(value)].filter(Boolean).join(' '), 160); break;
      case 'headline': f.headline = clip(clean(value), 40); break;
      case 'intercepts': {
        const q = value.match(/^["“'‘「『](.+?)["”'’」』]\s*(?:[·•∙|,:\-–—]\s*)?(.*)$/);
        const parts = q ? [q[1], q[2]] : value.split(SEP);
        const said = clean(parts[0]);
        if (said) f.intercepts.push({ said: clip(said, 80), where: clip(clean(parts.slice(1).join(' · ')), 40) });
        break;
      }
      case 'scribbles': f.scribbles.push(clip(clean(value), 28)); break;
      case 'title': f.title = clip(clean(value), LIMITS.title); break;
      case 'profile': {
        const { parts, st, real } = splitEntry(value);
        if (parts.length >= 2) f.profile.push({ label: clip(parts[0], 12), text: clip(parts.slice(1).join(' · '), L), st, real: clip(real, L) });
        else if (parts[0]) f.profile.push({ label: '기타', text: clip(parts[0], L), st, real: clip(real, L) });
        break;
      }
      case 'look': case 'traits': case 'likes': case 'dislikes': {
        const { parts, st, real } = splitEntry(value);
        if (parts.length) f[key].push({ text: clip(parts.join(' · '), L), st, real: clip(real, L) });
        break;
      }
      case 'relations': {
        const { parts, st, real } = splitEntry(value);
        if (parts.length >= 2) f.relations.push({ who: clip(parts[0], LIMITS.name), text: clip(parts.slice(1).join(' · '), L), st, real: clip(real, L) });
        else if (parts[0]) f.relations.push({ who: '—', text: clip(parts[0], L), st, real: clip(real, L) });
        break;
      }
      case 'notes': {
        const { parts, st } = splitEntry(value, 'fact');
        if (parts.length >= 3) f.notes.push({ when: clip(parts[0], 20), where: clip(parts[1], 20), text: clip(parts.slice(2).join(' · '), L), st });
        else if (parts.length === 2) f.notes.push({ when: clip(parts[0], 20), where: '', text: clip(parts[1], L), st });
        else if (parts[0]) f.notes.push({ when: '', where: '', text: clip(parts[0], L), st });
        break;
      }
      case 'incidents': {
        const p = value.split(SEP).map(clean).filter(Boolean);
        if (p.length) f.incidents.push({ name: clip(p[0], 24), text: clip(p.slice(1).join(' · '), 120) });
        break;
      }
      case 'psych': {
        const p = value.split(SEP).map(clean).filter(Boolean);
        const iv = p.findIndex((x) => /^\D{0,3}\d{1,3}\s*(?:%|점)?$/.test(x));
        const v = iv >= 0 ? firstNum(p[iv]) : firstNum(p[1]);
        const rest = p.filter((_, i) => i !== (iv >= 0 ? iv : 1));
        if (rest[0]) f.psych.push({ k: clip(rest[0].replace(/\d+\s*%?/, '').trim() || rest[0], 10), v: v == null ? 50 : v, why: clip(rest.slice(1).join(' · '), L) });
        break;
      }
      case 'verdict': f.verdict = clip([f.verdict, clean(value)].filter(Boolean).join(' '), LIMITS.verdict); break;
      case 'trust': {
        const p = value.split(SEP).map(clean).filter(Boolean);
        f.trust = firstNum(p[0]);
        f.trustWhy = clip(p.slice(1).join(' · ') || p[0].replace(/^\d+\s*%?\s*/, ''), L);
        break;
      }
      case 'restricted': f.restricted.push(clip(clean(value), 120)); break;
      case 'sealed': {
        const p = value.split(SEP).map(clean).filter(Boolean);
        f.sealed.push(clip(p.join(' '), 140));
        break;
      }
      case 'comment': f.comment = clip([f.comment, clean(value)].filter(Boolean).join(' '), LIMITS.comment); break;
    }
    const arr = f[key];
    if (memo && Array.isArray(arr) && arr.length && typeof arr[arr.length - 1] === 'object') arr[arr.length - 1].memo = memo;
  }

  if (hits < 3) return { error: '기록 형식을 찾지 못했습니다. "관찰자: …", "신상: …"처럼 머리말이 있는 답인지 확인해 주세요.' };
  if (!f.subject) return { error: '조사 대상(대상: 이름) 줄이 없습니다.' };
  if (!f.mode) f.mode = /관찰자\s*[A-Z0-9-]|코드명|미상|unknown/i.test(f.observer.name + f.observer.rel) ? 2 : 1;
  if (!f.observer.name) f.observer.name = f.mode === 2 ? 'UNKNOWN' : 'NPC';
  return { data: f };
}
