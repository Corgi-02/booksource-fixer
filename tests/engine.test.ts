import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { analyzeText, analyzeBytes, buildExports, summarize, sha256, MAX_FILE_SIZE } from '../src/engine.ts';

const source = { bookSourceName: '测试😀', bookSourceUrl: '一个书源', bookSourceGroup: '本地', bookSourceType: 0, enabled: true };
const analyze = (value: unknown) => analyzeText(JSON.stringify(value));
const output = (analysis: ReturnType<typeof analyzeText>, confirmed = false) =>
  Object.entries(buildExports(analysis, 500, confirmed)).find(([name]) => name.endsWith('_鸿蒙修正版.json'))?.[1];

test('classifies sources and ordinary JSON, requiring confirmation for mixed exports', () => {
  const single = analyze(source);
  assert.equal(single.entries[0].category, 'valid');
  assert.equal(JSON.parse(output(single)!)[0].bookSourceUrl, '一个书源');
  for (const value of [{ theme: 'dark' }, { sourceName: 'RSS', sourceUrl: 'https://example.org' }, 42, null, 'text', []]) {
    assert.equal(summarize(analyze(value)).counts.valid, 0);
    assert.equal(output(analyze(value)), undefined);
  }
  const mixed = analyze([source, { setting: 1 }, { bookSourceName: 'missing URL' },
    { bookSourceName: '', bookSourceUrl: '', ruleContent: { content: '' } }]);
  assert.deepEqual(summarize(mixed).counts, { valid: 1, pending: 1, 'non-source': 1, placeholder: 1 });
  assert.throws(() => buildExports(mixed, 500, false), /确认/);
  const files = buildExports(mixed, 500, true);
  assert.equal(JSON.parse(output(mixed, true)!).length, 1);
  assert.equal(JSON.parse(files['书源_排除项.json']).length, 3);
  assert.ok(Object.keys(buildExports(mixed, 500, false, undefined, true)).some(name => name.endsWith('_诊断报告.json')));
});

test('fills empty groups and removes only known empty extensions', () => {
  for (const group of [undefined, null, '']) {
    assert.equal(JSON.parse(output(analyze({ ...source, bookSourceGroup: group }))!)[0].bookSourceGroup, '未分组');
  }
  assert.equal(analyze({ ...source, bookSourceGroup: {} }).entries[0].category, 'pending');
  const cleaned = analyze({ ...source, ruleReview: { contentRule: '', reviewUrl: '' }, exploreScreen: '',
    ruleToc: { formatJs: '', chapterName: 'text' }, future: { x: 'keep' } });
  assert.equal(cleaned.entries[0].changes.length, 3);
  const fixed = JSON.parse(output(cleaned)!)[0];
  assert.equal(fixed.ruleToc.chapterName, 'text');
  assert.deepEqual(fixed.future, { x: 'keep' });
  for (const [key, value] of Object.entries({ ruleReview: { contentRule: '@js:result' }, exploreScreen: 'keep' })) {
    assert.deepEqual(JSON.parse(output(analyze({ ...source, [key]: value }))!)[0][key], value);
  }
});

test('limits syntax repair to comments and trailing commas without changing rule strings', () => {
  const content = '// hello /* not comments */ }, regex: /a\\d+/ 中文😀 <script>alert(1)</script>';
  const repaired = analyzeText(`/*header*/[${JSON.stringify({ ...source, ruleContent: { content } })}, //last\n]`);
  assert.equal(repaired.fatal, false);
  assert.equal(JSON.parse(output(repaired)!)[0].ruleContent.content, content);
  assert.equal(repaired.changes.length, 2);
  for (const text of ['[{"bookSourceName":"test"', '{"a":"\\q"}', '{"a":"oops}', '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}', "{'a':1}", '{a:1}', '[1,,2]', '[NaN]', '{} garbage', '[1 2]', '/* broken']) {
    const broken = analyzeText(text);
    assert.equal(broken.fatal, true, text);
    assert.ok(broken.issues[0].line);
    assert.equal(output(broken), undefined);
  }
});

test('converts unambiguous scalar strings and rejects invalid types or ranges', () => {
  const converted = output(analyze({ ...source, enabled: 'false', customOrder: '-2', lastUpdateTime: '9223372036854775807' }))!;
  assert.ok(converted.includes('9223372036854775807'));
  assert.equal(JSON.parse(converted)[0].enabled, false);
  for (const fields of [{ enabled: 1 }, { enabled: 'yes' }, { customOrder: '1.5' }, { bookSourceType: 4 },
    { weight: '2147483648' }, { respondTime: -1 }, { lastUpdateTime: '9223372036854775808' }, { ruleContent: 'x' }]) {
    assert.equal(analyze({ ...source, ...fields }).entries[0].category, 'pending', JSON.stringify(fields));
  }
});

test('preserves numeric precision and unknown keys without prototype pollution', () => {
  const analysis = analyzeText('[{"bookSourceName":"test","bookSourceUrl":"1","bookSourceGroup":"g","huge":900719925474099312345,"decimal":1.000001e+30,"__proto__":{"polluted":true}}]');
  const fixed = output(analysis)!;
  assert.ok(fixed.includes('900719925474099312345'));
  assert.ok(fixed.includes('1.000001e+30'));
  assert.ok(fixed.includes('"__proto__"'));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('warns on duplicate source identifiers without deleting or reordering records', () => {
  const analysis = analyze([source, { ...source, bookSourceName: '第二条' }]);
  assert.equal(analysis.entries[1].issues[0].code, 'duplicate-source');
  assert.deepEqual(JSON.parse(output(analysis)!).map((item: typeof source) => item.bookSourceName), [source.bookSourceName, '第二条']);
});

test('exports idempotent UTF-8 JSON and batches that reconstruct the full result', () => {
  const analysis = analyze(Array.from({ length: 7 }, (_, i) => ({ ...source, bookSourceUrl: String(i), ruleReview: {}, bookSourceGroup: null })));
  const files = buildExports(analysis, 3, false);
  const full = output(analysis)!;
  const batches = Object.entries(files).filter(([path]) => path.startsWith('分批/')).flatMap(([, text]) => JSON.parse(text));
  assert.deepEqual(batches, JSON.parse(full));
  const again = analyzeText(full);
  assert.equal(summarize(again).changeCount, 0);
  assert.equal(output(again), full);
  assert.equal(full.charCodeAt(0), 91);
  assert.throws(() => buildExports(analysis, 0, false));
  assert.throws(() => buildExports(analysis, 1.5, false));
});

test('decodes BOM-marked UTF-8 and UTF-16 without accepting invalid encoding', () => {
  const text = JSON.stringify([source]);
  const utf8 = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(text)]);
  assert.equal(analyzeBytes(utf8, 'utf8.json').entries[0].name, source.bookSourceName);
  const le = Buffer.from('\ufeff' + text, 'utf16le');
  const be = Uint8Array.from(le);
  for (let i = 0; i < be.length; i += 2) [be[i], be[i + 1]] = [be[i + 1], be[i]];
  for (const bytes of [le, be]) {
    const analysis = analyzeBytes(bytes, 'utf16.json');
    assert.equal(analysis.fatal, false);
    assert.equal(analysis.entries[0].name, source.bookSourceName);
    assert.equal(analysis.changes.length, 2);
  }
  assert.equal(analyzeBytes(Uint8Array.from([255, 255, 123]), 'bad.json').issues[0].code, 'encoding-error');
});

test('SHA-256 matches independent reference hashes across block boundaries', () => {
  for (const length of [0, 3, 55, 56, 64, 1000, 100000]) {
    const bytes = Uint8Array.from({ length }, (_, i) => i % 251);
    assert.equal(sha256(bytes), createHash('sha256').update(bytes).digest('hex'));
  }
});

test('rejects excessive file size and nesting before processing', () => {
  assert.equal(analyzeBytes(new Uint8Array(MAX_FILE_SIZE + 1), 'big.json').issues[0].code, 'size-limit');
  assert.equal(analyzeText('['.repeat(130) + '0' + ']'.repeat(130)).issues[0].code, 'depth-limit');
});
