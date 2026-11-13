/* 鼓励语回归测试：文案是否按时段切换、每个时段是否都有内容
   跑法：node tests/extract.js && node tests/gift.js
   只校验结构与映射，不改文案措辞 —— 文案随时可改，映射错了才是 bug */
const vm = require('vm');
const { boot } = require('./harness.js');

const SHIFTS = { '2026-11-13': 'd', '2026-11-14': 'n', '2026-11-15': 'x' };
function seed(shifts) {
  return {
    settings: JSON.stringify({ salary: 4500, start: '08:00', end: '16:00', nightStart: '16:00', nightEnd: '00:00', noLunch: true, days: [1,2,3,4,5] }),
    data: JSON.stringify({ shifts, ot: { active: null, log: {} }, fish: [], fishCats: [], stockCustom: [],
                           fishActive: null, rich: {}, wishes: [], wall: [], deposits: [], jar: null }),
    onboarded: 'true'
  };
}

const ctx = boot({ fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) }) }, seed(SHIFTS));
const at = (iso) => vm.runInContext(`giftScene(new Date('${iso}'))`, ctx);

const cases = [
  ['2026-11-13T07:00:00', 'pre',    '上班前'],
  ['2026-11-13T10:00:00', 'day',    '白班（产品咨询）'],
  ['2026-11-13T15:59:00', 'day',    '白班尾巴仍是白班'],
  ['2026-11-14T16:30:00', 'night1', '夜班前段（售后开始）'],
  ['2026-11-14T18:59:00', 'night1', '19 点前算前段'],
  ['2026-11-14T19:00:00', 'night2', '19 点后算售后高峰'],
  ['2026-11-14T23:30:00', 'night2', '深夜仍是高峰'],
  ['2026-11-15T14:00:00', 'rest',   '休息日'],
  ['2026-11-16T09:00:00', 'day',    '未排班的周一按默认工作日兜底 → 白班']
];

let fail = 0;
cases.forEach(([iso, want, note]) => {
  const got = at(iso);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${iso}  → ${got}（期望 ${want}） ${note}`);
});

// 结构检查：每个时段都有足够的短句与长句
const scenes = vm.runInContext('JSON.stringify(Object.keys(GIFT.scenes))', ctx);
console.log('\n时段:', JSON.parse(scenes).join(' / '));
const bad = vm.runInContext(`JSON.stringify(Object.entries(GIFT.scenes).filter(([k,v]) =>
  !(v.cheer && v.cheer.length >= 3 && v.word && v.word.length >= 3 &&
    v.cheer.every(x => x && x.length >= 4) && v.word.every(x => x && x.length >= 8))).map(([k]) => k))`, ctx);
const badList = JSON.parse(bad);
if (badList.length) { fail++; console.log('FAIL  文案不足的时段:', badList.join(', ')); }
else console.log('PASS  每个时段都至少有 3 条短句 + 3 段长句');

const sign = vm.runInContext(`'——' + GIFT.from`, ctx);
if (!/^——\S+$/.test(sign)) { fail++; console.log(`FAIL  落款格式不对: ${sign}`); }
else console.log(`PASS  落款格式 ${sign}`);

// 共用取词：桌面小窗读的是 giftPicks，必须与主页面 renderGift 写进 DOM 的内容一致
const pair = JSON.parse(vm.runInContext(`(() => {
  const n = new Date('2026-11-14T21:00:00');
  const g = giftPicks(n);
  renderGift(n);
  return JSON.stringify({ cheer: g.cheer, word: g.word, warm: g.warm,
                          domCheer: $('cdCheer').textContent, domWord: $('giftLine').textContent });
})()`, ctx));
const same = pair.cheer === pair.domCheer && pair.word === pair.domWord;
if (!same) fail++;
console.log(`${same ? 'PASS' : 'FAIL'}  giftPicks 与页面渲染一致（小窗用同一套词）`);

// 渲染检查：真的写进了 DOM
const rendered = vm.runInContext(`(() => {
  const n = new Date('2026-11-14T21:00:00');
  renderGift(n);
  return JSON.stringify({ cheer: $('cdCheer').textContent, word: $('giftLine').textContent,
                          warm: $('cdCheer').classList.contains ? 'n/a' : 'n/a' });
})()`, ctx);
const r = JSON.parse(rendered);
const hasText = r.cheer.length > 0 && r.word.length > 0;
if (!hasText) fail++;
console.log(`${hasText ? 'PASS' : 'FAIL'}  夜班高峰渲染: 「${r.cheer}」/「${r.word.slice(0, 20)}…」`);

console.log(fail ? `\n有 ${fail} 项失败 ✗` : '\n全部通过 ✓');
process.exit(fail ? 1 : 0);
