const KEY = 'eyes_only:files';
const PREF = 'eyes_only:';

export const pref = {
  get(k) { try { return localStorage.getItem(PREF + k); } catch { return null; } },
  set(k, v) {
    try {
      if (v == null || v === '') localStorage.removeItem(PREF + k);
      else localStorage.setItem(PREF + k, String(v));
    } catch { /* storage unavailable */ }
  },
};

let files = [];
let persistent = true;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    files = Array.isArray(list) ? list.filter((f) => f && f.id && f.subject) : [];
  } catch {
    files = [];
    persistent = false;
  }
  return files;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(files)); persistent = true; return true; } catch { persistent = false; return false; }
}

/* 보고서 일부를 고친다. 저장 공간이 모자라면 되돌리고 false */
export function patch(id, data) {
  const f = files.find((x) => x.id === id);
  if (!f) return false;
  const before = {};
  Object.keys(data).forEach((k) => { before[k] = f[k]; });
  Object.assign(f, data);
  if (save()) return true;
  Object.assign(f, before);
  save();
  return false;
}

export const isPersistent = () => persistent;
export const all = () => files.slice().sort((a, b) => (b.at || '').localeCompare(a.at || ''));
export const byId = (id) => files.find((f) => f.id === id) || null;

function nextNo(mode, at) {
  const d = new Date(at);
  const ym = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const seq = files.reduce((n, f) => {
    const m = String(f.no || '').match(/-(\d{3})$/);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0) + 1;
  return `EO-${mode === 2 ? '02' : '01'}-${ym}-${String(seq).padStart(3, '0')}`;
}

const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export function add(data, { at, trigger = '', sample = false } = {}) {
  const when = at || new Date().toISOString();
  const file = { ...data, id: uid(), no: nextNo(data.mode, when), at: when, trigger: String(trigger || '').slice(0, 30), sample };
  files.push(file);
  save();
  return file;
}

/* 인물 한 명당 보고서 하나: 같은 대상이 있으면 그 파일을 새 내용으로 바꾼다 */
export function upsert(data, { trigger = '' } = {}) {
  const i = files.findIndex((f) => f.subject === data.subject);
  if (i < 0) return { file: add(data, { trigger }), replaced: false };
  const old = files[i];
  const file = { ...data, id: old.id, no: old.no, at: new Date().toISOString(), trigger: String(trigger || '').slice(0, 30), sample: false };
  files[i] = file;
  save();
  return { file, replaced: true };
}

/* 나눠 받은 답을 같은 보고서에 합친다. 답에 들어 있는 칸만 바꾼다 */
export function merge(data, { id = '', trigger = '' } = {}) {
  let f = id ? files.find((x) => x.id === id) : null;
  if (!f || f.subject !== data.subject) f = files.find((x) => x.subject === data.subject);
  if (!f) return { file: add(data, { trigger }), created: true };
  for (const [k, v] of Object.entries(data)) {
    if (k === 'mode') continue;
    if (Array.isArray(v)) { if (v.length) f[k] = v; continue; }
    if (k === 'observer') {
      if (v && v.name && !/^(NPC|UNKNOWN)$/.test(v.name)) f.observer = { name: v.name, rel: v.rel || f.observer?.rel || '' };
      continue;
    }
    if (v !== '' && v != null) f[k] = v;
  }
  if (trigger) f.trigger = String(trigger).slice(0, 30);
  f.at = new Date().toISOString();
  f.sample = false;
  save();
  return { file: f, created: false };
}

export function remove(id) {
  files = files.filter((f) => f.id !== id);
  save();
}

export function clear({ samplesOnly = false } = {}) {
  files = samplesOnly ? files.filter((f) => !f.sample) : [];
  save();
}

export function importList(list) {
  if (!Array.isArray(list)) throw new Error('형식 오류');
  let n = 0;
  for (const f of list) {
    if (!f || typeof f !== 'object' || !f.subject) continue;
    const dup = files.some((x) => x.id === f.id);
    files.push({ ...f, id: dup || !f.id ? uid() : f.id });
    n++;
  }
  save();
  return n;
}

export function exportJson() {
  return JSON.stringify({ app: 'eyes_only', version: 1, exported: new Date().toISOString(), files: all() }, null, 2);
}

/* 공유 링크: 보고서 1건을 압축해 주소 뒤에 담는다 */
const canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
const b64u = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export async function pack(file) {
  const { id, sample, camImgs, ...rest } = file;
  const raw = new TextEncoder().encode(JSON.stringify(rest));
  if (canZip) {
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return 'z' + b64u(z);
  }
  return 'j' + b64u(raw);
}

export async function unpack(code) {
  const kind = code[0];
  let bytes = unb64u(code.slice(1));
  if (kind === 'z') {
    if (!canZip) throw new Error('이 브라우저는 압축 링크를 열 수 없습니다.');
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || !data.subject) throw new Error('보고서 형식이 아닙니다.');
  return data;
}
