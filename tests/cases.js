/* 同步回归测试：确保「手机端登录不会用空数据覆盖云端」
   跑法：node tests/extract.js && node tests/cases.js   （或直接 bash tests/run.sh）*/
const path = require('path');
const vm = require('vm');
const { boot } = require('./harness.js');

const IDS = ['moyu','wc','xiaban','naicha','friday','bonus','tang','bing'];
const px = {}, hist = {};
IDS.forEach((id, i) => { px[id] = 50 + i * 5; hist[id] = Array.from({length: 40}, (_, k) => 50 + i * 5 + k * 0.1); });
const CLOUD = {
  settings: { salary: 4500, start: '08:00', end: '16:00', nightStart: '16:00', noLunch: true },
  data: {
    shifts: { '2026-11-13': 'n', '2026-11-14': 'n' },
    ot: { active: null, log: { '2026-11-13': 0.566 } },
    fish: [{cat:'toilet',start:1,end:2,earned:0.03,jar:0},{cat:'phone',start:3,end:4,earned:0.02,jar:0}],
    fishCats: [], stockCustom: [], fishActive: null, rich: {}, wishes: [], wall: [], deposits: [], jar: null,
    stock: { cash: 100000, pos: {}, px, hist, total: Array.from({length:60},(_,k)=>100000+k), t: Date.now(),
             day: { key: '2026-11-13', base: 100000, open: Object.assign({}, px) } }
  },
  at: 1
};
const CLOUD_SAVED = '2026-11-13 19:00:00';

const EMPTY = { fish:[], fishCats:[], stockCustom:[], fishActive:null, ot:{active:null, log:{}},
                rich:{}, wishes:[], wall:[], deposits:[], jar:null, shifts:{} };
const RICH = { shifts:{'2026-11-01':'d','2026-11-02':'n','2026-11-03':'x'},
               ot:{active:null, log:{'2026-11-01':7.5,'2026-11-02':7.5,'2026-11-03':7.5}},
               fish:[{cat:'phone',start:1,end:2},{cat:'toilet',start:3,end:4},{cat:'chat',start:5,end:6}],
               fishCats:[{id:'x'}], stockCustom:[{id:'mine'}],
               wishes:[{id:1,emoji:'🧋',name:'奶茶'},{id:2,emoji:'🎧',name:'耳机'}],
               wall:[], deposits:[], jar:null, fishActive:null, rich:{} };

function seedOf({ anchor, lastEdit, data }) {
  const s = {
    settings: JSON.stringify({ salary: 10000, start: '08:00', end: '16:00', noLunch: true }),
    data: JSON.stringify(data), onboarded: 'true',
    auth: JSON.stringify({ token: 'T', user: 'demo' })
  };
  if (lastEdit) s.lastEdit = String(lastEdit);
  if (anchor) s.syncAnchor = JSON.stringify(anchor);
  return s;
}

async function run(name, seed, expect, prep) {
  const calls = [];
  const fetchMock = (url, opt) => {
    const u = String(url), method = (opt && opt.method) || 'GET';
    calls.push({ u, method, body: opt && opt.body });
    if (u.includes('/data') && method === 'GET')
      return Promise.resolve({ json: () => Promise.resolve({ ok:true, user:'demo', data:CLOUD, saved:CLOUD_SAVED }) });
    if (u.includes('/data') && method === 'POST')
      return Promise.resolve({ json: () => Promise.resolve({ ok:true, saved:'2026-11-13 20:00:00' }) });
    return Promise.resolve({ json: () => Promise.resolve({ ok:true }) });
  };
  const ctx = boot({ fetch: fetchMock }, seed);
  if (prep) vm.runInContext(prep, ctx);
  const r = ctx.reconcile(CLOUD, CLOUD_SAVED);
  await new Promise(res => setTimeout(res, 60));
  const posts = calls.filter(c => c.method === 'POST' && c.u.includes('/data'));
  let base = null;
  if (posts.length) { try { base = JSON.parse(posts[posts.length - 1].body).base; } catch (e) { base = 'ERR'; } }
  const ok = r === expect.way && (expect.base === undefined || base === expect.base);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  → ${r}（期望 ${expect.way}）base=${JSON.stringify(base)}`);
  return ok;
}

(async () => {
  const T = s => Date.parse('2026-11-13 ' + s);
  let all = true;
  all &= await run('A 手机首登：空白数据 + 无锚点 → 拉云端', seedOf({lastEdit: Date.now(), data: EMPTY}), {way:'down'});
  all &= await run('B 手机端点过 1 天（比云端少）→ 仍拉云端',
      seedOf({lastEdit: T('19:59:30'), data:{...EMPTY, shifts:{'2026-11-13':'d'}}}), {way:'down'});
  all &= await run('C 手机端停留很久（无锚点）→ 不覆盖',
      seedOf({anchor:{user:'demo', saved:''}, lastEdit: Date.now(), data: EMPTY}), {way:'down'});
  all &= await run('D 旧电脑升级：数据更丰富 + 更新 → 上传',
      seedOf({lastEdit: T('19:58:10'), data: RICH}), {way:'up', base: CLOUD_SAVED});
  all &= await run('E 已同步 + 本机又改过 → 上传（带 base）',
      seedOf({anchor:{user:'demo', saved:CLOUD_SAVED}, lastEdit: T('19:59:00'), data: RICH}),
      {way:'up', base: CLOUD_SAVED}, `markDirty(); store.set('lastEdit', ${T('19:59:00')});`);
  all &= await run('F 已同步且没改动 → 拉云端',
      seedOf({anchor:{user:'demo', saved:CLOUD_SAVED}, lastEdit: T('19:50:00'), data: RICH}), {way:'down'});
  console.log(all ? '\n全部通过 ✓' : '\n有失败 ✗');
  process.exit(all ? 0 : 1);
})();
