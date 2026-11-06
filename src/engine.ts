import { createScanner, parseTree, printParseErrorCode, SyntaxKind, type Node, type ParseError } from 'jsonc-parser';
import profile from './compatibility.json';

export const TOOL_VERSION = '1.0.0';
export const RULE_VERSION = profile.version;
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 100 * 1024 * 1024;
export class RawNumber { constructor(public raw: string) {} }
export type Json = null | boolean | string | RawNumber | Json[] | { [key: string]: Json };
export interface Issue { code: string; severity: 'warning' | 'error'; message: string; path?: string; line?: number; column?: number }
export interface Change { path: string; reason: string; before: string; after: string }
export type Category = 'valid' | 'pending' | 'non-source' | 'placeholder';
export interface Entry {
  index: number; category: Category; name: string; url: string;
  original: Json; fixed?: Json; changes: Change[]; issues: Issue[];
}
export interface Analysis {
  filename: string; size: number; sha256: string; encoding: string;
  entries: Entry[]; changes: Change[]; issues: Issue[]; fatal: boolean; single: boolean;
}
export interface Summary {
  filename: string; size: number; sha256: string; encoding: string; fatal: boolean;
  changes: Change[]; issues: Issue[]; counts: Record<Category, number>; issueCount: number; changeCount: number;
  entries: (Omit<Entry, 'original' | 'fixed' | 'changes'> & { changeCount: number })[];
}

export function isObject(v: Json | undefined): v is { [key: string]: Json } {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RawNumber);
}
const has = (v: object, k: string) => Object.hasOwn(v, k);
export function serialize(v: Json, depth = 0): string {
  if (v instanceof RawNumber) return v.raw;
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const indent = '  '.repeat(depth), next = indent + '  ';
  if (Array.isArray(v)) return v.length ? '[\n' + v.map(x => next + serialize(x, depth + 1)).join(',\n') + '\n' + indent + ']' : '[]';
  const keys = Object.keys(v);
  return keys.length ? '{\n' + keys.map(k => next + JSON.stringify(k) + ': ' + serialize(v[k], depth + 1)).join(',\n') + '\n' + indent + '}' : '{}';
}
function clone(v: Json): Json {
  if (v instanceof RawNumber) return new RawNumber(v.raw);
  if (Array.isArray(v)) return v.map(clone);
  if (isObject(v)) { const out = Object.create(null); for (const k of Object.keys(v)) out[k] = clone(v[k]); return out; }
  return v;
}
function empty(v: Json | undefined): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) ? v.length === 0 : isObject(v) && Object.values(v).every(empty));
}
function position(text: string, offset: number) {
  const lines = text.slice(0, offset).split('\n');
  return { line: lines.length, column: lines.at(-1)!.length + 1 };
}
function fromNode(node: Node, text: string, issues: Issue[], path = '$'): Json {
  if (node.type === 'number') return new RawNumber(text.slice(node.offset, node.offset + node.length));
  if (node.type === 'array') return (node.children ?? []).map((x, i) => fromNode(x, text, issues, `${path}[${i}]`));
  if (node.type === 'object') {
    const out = Object.create(null);
    for (const property of node.children ?? []) {
      const [keyNode, valueNode] = property.children!;
      const key = keyNode.value as string;
      if (has(out, key)) issues.push({ code: 'duplicate-key', severity: 'error', message: `JSON 键重复：${key}。请明确保留哪一个值。`, path: `${path}.${key}`, ...position(text, keyNode.offset) });
      out[key] = fromNode(valueNode, text, issues, `${path}.${key}`);
    }
    return out;
  }
  return node.value as Json;
}
const fieldTypes = profile.fieldTypes as Record<string, string>;
function integerValue(v: Json): bigint | null {
  if (!(v instanceof RawNumber) && typeof v !== 'string') return null;
  const raw = typeof v === 'string' ? v : v.raw;
  if (!/^-?(0|[1-9]\d*)$/.test(raw)) return null;
  try { return BigInt(raw); } catch { return null; }
}
function integerInRange(key: string, v: bigint): boolean {
  if (key === 'bookSourceType') return v >= 0n && v <= 3n;
  if (key === 'customOrder' || key === 'weight') return v >= -2147483648n && v <= 2147483647n;
  return v >= 0n && v <= 9223372036854775807n;
}
function analyzeEntry(original: Json, index: number): Entry {
  const result: Entry = { index, original, name: '', url: '', category: 'non-source', changes: [], issues: [] };
  if (!isObject(original) || !['bookSourceName', 'bookSourceUrl'].some(k => has(original, k))) {
    result.issues.push({ code: 'not-booksource', severity: 'warning', message: '未发现 bookSourceName 或 bookSourceUrl；不是可识别的 Legado 3 书源对象。' });
    return result;
  }
  result.name = typeof original.bookSourceName === 'string' ? original.bookSourceName : '';
  result.url = typeof original.bookSourceUrl === 'string' ? original.bookSourceUrl : '';
  const blankIdentifier = (v: Json | undefined) => v === undefined || v === null || typeof v === 'string' && !v.trim();
  if (blankIdentifier(original.bookSourceName) && blankIdentifier(original.bookSourceUrl) && Object.entries(original).filter(([k]) => k.startsWith('rule')).every(([, v]) => empty(v))) {
    result.category = 'placeholder';
    result.issues.push({ code: 'empty-placeholder', severity: 'warning', message: '名称、标识及解析规则均为空的占位记录，已移入排除项。' });
    return result;
  }
  result.category = 'valid';
  const fixed = clone(original) as { [key: string]: Json };
  result.fixed = fixed;
  const change = (path: string, reason: string, before: Json | undefined, after: Json | undefined) => result.changes.push({ path, reason, before: before === undefined ? '（字段缺失）' : serialize(before), after: after === undefined ? '（移除字段）' : serialize(after) });
  if (!has(fixed, 'bookSourceGroup') || fixed.bookSourceGroup === null || fixed.bookSourceGroup === '') {
    change('bookSourceGroup', '补齐空缺分组', fixed.bookSourceGroup, '未分组'); fixed.bookSourceGroup = '未分组';
  }
  function validate(obj: { [key: string]: Json }, parent = '') {
    for (const key of Object.keys(obj)) {
      const path = parent ? `${parent}.${key}` : key;
      const value = obj[key];
      if (profile.emptyExtensions.includes(path)) {
        if (empty(value)) { change(path, '清除已验证的空扩展字段', value, undefined); delete obj[key]; continue; }
        result.issues.push({ code: 'extension-content', severity: 'warning', path, message: '扩展字段包含内容，已保留；当前兼容配置未确认其鸿蒙支持情况。' });
        continue;
      }
      const expected = has(fieldTypes, path) ? fieldTypes[path] : undefined;
      if (!expected) {
        result.issues.push({ code: 'unknown-field', severity: 'warning', path, message: '当前兼容配置未收录的字段，已原样保留。' });
        continue;
      }
      let valid = false;
      if (expected === 'boolean') {
        if (value === 'true' || value === 'false') { obj[key] = value === 'true'; change(path, '将明确的布尔字符串转为布尔值', value, obj[key]); }
        valid = typeof obj[key] === 'boolean';
      } else if (expected === 'integer') {
        const n = integerValue(value);
        valid = n !== null && integerInRange(path, n);
        if (valid && typeof value === 'string') { obj[key] = new RawNumber(value); change(path, '将范围有效的整数字符串转为整数', value, obj[key]); }
      } else if (expected === 'object') {
        valid = isObject(value);
        if (valid) validate(value as { [key: string]: Json }, path);
      } else valid = typeof value === 'string';
      if (!valid) result.issues.push({ code: 'field-type', severity: 'error', path, message: `字段需要 ${expected} 类型或符合范围的值；无法无歧义修正，保留原记录供处理。` });
    }
  }
  validate(fixed);
  for (const key of ['bookSourceName', 'bookSourceUrl']) {
    if (typeof fixed[key] !== 'string' || !(fixed[key] as string).trim()) result.issues.push({ code: 'required-field', severity: 'error', path: key, message: `${key} 必须为非空字符串；不会编造名称或标识。` });
  }
  if (result.issues.some(i => i.severity === 'error')) { result.category = 'pending'; delete result.fixed; }
  return result;
}

export function analyzeText(input: string, filename = '书源.json'): Analysis {
  const analysis: Analysis = { filename, size: new TextEncoder().encode(input).length, sha256: '', encoding: 'UTF-8', entries: [], issues: [], changes: [], fatal: false, single: false };
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); analysis.changes.push({ path: '$', reason: '移除文件 BOM', before: '有 BOM', after: '无 BOM' }); }
  const scan = createScanner(text, false);
  let comments = 0, commas = 0, depth = 0, previous: SyntaxKind | null = null;
  let token: SyntaxKind;
  while ((token = scan.scan()) !== SyntaxKind.EOF) {
    if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) { comments++; continue; }
    if (token === SyntaxKind.Trivia || token === SyntaxKind.LineBreakTrivia) continue;
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) depth++;
    if (depth > 128) {
      analysis.issues.push({ code: 'depth-limit', severity: 'error', message: '嵌套超过 128 层，停止处理以保护浏览器。', ...position(text, scan.getTokenOffset()) }); analysis.fatal = true; return analysis;
    }
    if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) { if (previous === SyntaxKind.CommaToken) commas++; depth--; }
    previous = token;
  }
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false, allowEmptyContent: false });
  if (!tree || errors.length) {
    analysis.fatal = true;
    analysis.issues.push(...errors.map(error => ({ code: 'syntax-error', severity: 'error' as const, message: `JSON 语法错误：${printParseErrorCode(error.error)}。请检查引号、转义和文件是否完整。`, ...position(text, error.offset) })));
    if (!analysis.issues.length) analysis.issues.push({ code: 'syntax-error', severity: 'error', message: '文件为空或不是 JSON。', line: 1, column: 1 });
    return analysis;
  }
  const root = fromNode(tree, text, analysis.issues);
  if (analysis.issues.length) { analysis.fatal = true; return analysis; }
  if (comments) analysis.changes.push({ path: '$', reason: '移除 JSON 字符串外的注释', before: `${comments} 处注释`, after: '严格 JSON' });
  if (commas) analysis.changes.push({ path: '$', reason: '移除末尾多余逗号', before: `${commas} 处末尾逗号`, after: '严格 JSON' });
  analysis.single = !Array.isArray(root);
  if (analysis.single && isObject(root) && (has(root, 'bookSourceName') || has(root, 'bookSourceUrl'))) analysis.changes.push({ path: '$', reason: '将单个书源对象包装为数组', before: '单个对象', after: '书源数组' });
  const items = Array.isArray(root) ? root : [root];
  analysis.entries = items.map((entry, i) => analyzeEntry(entry, i + 1));
  const seen = new Map<string, number>();
  for (const entry of analysis.entries) {
    if (!entry.url.trim()) continue;
    if (seen.has(entry.url)) entry.issues.push({ code: 'duplicate-source', severity: 'warning', path: 'bookSourceUrl', message: `标识与第 ${seen.get(entry.url)} 条重复。导入阅读时可能覆盖，已保留原顺序。` });
    else seen.set(entry.url, entry.index);
  }
  if (!items.length) analysis.issues.push({ code: 'empty-array', severity: 'warning', message: '这是空数组，没有可导出的书源。' });
  return analysis;
}

// Pure SHA-256 also works on LAN HTTP, where crypto.subtle is unavailable.
export function sha256(bytes: Uint8Array): string {
  const k = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64); data.set(bytes); data[bytes.length] = 0x80;
  new DataView(data.buffer).setBigUint64(data.length - 8, BigInt(bytes.length) * 8n);
  const w = new Uint32Array(64), rotate = (n: number, r: number) => (n >>> r) | (n << (32 - r));
  for (let offset = 0; offset < data.length; offset += 64) {
    const view = new DataView(data.buffer, offset, 64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) { const x = w[i - 15], y = w[i - 2]; w[i] = w[i - 16] + (rotate(x,7)^rotate(x,18)^(x>>>3)) + w[i - 7] + (rotate(y,17)^rotate(y,19)^(y>>>10)); }
    let [a,b,c,d,e,f,g,z] = h;
    for (let i = 0; i < 64; i++) { const t = (z + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + ((e&f)^(~e&g)) + k[i] + w[i]) >>> 0; const u = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0; z=g;g=f;f=e;e=(d+t)>>>0;d=c;c=b;b=a;a=(t+u)>>>0; }
    [a,b,c,d,e,f,g,z].forEach((v, i) => h[i] = (h[i] + v) >>> 0);
  }
  return [...h].map(v => v.toString(16).padStart(8, '0')).join('');
}

export function analyzeBytes(bytes: Uint8Array, filename: string): Analysis {
  let encoding = 'UTF-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'UTF-16LE';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'UTF-16BE';
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf || encoding !== 'UTF-8';
  let result: Analysis;
  if (bytes.length > MAX_FILE_SIZE) return { filename, size: bytes.length, sha256: '', encoding, entries: [], changes: [], issues: [{code:'size-limit', severity:'error',message:'单文件超过 50 MiB，未读取或处理。'}], fatal:true, single:false };
  try {
    result = analyzeText(new TextDecoder(encoding, { fatal: true }).decode(bytes), filename);
    result.encoding = encoding;
    if (bom) result.changes.unshift({ path: '$', reason: '移除文件 BOM', before: `${encoding} 有 BOM`, after: 'UTF-8 无 BOM' });
    if (encoding !== 'UTF-8') result.changes.unshift({ path: '$', reason: '转换文件编码', before: encoding, after: 'UTF-8' });
  } catch {
    result = { filename, size: bytes.length, sha256: '', encoding, entries: [], changes: [], issues: [{ code: 'encoding-error', severity: 'error', message: '无法按 UTF-8 或带 BOM 的 UTF-16 可靠解码。请先转换文件编码。' }], fatal: true, single: false };
  }
  result.size = bytes.length; result.sha256 = sha256(bytes);
  return result;
}
export function summarize(a: Analysis): Summary {
  const counts: Record<Category, number> = { valid: 0, pending: 0, 'non-source': 0, placeholder: 0 };
  for (const e of a.entries) counts[e.category]++;
  return { filename:a.filename, size:a.size, sha256:a.sha256, encoding:a.encoding, fatal:a.fatal, changes:a.changes, issues:a.issues, counts,
    issueCount: a.issues.length + a.entries.reduce((n,e) => n + e.issues.length,0),
    changeCount: a.changes.length + a.entries.reduce((n,e) => n + (e.category==='valid' ? e.changes.length : 0),0),
    entries: a.entries.map(({original: _o,fixed: _f,changes: _c,...e})=>({...e,changeCount:_c.length})) };
}
export function entryDetail(a: Analysis, index: number) {
  const entry = a.entries.find(e => e.index === index);
  if (!entry) throw Error('记录不存在');
  return { ...entry, original: serialize(entry.original), fixed: entry.fixed ? serialize(entry.fixed) : null };
}
export function buildExports(a: Analysis, batchSize: number, confirmed: boolean, device: { version: string; result: string } = {version:'',result:'未实测'}, diagnosticOnly = false) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) throw Error('每批数量应为 1–10000 的整数');
  const valid = a.entries.filter(e => e.category === 'valid');
  const excluded = a.entries.filter(e => e.category !== 'valid');
  if (!diagnosticOnly && valid.length && excluded.length && !confirmed) throw Error('请先确认仅提取有效书源');
  const base = a.filename.replace(/\.[^.]*$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0,100) || '书源';
  const files: Record<string, string> = Object.create(null);
  const json = (v: Json) => serialize(v) + '\n';
  if (!diagnosticOnly && !a.fatal && valid.length) {
    files[`${base}_鸿蒙修正版.json`] = json(valid.map(e => e.fixed!));
    for (let i = 0; i < valid.length; i += batchSize) files[`分批/${base}_第${String(Math.floor(i/batchSize)+1).padStart(2,'0')}批.json`] = json(valid.slice(i,i+batchSize).map(e=>e.fixed!));
  }
  if (excluded.length) files[`${base}_排除项.json`] = json(excluded.map(e=>e.original));
  const report = {
    toolVersion: TOOL_VERSION, ruleVersion: RULE_VERSION, target: profile.target, ruleReference: profile.reference,
    generatedAt: new Date().toISOString(), input: {filename:a.filename,bytes:a.size,sha256:a.sha256,encoding:a.encoding},
    validation: {format: a.fatal ? '语法或编码校验失败' : valid.length ? '导出书源格式校验通过' : '未识别到有效书源', device:{version:device.version || '未填写', result:device.result}, limitation:'格式校验不代表网站可访问、规则可运行或设备导入一定成功。'},
    summary: summarize(a).counts, fileChanges:a.changes, fileIssues:a.issues,
    entries:a.entries.map(e=>({index:e.index,name:e.name,url:e.url,category:e.category,changes:e.changes,changesApplied:e.category==='valid',issues:e.issues})),
    export: {batchSize,extractionConfirmed:confirmed, valid:valid.length, excluded:excluded.length}
  };
  files[`${base}_诊断报告.json`] = JSON.stringify(report,null,2)+'\n';
  return files;
}
