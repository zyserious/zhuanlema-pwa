
/* ---------- gift config（专属版，想改只动这里）---------- */
const GIFT = {
  to: 'demo',    // ← 收礼人的昵称，改成你自己的
  from: '想天天给你花钱的那个人',   // ← 署名
  lines: [
    '这不是工资，是我给你的零花钱进度条 🧡',
    '每一秒都在涨，就像我对你的喜欢。',
    '钱是假的，想给你花钱的心是真的。',
    '好好上班，攒够愿望我请客。',
    '搬砖是为了生活，生活里要有你。',
    '今天也要开开心心，钱和爱你都收下。'
  ]
};
/* ---------- storage ---------- */
const mem = {};
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : (k in mem ? mem[k] : d); }catch(e){ return k in mem ? mem[k] : d; } },
  set(k, v){ mem[k] = v; try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const AUTH = Object.assign({token: '', user: ''}, store.get('auth', {}) || {});
let applyingRemote = false;

const DEFAULTS = {
  salary:10000, payDays:21.75, payday:15,
  start:'08:00', end:'16:00',                     // 白班 8:00 - 16:00
  nightStart:'16:00', nightEnd:'00:00',           // 夜班 16:00 - 次日 0:00
  lunchStart:'12:00', lunchEnd:'13:00', lunchPaid:false, noLunch:true,
  days:[1,2,3,4,5],
  unitEmoji:'🧋', unitName:'奶茶', unitWord:'杯', unitPrice:20,
  richAsset:3000000000000, sound:true, hidden:false, saveRate:20,
  remindOn:true, remindMin:30, evePreview:true, eveHour:21
};
/* ============================================================
   数据升级原则（务必守住）：
   1) 只「新增」缺失字段，绝不覆盖用户已经设置过的值
   2) 任何一次性迁移都要打标记，永远不会跑第二次
   3) 写回之前先备份一份原始数据，出问题能还原
   ============================================================ */
const SCHEMA = 3;
const savedSettings = store.get('settings', {}) || {};
let S = Object.assign({}, DEFAULTS, savedSettings);          // 先铺默认值，再让用户的值覆盖它
(function migrateSettings(){
  const added = Object.keys(DEFAULTS).filter(k => !(k in savedSettings));
  const mig = Array.isArray(S._mig) ? S._mig.slice() : [];
  // 一次性迁移：老版本「固定 9-6」→ 客服白班 8-16（只在从未迁移、且仍是旧默认时间时执行）
  if(!mig.includes('shift-0816') && !savedSettings.nightStart && S.start === '09:00' && S.end === '18:00'){
    S.start = '08:00'; S.end = '16:00';
    mig.push('shift-0816');
  }
  if(!mig.includes('schema-' + SCHEMA)) mig.push('schema-' + SCHEMA);
  const changed = added.length > 0 || mig.length !== ((S._mig || []).length);
  S._mig = mig;
  S._v = SCHEMA;
  if(changed){
    // 备份原始设置（每个版本只备份一次，避免占用空间）
    if(!store.get('backup_v' + SCHEMA, null)){
      store.set('backup_v' + SCHEMA, {at: Date.now(), settings: savedSettings, data: store.get('data', {})});
    }
    store.set('settings', S);
  }
})();
let D = Object.assign({ fish:[], fishCats:[], stockCustom:[], fishActive:null, ot:{active:null, log:{}}, rich:{}, wishes:[], wall:[], deposits:[], jar:null, shifts:{} }, store.get('data', {}));
if(!D.ot) D.ot = {active:null, log:{}};
if(!D.shifts) D.shifts = {};
// 本机是否还有没推到服务器的改动（防止登录/同步时被服务器旧数据覆盖）
let dirty = false;
function markDirty(){
  if(applyingRemote) return;
  dirty = true; store.set('lastEdit', Date.now());
}
const saveS = () => { store.set('settings', S); markDirty(); queueDataSync(); };
const saveD = () => { store.set('data', D); markDirty(); queueDataSync(); };
/* 行情/计时这类自动变化不写 lastEdit：
   否则页面只要开着就永远「本机有改动」，登录时会把云端数据当成旧的覆盖掉 */
function saveTick(){
  store.set('data', D);
  if(AUTH.token && anchored()) queueDataSync(true);
}

const $ = id => document.getElementById(id);

/* ---------- formatting ---------- */
const fix = (n, d=2) => Number(n).toLocaleString('zh-CN', {minimumFractionDigits:d, maximumFractionDigits:d});
const yuan = n => '¥' + fix(n);
const masked = s => S.hidden ? '¥***' : s;
const pad = x => String(x).padStart(2, '0');
function clock(sec, forceH){
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
  return (h || forceH ? pad(h)+':' : '') + pad(m) + ':' + pad(s);
}
function dur(sec){
  sec = Math.floor(sec);
  if(sec < 60) return sec + ' 秒';
  const m = Math.floor(sec/60);
  if(m < 60) return m + ' 分钟';
  const h = Math.floor(m/60), mm = m%60;
  return h + ' 小时' + (mm ? ' ' + mm + ' 分钟' : '');
}
function durShort(sec){
  sec = Math.floor(sec);
  if(sec < 60) return sec + ' 秒';
  const m = Math.floor(sec/60), s = sec%60;
  return m < 60 ? m + ' 分 ' + s + ' 秒' : dur(sec);
}
function big(n){
  const a = Math.abs(n), t = (v) => v.toFixed(2).replace(/\.?0+$/, '');
  if(a >= 1e12) return t(n/1e12) + ' 万亿';
  if(a >= 1e8) return t(n/1e8) + ' 亿';
  if(a >= 1e4) return t(n/1e4) + ' 万';
  return fix(n, 0);
}
const dateKey = d => d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
const hhmm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const WEEK = ['日','一','二','三','四','五','六'];

/* ---------- salary math ---------- */
const hm = s => { const [h, m] = String(s).split(':').map(Number); return h*3600 + m*60; };
const dayStart = t => { const d = new Date(t); d.setHours(0,0,0,0); return d; };
const secOfDay = d => d.getHours()*3600 + d.getMinutes()*60 + d.getSeconds() + d.getMilliseconds()/1000;

/* ---------- 排班：白班 / 夜班 / 休息 ---------- */
const SHIFT = {
  d: {key:'d', name:'白班', short:'白', emoji:'☀️',  color:'#FFC53D'},
  n: {key:'n', name:'夜班', short:'夜', emoji:'🌙',  color:'#5B8DEF'},
  x: {key:'x', name:'休息', short:'休', emoji:'😴',  color:'#DDD5C4'}
};
const endHm = s => { const v = hm(s); return v === 0 ? 86400 : v; };   // 00:00 视为次日 0 点
// 某天的班次：手动排班优先，没排就按「工作日」默认（周内白班 / 周末休息）
function shiftOf(d){
  const k = dateKey(d), saved = D.shifts && D.shifts[k];
  if(saved === 'd' || saved === 'n' || saved === 'x') return saved;
  return S.days.includes(d.getDay()) ? 'd' : 'x';
}
const isScheduled = d => !!(D.shifts && D.shifts[dateKey(d)]);
// 某天的班次时间窗（秒），休息返回 null
function windowOf(d){
  const sh = shiftOf(d);
  if(sh === 'x') return null;
  const s = hm(sh === 'n' ? S.nightStart : S.start);
  const e = endHm(sh === 'n' ? S.nightEnd : S.end);
  return e > s ? [s, e] : null;
}
const isWorkday = d => shiftOf(d) !== 'x';
function lunchValid(){
  const w = windowOf(new Date()); if(!w) return false;
  if(S.noLunch) return false;
  const [s, e] = w, ls = hm(S.lunchStart), le = hm(S.lunchEnd);
  return ls >= s && le <= e && le > ls;
}
// 某天的计薪区间
function paidIntervalsFor(d){
  const w = windowOf(d); if(!w) return [];
  const [s, e] = w;
  if(S.noLunch) return [[s, e]];
  const ls = hm(S.lunchStart), le = hm(S.lunchEnd);
  if(!S.lunchPaid && ls >= s && le <= e && le > ls) return [[s, ls], [le, e]];
  return [[s, e]];
}
const paidIntervals = () => paidIntervalsFor(new Date());
// 每秒工资的分母：今天有班按今天的班次长度，休息日按白班长度
function paidSecPerDay(){
  const w = windowOf(new Date()) || [hm(S.start), endHm(S.end)];
  let sec = w[1] - w[0];
  if(!S.noLunch && !S.lunchPaid){
    const ls = hm(S.lunchStart), le = hm(S.lunchEnd);
    if(ls >= w[0] && le <= w[1] && le > ls) sec -= (le - ls);
  }
  return sec > 0 ? sec : 28800;
}
const dailyPay = () => S.salary / S.payDays;
const perSecond = () => dailyPay() / paidSecPerDay();
function paidSecondsBetween(t0, t1){
  if(t1 <= t0) return 0;
  let total = 0, d = dayStart(t0);
  while(d.getTime() < t1){
    const base = d.getTime();
    for(const [a, b] of paidIntervalsFor(d)){
      const s = Math.max(t0, base + a*1000), e = Math.min(t1, base + b*1000);
      if(e > s) total += (e - s)/1000;
    }
    d = new Date(d); d.setDate(d.getDate() + 1);
  }
  return total;
}
const earnedToday = now => paidSecondsBetween(dayStart(now).getTime(), now.getTime()) * perSecond();
function status(now){
  const sh = shiftOf(now);
  if(sh === 'x') return 'off';
  const w = windowOf(now);
  if(!w) return 'off';
  const sec = secOfDay(now), [s, e] = w;
  if(sec < s) return 'before';
  if(sec >= e) return 'after';
  if(lunchValid() && sec >= hm(S.lunchStart) && sec < hm(S.lunchEnd)) return S.lunchPaid ? 'lunchPaid' : 'lunch';
  return 'work';
}
function daysToPayday(now){
  const dim = (y, m) => new Date(y, m+1, 0).getDate();
  const y = now.getFullYear(), m = now.getMonth(), today = dayStart(now);
  let target = new Date(y, m, Math.min(S.payday, dim(y, m)));
  if(target < today) target = new Date(y, m+1, Math.min(S.payday, dim(y, m+1)));
  return Math.round((target - today) / 86400000);
}
function milestones(){
  const w = windowOf(new Date()); if(!w) return [];
  const [s, e] = w, list = [];
  const ls = hm(S.lunchStart), le = hm(S.lunchEnd);
  if(!S.noLunch && ls >= s && le <= e && le > ls) list.push({t:ls, e:'🍚', label:'午饭', msg:'🍚 开饭了！吃饭最重要'});
  const mid = Math.round(s + (e - s)/2);
  if(e - mid >= 1800) list.push({t:mid, e:'⚡', label:'过半', msg:'⚡ 一半过去了，剩下的越来越轻松'});
  list.push({t:e, e:'🏃', label:'下班', msg:null});
  return list;
}
const shiftName = d => SHIFT[shiftOf(d)].name;

/* ---------- feedback: sound, toast, modal, confetti ---------- */
let ac = null;
function unlockAudio(){
  try{ ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if(ac.state === 'suspended') ac.resume(); }catch(e){}
}
document.addEventListener('pointerdown', unlockAudio, {once:false, passive:true});
function ding(){
  if(!S.sound) return;
  try{
    unlockAudio(); if(!ac) return;
    const t = ac.currentTime;
    [1318.5, 1760].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), st = t + i*0.09;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.28, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.5);
      o.connect(g); g.connect(ac.destination); o.start(st); o.stop(st + 0.55);
    });
  }catch(e){}
  try{ navigator.vibrate && navigator.vibrate(40); }catch(e){}
}
let toastTimer;
function toast(msg){
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
function openSheet(html, cls = 'sheet'){
  const sh = $('sheet'); sh.className = cls; sh.innerHTML = html;
  $('modal').classList.remove('hidden'); $('modal').scrollTop = 0;
  const close = () => $('modal').classList.add('hidden');
  $('modal').onclick = e => { if(e.target === $('modal')) close(); };
  return close;
}
function modal({emoji='', title='', text='', ok='好的', cancel=null, onOk=null}){
  const close = openSheet(`<div class="e">${emoji}</div><h3>${title}</h3>${text ? `<p>${text}</p>` : ''}
     <div class="btns">${cancel ? `<button class="btn" id="mCancel">${cancel}</button>` : ''}<button class="btn primary" id="mOk">${ok}</button></div>`);
  $('mOk').onclick = () => { close(); onOk && onOk(); };
  if(cancel) $('mCancel').onclick = close;
}
function confetti(set = ['🎉','💸','✨','🧧','🪙'], n = 28){
  for(let i = 0; i < n; i++){
    const c = document.createElement('div');
    c.className = 'confetti';
    c.textContent = set[i % set.length];
    c.style.left = Math.random()*100 + 'vw';
    c.style.animationDuration = (1.6 + Math.random()*1.4) + 's';
    c.style.animationDelay = (Math.random()*0.5) + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3600);
  }
}

/* ---------- navigation ---------- */
let current = 'today';
function showTab(tab){
  current = tab;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('hidden', p.id !== 'page-' + tab));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  if(tab === 'fish') renderFish();
  if(tab === 'today') renderTodayShift();
  if(tab === 'shift') renderShift();
  if(tab === 'rich') renderRich();
  if(tab === 'wish') renderWish();
  if(tab === 'stock') renderStock();
  if(tab === 'settings') fillForm();
  tick(true);
}
function go(tab){
  if(tab === current) return;
  if(current === 'today'){ history.pushState({tab}, '', '#' + tab); showTab(tab); }
  else if(tab === 'today'){ history.back(); }
  else { history.replaceState({tab}, '', '#' + tab); showTab(tab); }
}
window.addEventListener('popstate', () => {
  if(!$('modal').classList.contains('hidden')) $('modal').classList.add('hidden');
  showTab((location.hash || '#today').slice(1) || 'today');
});
document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => go(b.dataset.tab));

/* ---------- 今日 ---------- */
const STATUS = {
  work:     {chip:'搬砖中 💪',    hero:'今天已挣'},
  lunch:    {chip:'午休中 🍚',    hero:'今天已挣（午休不计薪）'},
  lunchPaid:{chip:'带薪午休 😋',  hero:'今天已挣（午休照样涨）'},
  before:   {chip:'还没上班 ☕',  hero:'今天还没开工'},
  after:    {chip:'已下班 🎉',    hero:'今日收工，一共挣了'},
  off:      {chip:'休息日 😴',    hero:'今天休息，不营业'}
};let lastCents = null, lastUnitFloor = null, lastTick = 0, lastSec = null, lastDay = null;

function setMoney(v, dim){
  const el = $('money');
  if(S.hidden){ $('moneyInt').textContent = '***'; $('moneyDec').textContent = '.**'; }
  else{
    const cents = Math.floor(v*100 + 1e-6);
    $('moneyInt').textContent = Math.floor(cents/100).toLocaleString('zh-CN');
    $('moneyDec').textContent = '.' + pad(cents % 100);
    if(lastCents !== null && cents !== lastCents){
      el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 120);
    }
    lastCents = cents;
  }
  el.classList.toggle('dim', !!dim);
}

function tickToday(now, jumped){
  const st = status(now), ps = perSecond(), earned = earnedToday(now);
  const sec = secOfDay(now), w = windowOf(now) || [hm(S.start), endHm(S.end)];
  const s = w[0], e = w[1];
  $('dateLabel').textContent = `${now.getMonth()+1} 月 ${now.getDate()} 日 · 周${WEEK[now.getDay()]}`;
  $('statusChip').textContent = st === 'off' ? STATUS.off.chip : (SHIFT[shiftOf(now)].name + ' · ' + STATUS[st].chip);
  $('heroLabel').textContent = STATUS[st].hero;
  setMoney(earned, st === 'off' || st === 'before');
  $('rateLine').innerHTML = st === 'off'
    ? '<span>好好休息，工资下个工作日继续跳</span>'
    : `<span>每秒 <b class="num">${S.hidden ? '¥***' : '¥' + ps.toFixed(4)}</b></span><span>日薪 <b class="num">${masked(yuan(dailyPay()))}</b></span>`;

  // countdown + progress
  const showBar = st !== 'off';
  $('barWrap').classList.toggle('hidden', !showBar);
  if(st === 'before'){ $('cdLabel').textContent = '距离上班还有'; $('cdTime').textContent = clock(s - sec, true); }
  else if(st === 'after'){ $('cdLabel').textContent = '今天的班'; $('cdTime').textContent = '上完啦 🏃'; }
  else if(st === 'off'){ $('cdLabel').textContent = '今天'; $('cdTime').textContent = '不用上班 🛋️'; }
  else { $('cdLabel').textContent = '距离下班还有'; $('cdTime').textContent = clock(e - sec, true); }
  if(showBar){
    const frac = Math.min(1, Math.max(0, (sec - s) / (e - s)));
    $('barFill').style.width = (frac*100) + '%';
    $('barPct').textContent = Math.floor(frac*100) + '%';
    const ms = milestones();
    $('bar').querySelectorAll('.bar-mark').forEach(m => m.remove());
    ms.slice(0, -1).forEach(m => {
      const el = document.createElement('i');
      el.className = 'bar-mark' + (sec >= m.t ? ' passed' : '');
      el.style.left = ((m.t - s)/(e - s)*100) + '%';
      $('bar').appendChild(el);
    });
    $('legend').innerHTML = ms.map(m => {
      const t = pad(Math.floor(m.t/3600)) + ':' + pad(Math.floor(m.t%3600/60));
      return `<span class="${sec >= m.t ? 'done' : ''}">${m.e} ${t} ${m.label}</span>`;
    }).join('');
  }
  const friday = now.getDay() === 5 && sec >= 12*3600 && ['work','lunch','lunchPaid'].includes(st);
  document.body.classList.toggle('friday', friday);
  $('fridayBanner').classList.toggle('hidden', !friday);

  // conversion
  const units = earned / S.unitPrice, fl = Math.floor(units);
  $('unitCount').textContent = S.hidden ? '**' : (units >= 100 ? Math.floor(units) : units.toFixed(1));
  $('unitLabel').textContent = S.unitWord + S.unitName;
  const shown = Math.min(fl, 12);
  let cups = '';
  for(let i = 0; i < shown; i++) cups += `<span>${S.unitEmoji}</span>`;
  if(fl > 12) cups += `<span class="more">+${fl - 12}</span>`;
  else cups += `<span class="ghost">${S.unitEmoji}</span>`;
  $('cups').innerHTML = S.hidden ? `<span class="ghost">${S.unitEmoji}</span>` : cups;
  if(st === 'work' || st === 'lunchPaid'){
    const left = (Math.floor(units) + 1 - units) * S.unitPrice / ps;
    $('unitNext').textContent = `再坚持 ${durShort(left)}，又能多${unitVerb()}一${S.unitWord}`;
  } else if(st === 'lunch') $('unitNext').textContent = '午休时间不计薪，先吃饭';
  else if(st === 'after') $('unitNext').textContent = `今天一共挣了 ${units.toFixed(1)} ${S.unitWord}${S.unitName}，辛苦了`;
  else if(st === 'before') $('unitNext').textContent = `上班后，每 ${durShort(S.unitPrice/ps)} 就能挣一${S.unitWord}`;
  else $('unitNext').textContent = '休息日不挣钱，但能花钱';
  if(lastUnitFloor !== null && fl > lastUnitFloor && !jumped){
    ding(); toast(`叮！又挣到一${S.unitWord}${S.unitName} ${S.unitEmoji}`);
  }
  lastUnitFloor = fl;

  // fish + payday minis
  const tk = dateKey(now);
  let fs = 0, fm = 0;
  D.fish.filter(f => dateKey(new Date(f.start)) === tk).forEach(f => { fs += (f.end - f.start)/1000; fm += f.earned; });
  if(D.fishActive){ fs += (now - D.fishActive.start)/1000; fm += paidSecondsBetween(D.fishActive.start, now.getTime()) * ps; }
  $('fishMiniTime').textContent = dur(fs).split(' ').slice(0, 2).join(' ');
  $('fishMiniMoney').textContent = '公司支付 ' + masked(yuan(fm));
  const pd = daysToPayday(now);
  $('payDays').textContent = pd === 0 ? '今天！' : pd + ' 天';
  $('payNote').textContent = pd === 0 ? '发工资啦 🧧' : `每月 ${S.payday} 号`;

  // overtime
  tickOvertime(now, st);
  tickWishMini(now);

  // milestone celebrations (only when crossed in real time)
  if(lastDay === tk && lastSec !== null && !jumped && isWorkday(now)){
    if(lastSec < s && sec >= s) toast('💸 开工！今天的钱开始跳了');
    milestones().forEach(m => {
      if(lastSec < m.t && sec >= m.t){
        if(m.msg){ toast(m.msg); ding(); }
        else { confetti(); ding(); modal({emoji:'🏃', title:'下班！', text:`今天一共挣了 ${masked(yuan(earned))}，相当于 ${units.toFixed(1)} ${S.unitWord}${S.unitName}。快跑，别回头。`, ok:'溜了溜了'}); }
      }
    });
  }
  lastSec = sec; lastDay = tk;
}
function unitVerb(){
  const n = S.unitName;
  if(/茶|咖啡|奶|饮|酒|水/.test(n)) return '喝';
  if(/粉|面|饭|鸡|堡|饺|包|锅|罐头/.test(n)) return '吃';
  return '买';
}

/* overtime */
function otToday(now){
  const k = dateKey(now);
  let s = D.ot.log[k] || 0;
  if(D.ot.active && dateKey(new Date(D.ot.active)) === k) s += (now - D.ot.active)/1000;
  return s;
}
function tickOvertime(now, st){
  const active = !!D.ot.active, ots = otToday(now);
  const show = active || ots >= 1 || st === 'after' || st === 'off';
  $('otCard').classList.toggle('hidden', !show);
  if(!show) return;
  $('otTimer').textContent = active ? clock((now - D.ot.active)/1000, true) : (ots >= 60 ? dur(ots) : '');
  $('otBtn').textContent = active ? '下班了！结束加班' : '我还在加班';
  $('otBtn').className = 'btn block ' + (active ? 'primary' : '');
  const baseH = paidSecPerDay()/3600, base = dailyPay()/baseH;
  let text;
  if(ots < 60){
    text = st === 'off' ? '休息日也被叫去干活？点下面开始记录。' : '已经到下班时间了。如果还在工位上，点下面记录一下。';
  } else if(st === 'off' || !isWorkday(now)){
    text = `休息日加班 ${dur(ots)}。按月薪算，这段时间没有工资（有加班费的话，当我没说）。`;
  } else {
    const real = dailyPay() / (baseH + ots/3600);
    text = `今天加班 ${dur(ots)}，你的实际时薪从 <b>${masked(yuan(base))}</b> 降到了 <b>${masked(yuan(real))}</b>。`;
  }
  $('otText').innerHTML = text;
}
$('otBtn').onclick = () => {
  const now = Date.now();
  if(D.ot.active){
    const k = dateKey(new Date(D.ot.active));
    D.ot.log[k] = (D.ot.log[k] || 0) + (now - D.ot.active)/1000;
    D.ot.active = null; saveD();
    toast('加班结束，赶紧回家 🏠');
  } else {
    D.ot.active = now; saveD();
    toast('加班开始计时 😮‍💨');
  }
  tick(true);
};

/* ---------- 摸鱼 ---------- */
const CATS = {
  toilet:{e:'🚽', name:'带薪如厕', live:'带薪如厕中', verb:'如厕', d:'打工人最理直气壮的休息'},
  phone: {e:'📱', name:'刷手机',   live:'带薪刷手机中', verb:'刷手机', d:'就看一眼，真的就一眼'},
  daze:  {e:'💭', name:'放空发呆', live:'带薪发呆中',   verb:'发呆', d:'表面在思考，其实在关机'}
};
const FISH_EMOJI = ['☕','🍵','🍜','🛒','🚶','💬','📰','🎮','😴','🧘','🚬','🐟'];
const QUIPS = ['这钱赚得心安理得。','你没有在摸鱼，你是在给大脑充电。','适度摸鱼，有益身心。','老板不知道，但这个 App 知道。','工位会想你的，回去吧。','摸鱼赚的钱，回头要变成我的奶茶哦 🧡','摸得不错，下班记得跟我汇报一下战果。'];
// 自定义项目删除时只打标记，历史记录里还能显示原来的名字
function cat(id){
  if(CATS[id]) return CATS[id];
  const c = D.fishCats.find(x => x.id === id);
  return c ? {e:c.e, name:c.name, live:`带薪${c.name}中`, verb:c.name, d:c.d} : {e:'🐟', name:'摸鱼', live:'带薪摸鱼中', verb:'摸鱼'};
}
function renderFishPicks(){
  const pick = (id, c, custom) => `<button class="fish-pick" data-cat="${id}"><span class="e">${esc(c.e)}</span>
    <span class="grow"><div class="t">${esc(c.name)}</div><div class="d">${esc(c.d || '自定义摸鱼项目')}</div></span>${custom ? `<span class="edit" data-edit="${id}">✎</span>` : ''}</button>`;
  $('fishPicks').innerHTML = Object.keys(CATS).map(id => pick(id, CATS[id], false)).join('')
    + D.fishCats.filter(c => !c.deleted).map(c => pick(c.id, c, true)).join('')
    + '<button class="btn block ghost" id="fishAdd">＋ 自定义摸鱼项目</button>';
}
$('fishPicks').addEventListener('click', ev => {
  const ed = ev.target.closest('[data-edit]');
  if(ed) return fishCatSheet(ed.dataset.edit);
  if(ev.target.closest('#fishAdd')) return fishCatSheet();
  const b = ev.target.closest('[data-cat]'); if(!b) return;
  D.fishActive = {cat:b.dataset.cat, start:Date.now()}; saveD();
  unlockAudio(); renderFish(); tick(true);
});
function fishCatSheet(id){
  const old = id ? D.fishCats.find(x => x.id === id) : null;
  let emoji = old ? old.e : FISH_EMOJI[0];
  const close = openSheet(`<div class="e" id="fcE"></div><h3>${old ? '编辑摸鱼项目' : '自定义摸鱼项目'}</h3>
    <input class="field" id="fcName" maxlength="8" placeholder="名字，比如：喝咖啡" autocomplete="off" value="${old ? esc(old.name) : ''}">
    <input class="field" id="fcDesc" maxlength="16" placeholder="一句话描述（可不填）" autocomplete="off" value="${old ? esc(old.d || '') : ''}">
    <div class="emoji-pick" id="fcPick">${FISH_EMOJI.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div>
    <p class="warn hidden" id="fcWarn"></p>
    <div class="btns"><button class="btn" id="fcCancel">取消</button><button class="btn primary" id="fcOk">保存</button></div>
    ${old ? '<button class="btn ghost block" id="fcDel" style="margin-top:10px">删除这个项目</button>' : ''}`);
  const setEmoji = e => { emoji = e; $('fcE').textContent = e; document.querySelectorAll('#fcPick button').forEach(b => b.classList.toggle('on', b.dataset.e === e)); };
  setEmoji(emoji);
  $('fcPick').onclick = ev => { const b = ev.target.closest('button'); if(b) setEmoji(b.dataset.e); };
  $('fcCancel').onclick = close;
  $('fcOk').onclick = () => {
    const name = $('fcName').value.trim(), d = $('fcDesc').value.trim();
    if(!name){ $('fcWarn').textContent = '给它起个名字'; $('fcWarn').classList.remove('hidden'); return; }
    if(old) Object.assign(old, {e:emoji, name, d});
    else D.fishCats.push({id:'c' + newId(), e:emoji, name, d});
    saveD(); close(); renderFish(); toast(`${emoji} ${name} 已${old ? '保存' : '加入摸鱼清单'}`);
  };
  if(old) $('fcDel').onclick = () => {
    if(D.fishActive && D.fishActive.cat === id){ toast('正在摸这条鱼呢，摸完再删'); return; }
    old.deleted = true; saveD(); close(); renderFish(); toast('已删除，之前的记录还在');
  };
}
$('fishStop').onclick = () => {
  const a = D.fishActive; if(!a) return;
  const end = Date.now(), sec = (end - a.start)/1000;
  const earned = paidSecondsBetween(a.start, end) * perSecond();
  D.fish.push({cat:a.cat, start:a.start, end, earned, jar: D.jar ? earned * rate() : 0});
  D.fishActive = null; saveD();
  const c = cat(a.cat);
  if(earned > 0){
    ding();
    modal({emoji:esc(c.e), title:`本次带薪${esc(c.verb)} ${sec < 1 ? '不到 1 秒' : dur(sec)}，公司为此支付 ${masked(fix(earned))} 元。`,
           text: QUIPS[Math.floor(Math.random()*QUIPS.length)], ok:'回去搬砖'});
  } else {
    modal({emoji:esc(c.e), title:`这次${esc(c.verb)}了 ${dur(sec)}`, text:'不过发生在非工作时间，老板不买单 🙃', ok:'行吧'});
  }
  renderFish(); tick(true);
};
function renderFish(){
  const a = D.fishActive;
  $('fishIdle').classList.toggle('hidden', !!a);
  $('fishLive').classList.toggle('hidden', !a);
  renderFishPicks();
  if(a){ $('fishLiveEmoji').textContent = cat(a.cat).e; $('fishLiveName').textContent = cat(a.cat).live; }
  const now = new Date(), tk = dateKey(now);
  const today = D.fish.filter(f => dateKey(new Date(f.start)) === tk).reverse();
  let ts = 0, tm = 0; today.forEach(f => { ts += (f.end - f.start)/1000; tm += f.earned; });
  $('fishTodaySum').textContent = today.length ? `${dur(ts)} · ${masked(yuan(tm))}` : '';
  $('fishTodayList').innerHTML = today.length
    ? today.map(f => `<li><span class="e">${esc(cat(f.cat).e)}</span><span class="grow">${esc(cat(f.cat).name)} ${dur((f.end - f.start)/1000)}<div class="when">${hhmm(f.start)} – ${hhmm(f.end)}</div></span><span class="amt num">${masked(yuan(f.earned))}</span></li>`).join('')
    : '<li class="empty">今天还没摸过鱼。是不是太认真了？</li>';
  // monthly report
  const ym = tk.slice(0, 7), month = D.fish.filter(f => dateKey(new Date(f.start)).slice(0, 7) === ym);
  $('reportMonth').textContent = `${now.getMonth()+1} 月`;
  if(!month.length){ $('reportBody').innerHTML = '<div class="empty">本月还没摸过鱼。你是公司的好员工（也许好过头了）。</div>'; return; }
  let ms = 0, mm = 0; const cnt = {};
  month.forEach(f => { ms += (f.end - f.start)/1000; mm += f.earned; cnt[f.cat] = (cnt[f.cat] || 0) + 1; });
  const fav = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x])[0];
  $('reportBody').innerHTML =
    `<div class="sub" style="font-weight:700;color:var(--ink)">本月你从工位上“回收”了</div>
     <div class="big num">${masked(yuan(mm))}</div>
     <div class="stats"><div>总时长<b>${dur(ms).split(' ').slice(0, 2).join(' ')}</b></div><div>次数<b>${month.length} 次</b></div><div>最爱<b>${esc(cat(fav).e)}</b></div></div>
     <p>相当于白赚了 ${S.hidden ? '**' : (mm / S.unitPrice).toFixed(1)} ${S.unitWord}${S.unitName} ${S.unitEmoji}</p>`;
}
function tickFish(now){
  const a = D.fishActive; if(!a) return;
  $('fishLiveTimer').textContent = clock((now - a.start)/1000);
  const earned = paidSecondsBetween(a.start, now.getTime()) * perSecond();
  $('fishLiveEarn').innerHTML = earned > 0 || status(now) === 'work' || status(now) === 'lunchPaid'
    ? `公司正在为你支付 <b class="num">${masked(yuan(earned))}</b>`
    : '现在是非工作时间，这次老板不买单';
}

/* ---------- 愿望存钱罐 ---------- */
const esc = v => String(v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad3 = x => String(x).padStart(3, '0');
const rate = () => Math.max(0, Math.min(100, Number(S.saveRate) || 0)) / 100;
const hourly = () => dailyPay() / (paidSecPerDay() / 3600);
const workHours = price => price / hourly();
const jarPerSec = () => perSecond() * rate();
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function ensureJar(){
  if(!D.jar){ const t = Date.now(); D.jar = {since:t, auto:0, spent:0, periodStart:t, notified:null}; }
}
// lock in what the jar has earned so far, so later setting changes are not applied retroactively
function bankJar(){
  if(!D.jar) return;
  const t = Date.now();
  D.jar.auto += paidSecondsBetween(D.jar.since, t) * jarPerSec();
  D.jar.since = t; saveD();
}
const depositSum = () => D.deposits.reduce((a, x) => a + x.amount, 0);
function jarTotal(now){
  if(!D.jar) return 0;
  return D.jar.auto + paidSecondsBetween(D.jar.since, now.getTime()) * jarPerSec() + depositSum() - D.jar.spent;
}
function fishFund(now){
  if(!D.jar) return 0;
  const p = D.jar.periodStart;
  let v = D.fish.reduce((a, f) => a + (f.jar && f.end >= p ? f.jar : 0), 0);
  if(D.fishActive) v += paidSecondsBetween(Math.max(D.fishActive.start, p), now.getTime()) * jarPerSec();
  return v;
}
const periodDeposits = () => D.jar ? D.deposits.filter(x => x.t >= D.jar.periodStart) : [];

// when will the jar hold `remaining` more yuan? walks forward through paid work time
function eta(remaining, now){
  if(remaining <= 1e-9) return {done:true};
  const r = jarPerSec();
  if(!(r > 0)) return {never:true};
  const total = remaining / r;
  let need = total, d = dayStart(now);
  const t0 = now.getTime();
  for(let i = 0; i < 3700; i++){
    if(isWorkday(d)){
      const base = d.getTime();
      for(const [a, b] of paidIntervalsFor(d)){
        const st = Math.max(t0, base + a*1000), en = base + b*1000;
        if(en > st){
          const avail = (en - st)/1000;
          if(avail >= need) return {date:new Date(st + need*1000), sec:total};
          need -= avail;
        }
      }
    }
    d = new Date(d); d.setDate(d.getDate() + 1);
  }
  return {far:true, sec:total};
}
function workLen(sec, ban){
  const day = paidSecPerDay();
  if(sec < 3600) return Math.max(1, Math.round(sec/60)) + ' 分钟' + (ban ? '班' : '');
  if(sec < day) return (sec/3600).toFixed(1) + ' 小时' + (ban ? '班' : '');
  return (sec/day).toFixed(1) + ' 个工作日';
}
function fmtDate(d, now){
  return (d.getFullYear() !== now.getFullYear() ? d.getFullYear() + ' 年 ' : '') + `${d.getMonth()+1} 月 ${d.getDate()} 日`;
}
function spanText(ms){
  if(ms < 3600000) return Math.max(1, Math.round(ms/60000)) + ' 分钟';
  if(ms < 86400000) return Math.round(ms/3600000) + ' 小时';
  return Math.ceil(ms/86400000) + ' 天';
}
function etaText(remaining, now){
  const e = eta(remaining, now);
  if(e.done) return '已经攒够啦 🎉';
  if(e.never) return '存钱比例是 0，罐子暂时不会自己涨';
  if(e.far) return `还要上 ${workLen(e.sec, true)}，有点远，可以提高存钱比例试试`;
  const when = dateKey(e.date) === dateKey(now) ? '今天 ' + hhmm(e.date) : fmtDate(e.date, now) + '（周' + WEEK[e.date.getDay()] + '）';
  return `还要上 ${workLen(e.sec, true)}，预计<b>${when}</b>攒够`;
}
function etaShort(remaining, now){
  const e = eta(remaining, now);
  if(e.done) return '已攒够';
  if(e.never) return '罐子暂停中';
  if(e.far) return '还早着呢';
  return '预计 ' + (dateKey(e.date) === dateKey(now) ? '今天' : fmtDate(e.date, now));
}
function skipPresets(){
  const first = S.unitPrice <= 200 ? {e:S.unitEmoji, name:S.unitName, p:S.unitPrice} : {e:'🧋', name:'奶茶', p:20};
  return [first, {e:'🥡', name:'外卖', p:30}, {e:'🚕', name:'打车', p:25}, {e:'🛒', name:'冲动网购', p:100}];
}

let wishSecond = null, lastJarCents = null;
function renderWish(){
  const now = new Date(), w = D.wishes[0], jc = $('jarCard');
  if(!w){
    const left = D.jar && D.wall.length;
    jc.innerHTML = `<div class="jar-empty"><div class="e">🐷</div>
      <h3>${left ? '罐子里还有 <span class="num" id="jarLeft"></span>' : '还没有愿望'}</h3>
      <p>${left ? '上一个愿望已经实现了，许下一个吧，罐子会接着攒。' : `许一个愿望，之后每上一秒班，工资的 ${S.saveRate}% 就会自动掉进罐子。`}</p>
      <button class="btn primary" data-act="add">＋ 许个愿望</button></div>`;
  } else {
    const h = workHours(w.price);
    jc.innerHTML = `
      <div class="jar-top">
        <div class="jar"><div class="jar-lid"></div><div class="jar-body"><div class="jar-fill" id="jarFill"></div><span class="jar-emoji">${esc(w.emoji)}</span></div></div>
        <div class="jar-info">
          <div class="jar-label">正在攒</div>
          <div class="jar-name">${esc(w.name)}</div>
          <div class="jar-amt num" id="jarAmt"></div>
          <div class="jar-of num" id="jarOf"></div>
        </div>
      </div>
      <div class="facts">
        <div>⏱️ 它值 <b>${h < 1 ? Math.max(1, Math.round(h*60)) + ' 分钟' : h.toFixed(1) + ' 小时'}</b>的班，相当于 ${(w.price / dailyPay()).toFixed(1)} 天的工资</div>
        <div id="jarEta"></div>
        <div id="jarFish"></div>
      </div>
      <button class="btn primary block hidden" id="jarClaim" data-act="claim">🎉 攒够了！领取购买批准书</button>
      <div class="jar-rate num" id="jarRate"></div>`;
  }
  lastJarCents = null;

  $('skipCard').classList.toggle('hidden', !w);
  if(w){
    $('skipGrid').innerHTML = skipPresets().map((p, i) =>
      `<button data-act="skip" data-i="${i}"><span class="e">${esc(p.e)}</span><span>${esc(p.name)}<small class="num">+${masked(yuan(p.p))}</small></span></button>`).join('');
    const recent = periodDeposits().slice(-5).reverse();
    $('depositList').innerHTML = recent.map(x => {
      const d = new Date(x.t), day = dateKey(d) === dateKey(now) ? '今天' : `${d.getMonth()+1}/${d.getDate()}`;
      return `<li><span class="e">${esc(x.e)}</span><span class="grow">忍住了${esc(x.name)}<div class="when">${day} ${hhmm(x.t)}</div></span><span class="amt num">+${masked(yuan(x.amount))}</span><button class="undo" data-act="undo" data-id="${x.id}">撤销</button></li>`;
    }).join('');
    const td = D.deposits.filter(x => dateKey(new Date(x.t)) === dateKey(now));
    $('skipToday').textContent = td.length ? `今天 ${td.length} 次 · ${masked(yuan(td.reduce((a, x) => a + x.amount, 0)))}` : '';
  }

  $('queueList').innerHTML = D.wishes.length ? D.wishes.map((x, i) =>
    `<li data-act="menu" data-id="${x.id}"><span class="e">${esc(x.emoji)}</span><span class="grow">${esc(x.name)}${i === 0 ? '<em class="tag">正在攒</em>' : ''}<div class="when"><span class="num">${masked(yuan(x.price))}</span> · ${workHours(x.price).toFixed(1)} 小时班 · <span id="qe-${x.id}"></span></div></span><span class="more-btn">⋯</span></li>`).join('')
    : '<li class="empty">清单还是空的。想要的东西，先写下来。</li>';

  $('rateChips').innerHTML = [10, 20, 30, 50].map(r => `<button data-act="rate" data-rate="${r}" class="${+S.saveRate === r ? 'on' : ''}">${r}%</button>`).join('');
  $('rateText').innerHTML = rate() > 0
    ? `工资的 <b>${S.saveRate}%</b> 会自动进罐子，每个工作日大约 <b class="num">${masked(yuan(dailyPay() * rate()))}</b>。`
    : '存钱比例是 0，罐子暂停中。选一个比例就会接着攒。';

  $('wallCard').classList.toggle('hidden', !D.wall.length);
  $('wallList').innerHTML = D.wall.map(x =>
    `<li data-act="cert" data-id="${x.id}"><span class="e">${esc(x.emoji)}</span><span class="grow">${esc(x.name)}<div class="when">${fmtDate(new Date(x.done), now)}攒够 · 用了 ${spanText(x.stats.spanMs)}</div></span><span class="amt">📜</span></li>`).join('');

  renderChecker();
  wishSecond = null;
  tickWish(now);
}

function tickWish(now){
  const w = D.wishes[0], total = jarTotal(now);
  const sec = Math.floor(now.getTime() / 1000), full = sec !== wishSecond;
  wishSecond = sec;
  if($('jarLeft')) $('jarLeft').textContent = masked(yuan(Math.max(0, total)));
  if(w && $('jarAmt')){
    const pct = Math.max(0, Math.min(1, total / w.price));
    if(S.hidden) $('jarAmt').textContent = '¥***';
    else {
      const c = Math.floor(total*100 + 1e-6);
      $('jarAmt').innerHTML = '¥' + Math.floor(c/100).toLocaleString('zh-CN') + '<small>.' + pad(c % 100) + '</small>';
      if(lastJarCents !== null && c !== lastJarCents){ $('jarAmt').classList.add('bump'); setTimeout(() => $('jarAmt') && $('jarAmt').classList.remove('bump'), 120); }
      lastJarCents = c;
    }
    $('jarFill').style.height = (pct*100) + '%';
    $('jarOf').textContent = `/ ${masked(yuan(w.price))} · ${(pct*100).toFixed(1)}%`;
    $('jarClaim').classList.toggle('hidden', pct < 1);
    const st = status(now);
    $('jarRate').textContent = rate() <= 0 ? '存钱比例为 0，罐子暂停中'
      : (st === 'work' || st === 'lunchPaid') ? `每秒 +${S.hidden ? '¥***' : '¥' + jarPerSec().toFixed(4)} · 工资的 ${S.saveRate}% 进罐子`
      : '现在不是上班时间，罐子歇着，上班后接着涨';
    if(full){
      const ff = fishFund(now);
      $('jarFish').innerHTML = ff >= 0.01 ? `🐟 其中 <b>${masked(yuan(ff))}</b> 是带薪摸鱼时攒的` : '🐟 摸鱼时罐子照样涨，摸鱼攒的钱会单独记在这里';
      $('jarEta').innerHTML = '📅 ' + etaText(w.price - total, now);
    }
  }
  if(full){
    let cum = 0;
    D.wishes.forEach(x => { cum += x.price; const el = $('qe-' + x.id); if(el) el.textContent = etaShort(cum - total, now); });
  }
}

function tickWishMini(now){
  const w = D.wishes[0];
  $('wmCta').classList.toggle('hidden', !!w);
  $('wmBox').classList.toggle('hidden', !w);
  if(!w) return;
  const total = jarTotal(now), pct = Math.max(0, Math.min(1, total / w.price));
  $('wmName').textContent = w.emoji + ' ' + w.name;
  $('wmPct').textContent = (pct*100).toFixed(1) + '%';
  $('wmFill').style.width = (pct*100) + '%';
  $('wmNote').textContent = pct >= 1 ? '攒够啦！点这里领购买批准书 🎉' : `已攒 ${masked(yuan(total))} / ${masked(yuan(w.price))}`;
}

function checkReached(now){
  const w = D.wishes[0];
  if(!w || !D.jar || D.jar.notified === w.id) return;
  if(jarTotal(now) >= w.price){
    D.jar.notified = w.id; saveD(); ding();
    toast(`🎉 ${w.emoji} ${w.name} 攒够了！去愿望页领批准书`);
    if(current === 'wish') renderWish();
  }
}

function renderChecker(){
  const v = parseFloat($('chkPrice').value);
  if(!isFinite(v) || v <= 0){
    $('chkResult').innerHTML = '看到想买的东西，输入价格，算算它要你上多久的班。';
    $('chkAdd').classList.add('hidden'); return;
  }
  const h = workHours(v), r = rate();
  $('chkResult').innerHTML =
    `= <span class="big num">${h < 1 ? Math.max(1, Math.round(h*60)) + ' 分钟' : h.toFixed(1) + ' 小时'}</span> 班<br>` +
    `相当于 <b>${(v / dailyPay()).toFixed(1)} 天</b>的工资，或者 <b>${(v / S.unitPrice).toFixed(1)} ${esc(S.unitWord + S.unitName)}</b><br>` +
    (r > 0 ? `按 ${S.saveRate}% 的比例存，要攒 <b>${(v / (dailyPay() * r)).toFixed(1)} 个工作日</b>` : '');
  $('chkAdd').classList.remove('hidden');
}

const WISH_EMOJI = ['🎮','📱','💻','🎧','⌚','📷','👟','🎸','✈️','🛋️','🚲','🎁'];
const GUESS = [[/switch|游戏|ps5|ps4|xbox|掌机|steam/i,'🎮'],[/手机|iphone|phone|华为|小米/i,'📱'],[/电脑|笔记本|mac|ipad|平板|显卡|显示器/i,'💻'],[/耳机|音箱|airpods|音响/i,'🎧'],[/手表|watch|手环/i,'⌚'],[/相机|镜头|拍立得/i,'📷'],[/鞋/,'👟'],[/吉他|琴|鼓/,'🎸'],[/旅行|旅游|机票|酒店|出国/,'✈️'],[/沙发|床|椅|床垫/,'🛋️'],[/自行车|单车|电动车|车/,'🚲']];
function addWish(price){
  let emoji = '🎁', picked = false;
  const close = openSheet(`<div class="e" id="wE">🎁</div><h3>许个新愿望</h3>
    <input class="field" id="wName" maxlength="16" placeholder="想买什么？比如：游戏机" autocomplete="off">
    <div class="field money-field"><span>¥</span><input id="wPrice" type="number" inputmode="decimal" min="0" placeholder="价格" value="${price > 0 ? price : ''}"></div>
    <div class="emoji-pick" id="wPick">${WISH_EMOJI.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div>
    <p class="warn hidden" id="wWarn"></p>
    <div class="btns"><button class="btn" id="wCancel">取消</button><button class="btn primary" id="wOk">许愿</button></div>`);
  const setEmoji = e => { emoji = e; $('wE').textContent = e; document.querySelectorAll('#wPick button').forEach(b => b.classList.toggle('on', b.dataset.e === e)); };
  setEmoji(emoji);
  $('wPick').onclick = ev => { const b = ev.target.closest('button'); if(b){ picked = true; setEmoji(b.dataset.e); } };
  $('wName').oninput = () => { if(picked) return; const g = GUESS.find(([re]) => re.test($('wName').value)); setEmoji(g ? g[1] : '🎁'); };
  $('wCancel').onclick = close;
  $('wOk').onclick = () => {
    const name = $('wName').value.trim(), p = parseFloat($('wPrice').value);
    const warn = m => { $('wWarn').textContent = m; $('wWarn').classList.remove('hidden'); };
    if(!name) return warn('先写下想买什么');
    if(!isFinite(p) || p <= 0) return warn('价格要大于 0');
    const first = !D.jar;
    ensureJar();
    D.wishes.push({id:newId(), emoji, name, price:Math.round(p*100)/100, created:Date.now()});
    saveD(); close();
    if(current !== 'wish') go('wish'); else renderWish();
    toast(first && rate() > 0 ? `罐子开始攒了！上班时每秒 +¥${jarPerSec().toFixed(4)}` : `${emoji} 已加入愿望清单`);
  };
}

function wishMenu(id){
  const w = D.wishes.find(x => x.id === id); if(!w) return;
  const idx = D.wishes.indexOf(w);
  const close = openSheet(`<div class="e">${esc(w.emoji)}</div><h3>${esc(w.name)}</h3><p>${masked(yuan(w.price))} · 值 ${workHours(w.price).toFixed(1)} 小时班</p>
    <div class="stack">${idx > 0 ? '<button class="btn yolk block" id="mTop">先攒这个</button>' : ''}<button class="btn block" id="mDel">删掉这个愿望</button><button class="btn ghost block" id="mCancel">算了</button></div>`);
  if(idx > 0) $('mTop').onclick = () => { D.wishes.splice(idx, 1); D.wishes.unshift(w); saveD(); close(); renderWish(); toast(`现在先攒 ${w.emoji} ${w.name}`); };
  $('mDel').onclick = () => { D.wishes.splice(idx, 1); saveD(); close(); renderWish(); toast('已删除，罐子里的钱还在'); };
  $('mCancel').onclick = close;
}

function skip(p){
  const w = D.wishes[0]; if(!w || !D.jar) return;
  D.deposits.push({id:newId(), t:Date.now(), amount:p.p, e:p.e, name:p.name});
  saveD(); ding(); confetti(['🪙','💰','🪙'], 14);
  toast(jarPerSec() > 0 ? `忍住了！离 ${w.emoji} ${w.name} 又近了 ${workLen(p.p / jarPerSec(), false)}` : `忍住了！${yuan(p.p)} 已存进罐子`);
  renderWish();
}

const QUOTES = ['同意。这是你应得的。', '同意，买！已经忍很久了。', '批准。今天的你值得拥有它。', '同意。钱是你一秒一秒挣来的。'];
function claim(){
  const w = D.wishes[0], now = new Date();
  if(!w || !D.jar || jarTotal(now) + 1e-9 < w.price) return;
  const pd = periodDeposits();
  w.done = now.getTime();
  w.stats = {
    hours: workHours(w.price),
    spanMs: now.getTime() - Math.max(w.created, D.jar.periodStart),
    fish: Math.min(fishFund(now), w.price),
    skips: pd.length,
    skipSum: pd.reduce((a, x) => a + x.amount, 0),
    no: dateKey(now).replace(/-/g, '') + '-' + pad3(D.wall.length + 1),
    quote: QUOTES[Math.floor(Math.random() * QUOTES.length)]
  };
  D.jar.spent += w.price; D.jar.periodStart = now.getTime(); D.jar.notified = null;
  D.wishes.shift(); D.wall.unshift(w); saveD();
  confetti(['🎉','🧧','✨', w.emoji]); ding();
  renderWish(); showCert(w);
}

function certRows(w){
  const s = w.stats, rows = [`⏱️ 相当于上班 ${s.hours.toFixed(1)} 小时挣的钱`];
  if(s.fish >= 0.01) rows.push(`🐟 其中带薪摸鱼贡献了 ${masked(yuan(s.fish))}`);
  if(s.skips) rows.push(`💪 忍住了 ${s.skips} 次，省下 ${masked(yuan(s.skipSum))}`);
  rows.push(`📅 从许愿到攒够，用了 ${spanText(s.spanMs)}`);
  return rows;
}
const certSign = w => { const d = new Date(w.done); return [`审批意见：${w.stats.quote}`, `审批人：过去 ${spanText(w.stats.spanMs)}努力上班的我`, `日期：${d.getFullYear()} 年 ${d.getMonth()+1} 月 ${d.getDate()} 日`]; };
function showCert(w){
  const close = openSheet(`<div class="cert">
      <div class="cert-title">购买批准书</div>
      <div class="cert-no">No.${w.stats.no}</div>
      <div class="cert-lead">兹批准购买</div>
      <div class="cert-item"><span class="e">${esc(w.emoji)}</span>${esc(w.name)}</div>
      <div class="cert-price num">${masked(yuan(w.price))}</div>
      <div class="cert-rows">${certRows(w).map(r => `<div>${esc(r)}</div>`).join('')}</div>
      <div class="cert-sign">${certSign(w).map(esc).join('<br>')}</div>
      <div class="stamp"><b>批准</b><i>APPROVED</i></div>
    </div>
    <div class="cert-btns"><button class="btn" id="certSave">📸 保存图片</button><button class="btn primary" id="certOk">收下了</button></div>`, 'sheet cert-sheet');
  $('certOk').onclick = close;
  $('certSave').onclick = () => saveCert(w);
}

function drawCert(w){
  const W = 360, H = 600, k = 3;
  const c = document.createElement('canvas'); c.width = W*k; c.height = H*k;
  const x = c.getContext('2d'); x.scale(k, k);
  const FAM = getComputedStyle(document.body).fontFamily;
  const font = (sz, wt) => { x.font = `${wt} ${sz}px ${FAM}`; };
  const box = (X, Y, w2, h2, r) => { x.beginPath(); if(x.roundRect) x.roundRect(X, Y, w2, h2, r); else x.rect(X, Y, w2, h2); };
  const spacing = v => { try{ x.letterSpacing = v; }catch(e){} };
  const INK = '#1F1A13', MUTED = '#7A6F5F';
  x.fillStyle = '#FFF4D9'; x.fillRect(0, 0, W, H);
  x.fillStyle = INK; box(22, 22, W - 38, H - 38, 18); x.fill();
  x.fillStyle = '#FFFBEF'; box(16, 16, W - 38, H - 38, 18); x.fill();
  x.lineWidth = 2.5; x.strokeStyle = INK; x.stroke();
  x.setLineDash([5, 4]); x.lineWidth = 1.5; x.strokeStyle = '#E3C98F'; box(25, 25, W - 56, H - 56, 12); x.stroke(); x.setLineDash([]);
  const cx = 16 + (W - 38) / 2, L = 46;
  x.textAlign = 'center'; x.fillStyle = INK;
  font(28, 900); spacing('6px'); x.fillText('购买批准书', cx + 3, 76); spacing('0px');
  x.fillStyle = MUTED; font(11, 700); x.fillText('No.' + w.stats.no, cx, 96);
  font(14, 700); x.fillText('兹批准购买', cx, 136);
  x.fillStyle = INK; font(50, 400); x.fillText(w.emoji, cx, 198);
  let sz = 24; font(sz, 900); while(x.measureText(w.name).width > 270 && sz > 14){ sz--; font(sz, 900); }
  x.fillText(w.name, cx, 238);
  x.fillStyle = '#FF5A36'; font(20, 900); x.fillText(masked(yuan(w.price)), cx, 268);
  x.strokeStyle = INK; x.lineWidth = 2; x.beginPath(); x.moveTo(L, 292); x.lineTo(W - 68, 292); x.stroke();
  x.textAlign = 'left'; x.fillStyle = INK; font(14, 700);
  let y = 322;
  certRows(w).forEach(r => { x.fillText(r, L, y); y += 26; });
  y += 12; font(14, 800);
  certSign(w).forEach(r => { x.fillText(r, L, y); y += 25; });
  x.save(); x.translate(W - 84, H - 76); x.rotate(-16 * Math.PI / 180); x.globalAlpha = .85;
  x.strokeStyle = '#E5322D'; x.fillStyle = '#E5322D';
  x.lineWidth = 4; x.beginPath(); x.arc(0, 0, 44, 0, Math.PI*2); x.stroke();
  x.lineWidth = 1.5; x.beginPath(); x.arc(0, 0, 37, 0, Math.PI*2); x.stroke();
  x.textAlign = 'center'; font(26, 900); spacing('2px'); x.fillText('批准', 1, 6); spacing('0px');
  font(8, 800); x.fillText('APPROVED', 0, 21);
  x.restore();
  x.textAlign = 'center'; x.fillStyle = MUTED; font(10, 700); x.textAlign = 'left'; x.fillText('今天赚了吗 · 愿望存钱罐', L, H - 46);
  return c;
}
function saveCert(w){
  let b64;
  try{ b64 = drawCert(w).toDataURL('image/png').split(',')[1]; }catch(e){ toast('图片没生成成功，截图也能分享 📸'); return; }
  if(window.ZBridge && typeof window.ZBridge.saveImage === 'function'){
    let r = 'err';
    try{ r = String(window.ZBridge.saveImage(b64, 'ZhuanLeMa_' + Date.now() + '.png')); }catch(e){ r = 'err:' + e; }
    if(r === 'ok') toast('已保存到相册 📸');
    else if(r === 'old') toast('这台手机的系统版本较旧，截图就能保存 📸');
    else toast('保存没成功，截图也能分享 📸');
    return;
  }
  /* Web 版：优先系统分享（iPhone 可直接存相册），失败则下载 */
  (async () => {
    const name = 'ZhuanLeMa_' + Date.now() + '.png';
    try{
      const bin = atob(b64), arr = new Uint8Array(bin.length);
      for(let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], name, {type:'image/png'});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        await navigator.share({files:[file], title:'购买批准书'});
        toast('已保存/分享 📸'); return;
      }
    }catch(e){ if(e && e.name === 'AbortError') return; }
    try{
      const a = document.createElement('a');
      a.href = 'data:image/png;base64,' + b64; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      toast('图片已下载，长按或去下载里保存 📸');
    }catch(e){ toast('截图就能保存分享 📸'); }
  })();
}

$('page-wish').addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if(!el) return;
  const act = el.dataset.act;
  if(act === 'add') addWish();
  else if(act === 'claim') claim();
  else if(act === 'skip') skip(skipPresets()[+el.dataset.i]);
  else if(act === 'undo'){ D.deposits = D.deposits.filter(x => x.id !== el.dataset.id); saveD(); renderWish(); toast('已撤销'); }
  else if(act === 'menu') wishMenu(el.dataset.id);
  else if(act === 'rate'){ bankJar(); S.saveRate = +el.dataset.rate; saveS(); renderWish(); toast(`存钱比例改成 ${S.saveRate}%`); }
  else if(act === 'cert'){ const w = D.wall.find(x => x.id === el.dataset.id); if(w) showCert(w); }
});
$('chkPrice').addEventListener('input', renderChecker);
$('chkAdd').onclick = () => addWish(parseFloat($('chkPrice').value));
$('skipCustom').onclick = () => {
  const v = parseFloat($('skipAmt').value);
  if(!isFinite(v) || v <= 0){ toast('先输入金额'); return; }
  skip({e:'💰', name:'一笔开销', p:Math.round(v*100)/100}); $('skipAmt').value = '';
};

/* ---------- 首富 ---------- */
const ITEMS = [
  {id:'tea',     e:'🧋', name:'一杯奶茶，全糖加满小料',        p:20,             q:'这次不用看价格了'},
  {id:'hotpot',  e:'🍲', name:'一顿火锅，菜单从头点到尾',      p:1000,           q:'服务员：您确定吗？'},
  {id:'phone',   e:'📱', name:'新款手机，每个颜色来一台',      p:60000,          q:'换着用，一天一个色'},
  {id:'holiday', e:'🏖️', name:'给自己放一年带薪假',            p:300000,         q:'这次的“带薪”，是自己发的'},
  {id:'car',     e:'🏎️', name:'一辆超跑',                      p:6000000,        q:'通勤时间缩短到……还是堵车'},
  {id:'flat',    e:'🏙️', name:'市中心大平层',                  p:80000000,       q:'离公司走路 3 分钟，但你不用上班了'},
  {id:'island',  e:'🏝️', name:'一座私人小岛',                  p:300000000,      q:'岛上没有 Wi-Fi，也没有老板'},
  {id:'jet',     e:'🛩️', name:'一架私人飞机',                  p:600000000,      q:'再也不用抢靠窗的座位'},
  {id:'yacht',   e:'🛥️', name:'一艘超级游艇',                  p:3000000000,     q:'船上配了奶茶吧台'},
  {id:'treat',   e:'🧋', name:'请全国 2 亿打工人每人一杯奶茶',  p:4000000000,     q:'今天全国打工人的下午茶，你请了'},
  {id:'company', e:'🏢', name:'买下你们公司',                  p:20000000000,    q:'第一件事：取消周一早会'},
  {id:'club',    e:'⚽', name:'一支豪门足球队',                p:40000000000,    q:'你当老板，球员带薪踢球'},
  {id:'airline', e:'✈️', name:'一家航空公司',                  p:150000000000,   q:'所有航班改成全员头等舱'},
  {id:'city',    e:'🌆', name:'再造一座新城区',                p:500000000000,   q:'规定全城下午 5 点下班'}
];
const spent = () => ITEMS.reduce((a, it) => a + (D.rich[it.id] || 0) * it.p, 0);
function pctLeft(left){
  if(left >= S.richAsset) return '100%';
  const p = left / S.richAsset * 100;
  for(let d = 1; d <= 10; d++){ const s = p.toFixed(d); if(s !== (100).toFixed(d)) return s + '%'; }
  return p.toFixed(10) + '%';
}
function renderRich(){
  const sp = spent(), left = S.richAsset - sp;
  $('richBalance').textContent = '¥' + big(left);
  $('richFull').textContent = '¥' + fix(left, 0);
  let msg;
  const ratio = sp / S.richAsset;
  if(sp === 0) msg = `你现在有 <b>${big(S.richAsset)}</b>元。随便花，看看能不能花完。`;
  else if(left <= 0) msg = '🎉 恭喜你，做到了首富本人都做不到的事：把钱花完了。';
  else if(ratio < 0.01) msg = `已经花了 ${big(sp)}元，你还剩 <b>${pctLeft(left)}</b>。`;
  else if(ratio < 0.5) msg = `手指点酸了吧？已经花了 ${big(sp)}元，还剩 <b>${pctLeft(left)}</b>。`;
  else msg = `终于花掉一大半了！还剩 <b>${pctLeft(left)}</b>，坚持住。`;
  $('richMsg').innerHTML = msg;
  $('richList').innerHTML = ITEMS.map(it => {
    const n = D.rich[it.id] || 0;
    return `<div class="item"><div class="e">${it.e}</div><div class="info"><div class="name">${it.name}</div><div class="price num">¥${big(it.p)}</div></div>
      <div class="qty"><button data-sell="${it.id}" ${n ? '' : 'disabled'}>−</button><span class="num">${n}</span><button class="buy" data-buy="${it.id}" ${left >= it.p ? '' : 'disabled'}>+</button></div></div>`;
  }).join('');
}
$('richList').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if(!b || b.disabled) return;
  const id = b.dataset.buy || b.dataset.sell, it = ITEMS.find(x => x.id === id);
  if(b.dataset.buy){
    if(S.richAsset - spent() < it.p){ toast('钱不够了……这句话首富也会说吗？'); return; }
    D.rich[id] = (D.rich[id] || 0) + 1;
    toast(`${it.e} ${it.q}`);
    if(it.p >= 1e9) confetti(['💸','💰','🪙','✨']);
  } else {
    D.rich[id] = Math.max(0, (D.rich[id] || 0) - 1);
    toast('退货成功，首富也会后悔');
  }
  saveD(); renderRich();
});
$('richReset').onclick = () => modal({emoji:'🛏️', title:'一觉醒来，重新当首富？', text:'购物清单会清空，余额恢复。', ok:'再花一遍', cancel:'不了',
  onOk: () => { D.rich = {}; saveD(); renderRich(); toast('钱又回来了 💰'); }});

/* ---------- 炒股 ---------- */
// v = 涨势快慢；价格只涨不跌，偶尔突然拉升
const STOCKS = [
  {id:'moyu',   e:'🐟', name:'摸鱼科技',     code:'MOYU', p:18.80, v:1.2},
  {id:'wc',     e:'🚽', name:'带薪如厕控股', code:'WC',   p:6.66,  v:1.5},
  {id:'xiaban', e:'🏃', name:'准点下班集团', code:'XB',   p:17.30, v:1},
  {id:'naicha', e:'🧋', name:'奶茶能源',     code:'NC',   p:12.50, v:1.1},
  {id:'friday', e:'🎉', name:'周五传媒',     code:'FRI',  p:35.20, v:0.9},
  {id:'bonus',  e:'🧧', name:'年终奖银行',   code:'NZJ',  p:52.00, v:0.7},
  {id:'tang',   e:'🛋️', name:'躺平地产',     code:'TP',   p:8.88,  v:1.3},
  {id:'bing',   e:'🫓', name:'老板画饼食品', code:'BING', p:3.14,  v:2}
];
const TAPE = ['📢 今日股评：闭眼买，睁眼赚。','📢 分析师：本市场没有绿色，只有更红。','📢 温馨提示：股市有风险，但这里没有。','📢 主力资金正在流入你的账户。','📢 今天的你，跑赢了 99% 的基金经理。','📢 散户情绪指数：极度乐观，且完全合理。','📢 专家建议：别看了，反正是涨。','📢 老板画饼食品再创新高，饼越画越大。'];
const SELL_QUIPS = ['落袋为安，又是稳赚的一天。','巴菲特看了都说好。','这波操作，可以写进简历。','止盈成功，韭菜？不存在的。','卖飞了也是赚，这就是稳赚股市。'];
const STOCK_CASH = 100000;
const STOCK_EMOJI = ['🚀','💎','🐂','🍗','🍺','☕','🐱','🐶','🎮','🏠','🌙','💡'];
const SPEEDS = [['稳健', 0.7], ['上头', 1.3], ['起飞', 2.2]];
const allStocks = () => STOCKS.concat(D.stockCustom);
const findStock = id => allStocks().find(x => x.id === id);
function newStock(){
  const px = {}, hist = {};
  allStocks().forEach(s => { px[s.id] = s.p; hist[s.id] = [s.p]; });
  return {cash:STOCK_CASH, pos:{}, px, hist, total:[STOCK_CASH], t:Date.now(), day:{key:dateKey(new Date()), base:STOCK_CASH, open:Object.assign({}, px)}};
}
if(!D.stock) D.stock = newStock();
const held = id => (D.stock.pos[id] || {n:0, cost:0});
const stkValue = () => allStocks().reduce((a, s) => a + held(s.id).n * D.stock.px[s.id], 0);
const stkTotal = () => D.stock.cash + stkValue();
const plus = v => S.hidden ? '+¥***' : '+' + yuan(Math.max(0, v));
const upPct = (a, b) => '+' + Math.max(0, (a / b - 1) * 100).toFixed(2) + '%';
const asWork = v => perSecond() > 0 && isFinite(perSecond()) ? workLen(v / perSecond(), true) : '';
function spark(arr){
  const lo = Math.min(...arr), hi = Math.max(...arr), r = hi - lo || 1, n = Math.max(1, arr.length - 1);
  return arr.map((v, i) => (i / n * 100).toFixed(1) + ',' + (38 - (v - lo) / r * 36).toFixed(1)).join(' ');
}

let stkSample = 0, stkSaved = 0, stkTapeT = 0, stkGapNote = false, stkFlash = {};
function stockStep(now){
  const st = D.stock, t = now.getTime(), gap = t - st.t;
  if(gap > 600000){
    // 关掉 App 就是休市，回来时统一高开一次
    allStocks().forEach(s => st.px[s.id] *= 1.01 + Math.random() * 0.05);
    stkGapNote = true;
  } else {
    const dt = Math.max(0, Math.min(5, gap / 1000));
    allStocks().forEach(s => {
      let g = dt * (0.00005 + Math.random() * 0.0004) * s.v;
      if(Math.random() < 0.01 * dt){ g += 0.01 + Math.random() * 0.02; stkFlash[s.id] = true; }
      st.px[s.id] *= 1 + g;
    });
  }
  st.t = t;
  const k = dateKey(now);
  if(!st.day || st.day.key !== k) st.day = {key:k, base:stkTotal(), open:Object.assign({}, st.px)};
  if(t - stkSample >= 3000){
    stkSample = t;
    allStocks().forEach(s => { const h = st.hist[s.id]; h.push(st.px[s.id]); if(h.length > 40) h.shift(); });
    st.total.push(stkTotal()); if(st.total.length > 60) st.total.shift();
  }
  if(t - stkSaved >= 5000){ stkSaved = t; saveTick(); }
}

function renderStock(){
  $('stkList').innerHTML = allStocks().map(s => `<div class="stk" data-stk="${s.id}"><div class="e">${esc(s.e)}</div>
    <div class="info"><div class="name">${esc(s.name)} <small>${esc(s.code)}</small></div><div class="hold" id="sh-${s.id}"></div></div>
    <svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline id="sl-${s.id}" points="" vector-effect="non-scaling-stroke"/></svg>
    <div class="px num" id="sp-${s.id}"><b></b><span class="up"></span></div></div>`).join('');
  stkTapeT = 0;
  paintStock();
  if(stkGapNote){ stkGapNote = false; toast('休市期间利好不断，今天全线高开 🚀'); }
}
function paintStock(){
  const st = D.stock, tot = stkTotal(), all = tot - STOCK_CASH;
  $('stkTotal').textContent = masked(yuan(tot));
  $('stkRate').innerHTML = `<span>今日 <b>${plus(tot - st.day.base)}</b></span><span>累计 <b>${plus(all)}（${upPct(tot, STOCK_CASH)}）</b></span><span>可用 ${masked(yuan(st.cash))}</span>`;
  $('stkLine').setAttribute('points', spark(st.total));
  if(Date.now() - stkTapeT > 10000){ stkTapeT = Date.now(); $('stkTape').textContent = TAPE[Math.floor(Math.random() * TAPE.length)]; }
  allStocks().forEach(s => {
    const px = st.px[s.id], h = held(s.id), el = $('sp-' + s.id);
    el.firstChild.textContent = px.toFixed(2);
    el.lastChild.textContent = upPct(px, st.day.open[s.id] || px);
    $('sh-' + s.id).innerHTML = h.n ? `持有 ${h.n} 股 · 赚 <b>${plus((px - h.cost) * h.n)}</b>` : '未持有';
    $('sl-' + s.id).setAttribute('points', spark(st.hist[s.id]));
    if(stkFlash[s.id]){ stkFlash[s.id] = false; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  });
}
function tickStock(now){
  stockStep(now);
  if(current === 'stock') paintStock();
  paintTrade();
}

let tradeId = null;
function openTrade(id){
  tradeId = id;
  const s = findStock(id);
  openSheet(`<div class="e">${esc(s.e)}</div><h3>${esc(s.name)} <small>${esc(s.code)}</small></h3>
    <div class="trade-px num" id="tdPrice"></div><p id="tdInfo"></p>
    <div class="trade-btns" id="tdBtns"><button class="btn" data-td="one">买 1 手</button><button class="btn yolk" data-td="all">全仓梭哈</button><button class="btn primary" data-td="sell">全部卖出，落袋为安</button></div>
    ${s.custom ? '<button class="btn ghost block" id="tdEdit" style="margin-top:10px">✎ 编辑或删除这只股票</button>' : ''}`);
  if(s.custom) $('tdEdit').onclick = () => stockSheet(id);
  $('tdBtns').onclick = ev => { const b = ev.target.closest('button'); if(b && !b.disabled) trade(b.dataset.td); };
  paintTrade();
}
function paintTrade(){
  if(!tradeId || $('modal').classList.contains('hidden') || !$('tdPrice')) return;
  const st = D.stock, px = st.px[tradeId], h = held(tradeId), lot = px * 100;
  $('tdPrice').innerHTML = `¥${px.toFixed(2)}<span class="up">${upPct(px, st.day.open[tradeId] || px)}</span>`;
  const gain = (px - h.cost) * h.n, w = asWork(gain);
  $('tdInfo').innerHTML = h.n
    ? `持有 <b>${h.n}</b> 股，成本 ¥${h.cost.toFixed(2)}<br>已经赚了 <b>${plus(gain)}</b>${w ? `，相当于上了 ${w}` : ''}`
    : `可用资金 ${masked(yuan(st.cash))}<br>1 手 = 100 股 = ${yuan(lot)}`;
  const btns = $('tdBtns').children;
  btns[0].disabled = btns[1].disabled = st.cash < lot;
  btns[2].disabled = !h.n;
}
function trade(act){
  const st = D.stock, s = findStock(tradeId), px = st.px[tradeId], h = held(tradeId);
  if(act === 'sell'){
    const gain = (px - h.cost) * h.n, w = asWork(gain);
    st.cash += px * h.n; delete st.pos[tradeId];
    toast(`${SELL_QUIPS[Math.floor(Math.random() * SELL_QUIPS.length)]}赚了 ${plus(gain).slice(1)}${w ? `，顶 ${w}` : ''}`);
    ding();
    if(gain >= 1000) confetti(['📈','💰','🧧','✨']);
  } else {
    const lots = act === 'all' ? Math.floor(st.cash / (px * 100)) : 1, n = lots * 100;
    if(!lots) return;
    st.pos[tradeId] = {n:h.n + n, cost:(h.cost * h.n + px * n) / (h.n + n)};
    st.cash -= px * n;
    toast(act === 'all' ? `梭哈 ${s.name} ${n} 股！稳了 🚀` : `买入 ${s.name} 100 股，坐等上涨 📈`);
  }
  saveD(); paintStock(); paintTrade();
}
function stockSheet(id){
  const old = id ? findStock(id) : null;
  let emoji = old ? old.e : STOCK_EMOJI[0], v = old ? old.v : SPEEDS[1][1];
  const close = openSheet(`<div class="e" id="scE"></div><h3>${old ? '编辑股票' : '自定义股票'}</h3>
    <input class="field" id="scName" maxlength="8" placeholder="公司名，比如：周末永动机" autocomplete="off" value="${old ? esc(old.name) : ''}">
    <input class="field" id="scCode" maxlength="6" placeholder="股票代码（可不填）" autocomplete="off" value="${old ? esc(old.code) : ''}">
    ${old ? '' : '<div class="field money-field"><span>¥</span><input id="scPrice" type="number" inputmode="decimal" min="0" placeholder="开盘价（默认 10 元）"></div>'}
    <div class="emoji-pick" id="scPick">${STOCK_EMOJI.map(e => `<button data-e="${e}">${e}</button>`).join('')}</div>
    <div class="sec-title" style="margin:0">涨势</div>
    <div class="rate-chips" id="scSpeed" style="margin:8px 0 14px">${SPEEDS.map(([t, x]) => `<button data-v="${x}">${t}</button>`).join('')}</div>
    <p class="warn hidden" id="scWarn"></p>
    <div class="btns"><button class="btn" id="scCancel">取消</button><button class="btn primary" id="scOk">${old ? '保存' : '上市'}</button></div>
    ${old ? '<button class="btn ghost block" id="scDel" style="margin-top:10px">退市（持仓按现价卖出）</button>' : ''}`);
  const setEmoji = e => { emoji = e; $('scE').textContent = e; document.querySelectorAll('#scPick button').forEach(b => b.classList.toggle('on', b.dataset.e === e)); };
  const setSpeed = x => { v = x; document.querySelectorAll('#scSpeed button').forEach(b => b.classList.toggle('on', +b.dataset.v === x)); };
  setEmoji(emoji); setSpeed(v);
  $('scPick').onclick = ev => { const b = ev.target.closest('button'); if(b) setEmoji(b.dataset.e); };
  $('scSpeed').onclick = ev => { const b = ev.target.closest('button'); if(b) setSpeed(+b.dataset.v); };
  $('scCancel').onclick = close;
  $('scOk').onclick = () => {
    const name = $('scName').value.trim(), code = $('scCode').value.trim().toUpperCase() || 'DIY';
    const warn = m => { $('scWarn').textContent = m; $('scWarn').classList.remove('hidden'); };
    if(!name) return warn('给公司起个名字');
    if(old){ Object.assign(old, {e:emoji, name, code, v}); saveD(); close(); renderStock(); toast(`${emoji} ${name} 已更新`); return; }
    const raw = $('scPrice').value, p = raw === '' ? 10 : parseFloat(raw);
    if(!isFinite(p) || p <= 0) return warn('开盘价要大于 0');
    const s = {id:'s' + newId(), e:emoji, name, code, p:Math.round(p * 100) / 100, v, custom:true}, st = D.stock;
    D.stockCustom.push(s);
    st.px[s.id] = s.p; st.hist[s.id] = [s.p];
    if(st.day) st.day.open[s.id] = s.p;
    saveD(); close(); renderStock(); toast(`${emoji} ${name} 上市了，开盘就涨 🚀`);
  };
  if(old) $('scDel').onclick = () => {
    const st = D.stock, h = held(id), gain = (st.px[id] - h.cost) * h.n;
    if(h.n) st.cash += st.px[id] * h.n;
    delete st.pos[id]; delete st.px[id]; delete st.hist[id];
    D.stockCustom = D.stockCustom.filter(x => x.id !== id);
    saveD(); close(); renderStock();
    toast(h.n ? `${old.name} 退市了，持仓已卖出，赚了 ${plus(gain).slice(1)}` : `${old.name} 已退市`);
  };
}
$('stkList').addEventListener('click', ev => { const r = ev.target.closest('[data-stk]'); if(r) openTrade(r.dataset.stk); });
$('stkAdd').onclick = () => stockSheet();
$('stkReset').onclick = () => modal({emoji:'🏦', title:'清仓销户，重新开户？', text:'持仓和收益都会清空，账户恢复成 10 万本金。', ok:'重新开户', cancel:'不了',
  onOk: () => { D.stock = newStock(); saveD(); renderStock(); toast('新账户已开，10 万到账 💰'); }});

/* ---------- 设置 ---------- */
const PRESETS = [
  {unitEmoji:'🧋', unitName:'奶茶',   unitWord:'杯', unitPrice:20},
  {unitEmoji:'☕', unitName:'咖啡',   unitWord:'杯', unitPrice:15},
  {unitEmoji:'🍜', unitName:'螺蛳粉', unitWord:'碗', unitPrice:18},
  {unitEmoji:'🐱', unitName:'猫罐头', unitWord:'罐', unitPrice:8},
  {unitEmoji:'🎮', unitName:'游戏机', unitWord:'台', unitPrice:2500}
];
$('presets').innerHTML = PRESETS.map((p, i) => `<button data-i="${i}">${p.unitEmoji} ${p.unitName}</button>`).join('');
$('presets').onclick = ev => {
  const b = ev.target.closest('button'); if(!b) return;
  Object.assign(S, PRESETS[+b.dataset.i]); saveS(); fillForm(); lastUnitFloor = null; toast('已换成 ' + S.unitName);
};
$('f-days').innerHTML = [1,2,3,4,5,6,0].map(d => `<button data-d="${d}">${WEEK[d]}</button>`).join('');
$('f-days').onclick = ev => {
  const b = ev.target.closest('button'); if(!b) return;
  const d = +b.dataset.d;
  bankJar();
  S.days = S.days.includes(d) ? S.days.filter(x => x !== d) : S.days.concat(d);
  saveS(); fillForm(); savedToast(); queuePushSync();
};
const FIELDS = ['saveRate','salary','payDays','payday','start','end','nightStart','nightEnd','noLunch','lunchStart','lunchEnd','lunchPaid','unitEmoji','unitName','unitWord','unitPrice','richAsset','sound','hidden','remindOn','remindMin','evePreview','eveHour'];
function fillForm(){
  FIELDS.forEach(k => { const el = $('f-' + k); if(el.type === 'checkbox') el.checked = !!S[k]; else el.value = S[k]; });
  document.querySelectorAll('#f-days button').forEach(b => b.classList.toggle('on', S.days.includes(+b.dataset.d)));
  validateTimes();
}
function validateTimes(){
  const w = $('timeWarn'); let msg = '';
  if(endHm(S.end) <= hm(S.start)) msg = '白班结束要晚于开始时间。';
  else if(endHm(S.nightEnd) <= hm(S.nightStart)) msg = '夜班结束要晚于夜班开始时间（结束填 00:00 表示干到 24 点）。';
  else if(!S.noLunch && !lunchValid()) msg = '午休时间不在上班时间内，暂时按没有午休计算。';
  else if(!S.days.length) msg = '没勾默认上班的日子，没排班的日期就都算休息 😎';
  w.textContent = msg; w.classList.toggle('hidden', !msg);
}
let saveTimer;
function savedToast(){ clearTimeout(saveTimer); saveTimer = setTimeout(() => toast('已保存 ✓'), 500); }
FIELDS.forEach(k => {
  const el = $('f-' + k);
  el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if(el.type === 'number'){
      v = parseFloat(v);
      if(!isFinite(v) || v < 0 || (v === 0 && k !== 'saveRate')) return;
      if(k === 'saveRate') v = Math.min(100, Math.round(v));
      if(k === 'payday') v = Math.min(31, Math.max(1, Math.round(v)));
    } else if(el.type === 'time'){
      if(!/^\d{2}:\d{2}/.test(v)) return;
      v = v.slice(0, 5);
      const test = Object.assign({}, S, {[k]: v});
      if((k === 'start' || k === 'end') && endHm(test.end) <= hm(test.start)){
        $('timeWarn').textContent = '白班结束要晚于开始时间。';
        $('timeWarn').classList.remove('hidden');
        return;
      }
      if((k === 'nightStart' || k === 'nightEnd') && endHm(test.nightEnd) <= hm(test.nightStart)){
        $('timeWarn').textContent = '夜班结束要晚于夜班开始时间（结束填 00:00 表示干到 24 点）。';
        $('timeWarn').classList.remove('hidden');
        return;
      }
    } else if(el.type === 'text'){
      v = v.trim(); if(!v) return;
    }
    if(el.tagName === 'SELECT') v = parseInt(v, 10);
    if(k !== 'hidden' && k !== 'sound') bankJar();
    S[k] = v; saveS(); store.set('onboarded', true);
    validateTimes();
    if(k === 'hidden') updateEye();
    if(['unitPrice','salary','payDays','start','end','nightStart','nightEnd','noLunch','lunchStart','lunchEnd','lunchPaid','days'].includes(k)){
      lastUnitFloor = null;
      renderTodayShift();
      if(current === 'shift') renderShift();
      tick(true);
    }
    if(['start','end','nightStart','nightEnd','remindOn','remindMin','evePreview','eveHour','days'].includes(k)) queuePushSync();
    savedToast();
  });
});
// time inputs: revert invalid start/end on blur
['start','end','nightStart','nightEnd'].forEach(k => $('f-' + k).addEventListener('change', () => {
  if(!/^\d{2}:\d{2}/.test($('f-' + k).value)){ fillForm(); return; }
  fillForm();
}));
$('clearRecords').onclick = () => modal({emoji:'🧹', title:'清空摸鱼和加班记录？', text:'清空后无法恢复。', ok:'清空', cancel:'算了',
  onOk: () => { D.fish = []; D.fishActive = null; D.ot = {active:null, log:{}}; saveD(); toast('已清空'); }});
$('resetSettings').onclick = () => modal({emoji:'↩️', title:'恢复默认设置？', text:'工资和时间会恢复成示例值，记录会保留。', ok:'恢复', cancel:'算了',
  onOk: () => { bankJar(); S = Object.assign({}, DEFAULTS); saveS(); fillForm(); updateEye(); lastUnitFloor = null; toast('已恢复默认'); }});

$('clearWishes').onclick = () => modal({emoji:'🐷', title:'清空愿望和存钱罐？', text:'愿望清单、愿望墙和罐子里的钱都会清空，无法恢复。', ok:'清空', cancel:'算了',
  onOk: () => { D.wishes = []; D.wall = []; D.deposits = []; D.jar = null; saveD(); toast('已清空'); }});

/* ---------- 排班 ---------- */
const fmtT = sec => pad(Math.floor(sec/3600)) + ':' + pad(Math.floor(sec%3600/60));
function shiftWindowText(d){
  const w = windowOf(d);
  if(!w) return '今天不上班';
  return fmtT(w[0]) + ' – ' + (w[1] === 86400 ? '24:00' : fmtT(w[1]));
}
function renderTodayShift(){
  const now = new Date(), sh = shiftOf(now);
  $('shiftTime').textContent = shiftWindowText(now);
  document.querySelectorAll('#shiftOpts button').forEach(b => b.classList.toggle('on', b.dataset.shift === sh));
  $('shiftHint').textContent = isScheduled(now) ? '已按排班表设置' : ('今天还没排班，先按默认（' + SHIFT[sh].name + '）算');
}
$('shiftOpts').addEventListener('click', ev => {
  const b = ev.target.closest('[data-shift]'); if(!b) return;
  const now = new Date(), k = dateKey(now), sh = b.dataset.shift;
  bankJar();
  D.shifts[k] = sh; saveD();
  renderTodayShift(); tick(true); queuePushSync();
  toast(`${SHIFT[sh].emoji} 今天改成${SHIFT[sh].name}`);
});
$('goShift').onclick = () => go('shift');

let calCursor = new Date();
calCursor.setDate(1);
function renderShift(){
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  $('calTitle').textContent = `${y} 年 ${m+1} 月`;
  const first = new Date(y, m, 1), days = new Date(y, m+1, 0).getDate();
  const lead = first.getDay();
  const todayKey = dateKey(new Date());
  let html = ['日','一','二','三','四','五','六'].map(w => `<div class="wd">${w}</div>`).join('');
  for(let i = 0; i < lead; i++) html += '<button class="pad"></button>';
  const stat = {d:0, n:0, x:0, u:0};
  for(let day = 1; day <= days; day++){
    const d = new Date(y, m, day), k = dateKey(d);
    const sched = isScheduled(d), sh = shiftOf(d);
    const key = sched ? sh : 'u';                       // 还没排班的日期显示「未排」，不冒充默认班次
    stat[key]++;
    const label = sched ? SHIFT[sh].short : '未排';
    html += `<button class="s-${key}${k === todayKey ? ' today' : ''}" data-day="${day}">${day}<small>${label}</small></button>`;
  }
  $('cal').innerHTML = html;
  const u = stat.u ? `<span class="u">❓ 未排班 ${stat.u} 天</span>` : '';
  $('calStat').innerHTML = `<span class="d">☀️ 白班 ${stat.d} 天</span><span class="n">🌙 夜班 ${stat.n} 天</span><span>😴 休息 ${stat.x} 天</span>${u}`;
}
$('cal').addEventListener('click', ev => {
  const b = ev.target.closest('[data-day]'); if(!b) return;
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  const d = new Date(y, m, +b.dataset.day), k = dateKey(d);
  // 白班 → 夜班 → 休息 → 未排班（清掉）→ 白班
  const order = ['d', 'n', 'x', null];
  const cur = isScheduled(d) ? D.shifts[k] : null;
  const next = order[(order.indexOf(cur) + 1) % order.length];
  bankJar();
  if(next) D.shifts[k] = next; else delete D.shifts[k];
  saveD();
  renderShift(); queuePushSync();
  if(k === dateKey(new Date())){ renderTodayShift(); tick(true); }
});
$('calPrev').onclick = () => { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth()-1, 1); renderShift(); };
$('calNext').onclick = () => { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth()+1, 1); renderShift(); };
function fillMonth(sh){
  bankJar();
  const y = calCursor.getFullYear(), m = calCursor.getMonth(), days = new Date(y, m+1, 0).getDate();
  for(let day = 1; day <= days; day++) D.shifts[dateKey(new Date(y, m, day))] = sh;
  saveD(); renderShift(); renderTodayShift(); tick(true); queuePushSync();
  toast(`${SHIFT[sh].emoji} 这个月都设成${SHIFT[sh].name}了`);
}
$('fillD').onclick = () => fillMonth('d');
$('fillN').onclick = () => fillMonth('n');
$('fillX').onclick = () => fillMonth('x');
$('clearMonth').onclick = () => {
  const y = calCursor.getFullYear(), m = calCursor.getMonth(), days = new Date(y, m+1, 0).getDate();
  for(let day = 1; day <= days; day++) delete D.shifts[dateKey(new Date(y, m, day))];
  saveD(); renderShift(); renderTodayShift(); tick(true); queuePushSync(); toast('本月排班已清空，按默认算');
};

/* ---------- eye / welcome ---------- */
function updateEye(){ $('eyeBtn').textContent = S.hidden ? '🙈' : '👀'; lastCents = null; }
$('eyeBtn').onclick = () => { S.hidden = !S.hidden; saveS(); updateEye(); if(current === 'settings') fillForm(); if(current === 'fish') renderFish(); if(current === 'rich') renderRich(); if(current === 'wish') renderWish(); if(current === 'stock') renderStock(); tick(true); toast(S.hidden ? '金额已隐藏 🙈' : '金额已显示 👀'); };
if(!store.get('onboarded', false)) $('welcome').classList.remove('hidden');
$('goSettings').onclick = () => { store.set('onboarded', true); $('welcome').classList.add('hidden'); go('settings'); };
$('dismissWelcome').onclick = () => { store.set('onboarded', true); $('welcome').classList.add('hidden'); };
$('fishMini').onclick = () => go('fish');
$('wishMini').onclick = () => go('wish');

/* ---------- loop ---------- */
function tick(force){
  const now = new Date(), t = now.getTime();
  const jumped = force === true || (lastTick && t - lastTick > 3000);
  lastTick = t;
  if(current === 'today') tickToday(now, jumped);
  else { lastUnitFloor = null; lastSec = null; }
  if(current === 'fish') tickFish(now);
  if(current === 'wish') tickWish(now);
  tickStock(now);
  checkReached(now);
}
updateEye();
renderTodayShift();
history.replaceState({tab:'today'}, '', '#today');
showTab('today');
setInterval(tick, 200);
document.addEventListener('visibilitychange', () => { if(!document.hidden){ lastTick = 0; tick(true); } });

/* ---------- gift banner（专属版）---------- */
(function(){
  $('giftName').textContent = GIFT.to;
  $('giftSign').textContent = '—— ' + GIFT.from;
  const day = Math.floor(Date.now() / 86400000);
  $('giftLine').textContent = GIFT.lines[day % GIFT.lines.length];
})();

/* ---------- 班次提醒：Web Push + 日历导出 ---------- */
const PUSH_API = './api';
function b64ToU8(base64){
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const s = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s), arr = new Uint8Array(raw.length);
  for(let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
function pushShifts(){
  return scheduledShifts(60);
}
function pushSettings(){
  return {
    start: S.start, end: S.end, nightStart: S.nightStart, nightEnd: S.nightEnd,
    remindMin: +S.remindMin || 30, evePreview: !!S.evePreview, eveHour: +S.eveHour || 21, remindOn: !!S.remindOn
  };
}
const setPushState = t => { const el = $('pushState'); if(el) el.textContent = '提示：' + t; };
async function pushSub(){
  if(!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
let syncTimer = null;
function queuePushSync(){ clearTimeout(syncTimer); syncTimer = setTimeout(() => { syncPush().catch(() => {}); }, 2500); }
async function syncPush(){
  if(!S.remindOn) return;
  const sub = await pushSub(); if(!sub) return;
  await fetch(PUSH_API + '/schedule', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({subscription: sub.toJSON(), shifts: pushShifts(), settings: pushSettings()})
  });
}
/* 推送环境检测：iOS / macOS Safari 必须先把网页「装成 App」才允许订阅通知 */
function pushEnv(opt){
  opt = opt || {};
  const ua = opt.ua || navigator.userAgent || '';
  const plat = opt.platform || navigator.platform || '';
  const touch = ('maxTouchPoints' in opt) ? opt.maxTouchPoints : (navigator.maxTouchPoints || 0);
  // iPadOS 13+ 默认请求桌面版，UA 写的是 Macintosh，只能靠「多点触控」区分于真 Mac
  const iOS = /iPad|iPhone|iPod/.test(ua) || (plat === 'MacIntel' && touch > 1);
  const macSafari = !iOS && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|Firefox/.test(ua);
  const standalone = ('standalone' in opt) ? !!opt.standalone : (
    window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || navigator.standalone === true);
  const m = ua.match(/OS (\d+)[._](\d+)/) || ua.match(/Version\/(\d+)\.(\d+)/);
  const ver = m ? (+m[1] + (+m[2]) / 10) : 0;
  const verText = m ? m[1] + '.' + m[2] : '';
  const env = {
    iOS, macSafari, standalone, ver,
    where: iOS ? 'iPhone' + (verText ? ' iOS ' + verText : '') : (macSafari ? 'Mac Safari' + (verText ? ' ' + verText : '') : '当前浏览器'),
    hasSW: 'serviceWorker' in navigator,
    hasPush: 'PushManager' in window,
    hasNotif: 'Notification' in window
  };
  if(iOS && !standalone)
    return Object.assign(env, {level:'install', msg:'iPhone 上必须先装成 App 才能收提醒：Safari 打开本页 → 底部「分享 ⬆️」→「添加到主屏幕」→ 从桌面的图标打开本 App → 再回来点这个按钮'});
  if(iOS && ver && ver < 16.4)
    return Object.assign(env, {level:'old', msg:env.where + ' 版本太低：网页推送需要 iOS 16.4 以上。先用下面的「导出到日历」方案，升级系统后再开推送'});
  if(macSafari && !standalone)
    return Object.assign(env, {level:'install', msg:'Mac 上 Safari 需要先装成 App：菜单栏「文件」→「添加到程序坞」→ 从程序坞打开本 App → 再点这个按钮。也可以直接用网址里的日历方案'});
  if(!env.hasSW)
    return Object.assign(env, {level:'api', msg:'浏览器没有启用 Service Worker（需要 HTTPS，且不要用无痕/隐私模式）'});
  if(!env.hasPush || !env.hasNotif)
    return Object.assign(env, {level:'api', msg:env.where + ' 不支持网页推送（iOS 要 16.4 以上、且从主屏图标打开）。可以先用下面的日历方案'});
  return Object.assign(env, {level:'ok', msg:''});
}
// 只有"已排班"的日期才下发提醒；组长没排的日期不下发，等排了再提醒
function scheduledShifts(days){
  const out = {}, d0 = dayStart(new Date());
  for(let i = 0; i < days; i++){
    const d = new Date(d0); d.setDate(d.getDate() + i);
    if(!isScheduled(d)) continue;
    out[dateKey(d)] = D.shifts[dateKey(d)];
  }
  return out;
}
const scheduledCount = days => Object.keys(scheduledShifts(days || 60)).length;

$('enablePush').onclick = async () => {
  const env = pushEnv();
  if(env.level !== 'ok'){ setPushState('⚠️ ' + env.msg); toast('看下面的提示 👇'); return; }
  try{
    let perm = Notification.permission;
    if(perm === 'default') perm = await Notification.requestPermission();
    if(perm !== 'granted'){ setPushState('通知权限没开：iPhone 设置 → 通知 → 今天赚了吗 → 允许通知'); return; }
    setPushState('环境：' + env.where + ' · 已装成 App · 正在订阅…');
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Service Worker 没就绪，把 App 从后台彻底划掉再打开一次试试')), 8000))
    ]);
    const {key} = await fetch(PUSH_API + '/vapid').then(r => r.json());
    let sub = await reg.pushManager.getSubscription();
    if(!sub) sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64ToU8(key)});
    const res = await fetch(PUSH_API + '/subscribe', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({subscription: sub.toJSON(), shifts: pushShifts(), settings: pushSettings()})
    }).then(r => r.json());
    if(res.ok){
      if(!S.remindOn){ S.remindOn = true; saveS(); }
      const n = scheduledCount(60);
      setPushState('已开启 ✓ ' + env.where + ' · 未来 60 天已排班 ' + n + ' 天会提醒，没排班的日期不会响');
      toast(n ? '提醒已开启 🔔' : '提醒已开启，但还没排班，先去排班页排几天 🔔');
    } else setPushState('订阅失败：' + (res.error || '未知错误'));
  }catch(e){ setPushState('开启失败：' + (e.message || e)); }
};
$('testPush').onclick = async () => {
  try{
    const sub = await pushSub();
    if(!sub) return toast('先点上面的「开启手机提醒」');
    const r = await fetch(PUSH_API + '/test', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({subscription: sub.toJSON()})
    }).then(r => r.json());
    toast(r.ok ? '测试提醒已发出，稍等一下 🔔' : '发送失败：' + (r.error || ''));
  }catch(e){ toast('发送失败，检查网络'); }
};

/* 备用方案：导出 .ics 到 iPhone 日历（不依赖推送服务） */
const icsPad = n => String(n).padStart(2, '0');
const icsUTC = d => d.getUTCFullYear() + icsPad(d.getUTCMonth()+1) + icsPad(d.getUTCDate()) + 'T'
  + icsPad(d.getUTCHours()) + icsPad(d.getUTCMinutes()) + '00Z';
function buildICS(days){
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//zhuanlema//shift-reminder//CN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:我的排班', 'X-WR-TIMEZONE:Asia/Shanghai'];
  const pre = +S.remindMin || 30;
  const d0 = dayStart(new Date());
  for(let i = 0; i < days; i++){
    const d = new Date(d0); d.setDate(d.getDate() + i);
    // 只导出「已排班」的日期：组长还没排的日子不加事件、不加闹钟
    if(!isScheduled(d)) continue;
    const kk = dateKey(d), sh = D.shifts[kk], w = windowOf(d);
    const k = kk.replace(/-/g, '');
    if(!w){
      lines.push('BEGIN:VEVENT', 'UID:rest-' + k + '@zhuanlema', 'DTSTAMP:' + icsUTC(new Date()),
        'DTSTART;VALUE=DATE:' + k, 'SUMMARY:😴 休息', 'TRANSP:TRANSPARENT', 'END:VEVENT');
      continue;
    }
    const [ws, we] = w;
    const sd = new Date(d.getTime() + ws * 1000);
    const ed = new Date(d.getTime() + we * 1000);
    const name = (sh === 'n' ? '🌙 夜班 ' : '☀️ 白班 ') + fmtT(ws) + '–' + (we === 86400 ? '24:00' : fmtT(we));
    lines.push('BEGIN:VEVENT', 'UID:shift-' + k + '@zhuanlema', 'DTSTAMP:' + icsUTC(new Date()),
      'DTSTART:' + icsUTC(sd), 'DTEND:' + icsUTC(ed), 'SUMMARY:' + name,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:该准备上班啦', 'TRIGGER:-PT' + pre + 'M', 'END:VALARM');
    if(S.evePreview){
      const eve = new Date(sd.getTime() - 86400000);
      eve.setHours(+S.eveHour || 21, 0, 0, 0);
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:明天' + (sh === 'n' ? '夜班' : '白班'),
        'TRIGGER;VALUE=DATE-TIME:' + icsUTC(eve), 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
$('icsBtn').onclick = async () => {
  const n = scheduledCount(62);
  if(!n){
    setPushState('未来两个月还没有排班，去「📅 排班」页先排几天，再回来导出');
    toast('还没排班，先排几天 📅');
    return;
  }
  const ics = buildICS(62);
  toast('正在生成 ' + n + ' 天的排班日历…');
  try{
    const r = await fetch(PUSH_API + '/ics', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ics})
    }).then(r => r.json());
    if(r.ok && r.url){
      location.href = r.url;   // iOS 会弹「添加到日历」
      return;
    }
    throw new Error(r.error || 'no url');
  }catch(e){
    try{
      const blob = new Blob([ics], {type: 'text/calendar;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = '我的排班.ics';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => toast('已下载，点开文件选「添加到日历」就能导入'), 600);
    }catch(e2){ toast('导出失败，可以截图存下来'); }
  }
};

/* ---------- 账号与云端数据 ---------- */
const authSet = (token, user) => { AUTH.token = token; AUTH.user = user; store.set('auth', {token, user}); };
const setSyncState = t => { const el = $('acctSync'); if(el) el.textContent = t; };
function showLogin(){
  $('login').classList.remove('hidden');
  const w = $('welcome'); if(w) w.classList.add('hidden');
  setTimeout(() => { const el = $('lgUser'); if(el) el.focus(); }, 250);
}
const hideLogin = () => $('login').classList.add('hidden');

let dataSyncTimer = null, dataSyncAuto = false;
function queueDataSync(auto){
  try{
    if(!AUTH || !AUTH.token || applyingRemote) return;
    clearTimeout(dataSyncTimer);
    dataSyncAuto = !!auto;
    // 行情类自动保存慢慢推，避免两台设备互相覆盖
    dataSyncTimer = setTimeout(() => pushData({auto: dataSyncAuto}), dataSyncAuto ? 8000 : 1500);
  }catch(e){}
}
const parseSaved = s => Date.parse(String(s || '').replace(/\.\d+/, '')) || 0;

/* 同步锚点：这台设备最后一次和服务器对齐的时间，绑定用户名。
   只有「本机确实跟这个账号同步过」并且之后又改过，才算本机更新；
   新设备第一次登录一律以云端为准 —— 绝不能拿本地默认值把云端数据冲掉。 */
function getAnchor(){ try{ return store.get('syncAnchor', null) || null; }catch(e){ return null; } }
function setAnchor(user, saved){ store.set('syncAnchor', {user: user || '', saved: saved || ''}); }
function anchored(){ const a = getAnchor(); return !!(a && a.user && a.user === AUTH.user); }
function localNewerThan(serverSaved){
  const a = getAnchor();
  if(!a || !a.user || a.user !== AUTH.user) return false;   // 这台设备没跟该账号同步过 → 听云端的
  if(!dirty) return false;
  const le = store.get('lastEdit', 0) || 0;
  return le > Math.max(parseSaved(serverSaved), parseSaved(a.saved));
}
async function getRemote(){
  const r = await fetch(PUSH_API + '/data', {headers: {'Authorization': 'Bearer ' + AUTH.token}}).then(r => r.json());
  if(!r.ok) return {ok: false, error: r.error};
  const d = r.data || {};
  const has = !!((d.settings && Object.keys(d.settings).length) || (d.data && Object.keys(d.data).length));
  return {ok: true, has, data: d, saved: r.saved || ''};
}
async function pushData(opts){
  const auto = !!(opts && opts.auto);
  if(!AUTH.token) return;
  // 守护：这台设备还没跟该账号对齐过，就先拉云端，别拿本地默认数据覆盖
  if(!auto && !anchored()){
    try{
      const g = await getRemote();
      if(g.ok && g.has){
        applyRemote(g.data, g.saved);
        setSyncState('已同步 ' + String(g.saved || '').slice(11, 16));
        return;
      }
      if(g.ok) setAnchor(AUTH.user, '');     // 云端为空：允许用本机数据建档
    }catch(e){ setSyncState('离线，稍后自动重试'); return; }
  }
  const sentAt = Date.now();
  const base = auto ? '' : ((getAnchor() || {}).saved || '');
  try{
    const r = await fetch(PUSH_API + '/data', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AUTH.token},
      body: JSON.stringify({data: {settings: S, data: D, at: sentAt}, base, auto})
    }).then(r => r.json());
    if(r.ok){
      if(!auto){
        if((store.get('lastEdit', 0) || 0) <= sentAt) dirty = false;   // 这之后没有新改动才算同步完成
        setAnchor(AUTH.user, r.saved);
        setSyncState('已保存 ' + String(r.saved || '').slice(11, 16));
      }
    }
    else if(r.error === 'conflict'){
      // 另一台设备刚写过，以服务器为准刷新，避免互相覆盖
      applyRemote(r.data, r.saved);
      toast('另一台设备有新改动，已同步成最新数据');
      setSyncState('已同步 ' + String(r.saved || '').slice(11, 16));
    }
    else if(r.error === 'unauthorized') doLogout(true);
    else if(!auto) setSyncState('保存失败');
  }catch(e){ if(!auto) setSyncState('离线，稍后自动重试'); }
}
function applyRemote(payload, saved){
  if(!payload) return;
  applyingRemote = true;
  try{
    if(payload.settings) S = Object.assign({}, DEFAULTS, payload.settings);
    if(payload.data){
      D = Object.assign({fish:[], fishCats:[], stockCustom:[], fishActive:null,
        ot:{active:null, log:{}}, rich:{}, wishes:[], wall:[], deposits:[], jar:null, shifts:{}}, payload.data);
    }
    if(!D.ot) D.ot = {active:null, log:{}};
    if(!D.shifts) D.shifts = {};
    store.set('settings', S); store.set('data', D); store.set('onboarded', true);
    setAnchor(AUTH.user, saved || payload.saved || '');
    $('acctName').textContent = AUTH.user || '—';
    fillForm(); updateEye(); renderTodayShift();
    if(current === 'shift') renderShift();
    if(current === 'fish') renderFish();
    if(current === 'wish') renderWish();
    if(current === 'rich') renderRich();
    if(current === 'stock') renderStock();
    lastUnitFloor = null;
    tick(true);
    dirty = false;            // 本机已与服务器一致
  } finally { applyingRemote = false; }
}
/* 本机是否真的有「用户数据」（用来区分新设备一片空白 和 老设备有历史）。
   注意：模拟股价（stock.px/hist）是页面自己跑出来的，不算用户数据 */
function hasRealData(d){
  d = d || {};
  const n = o => !!(o && Object.keys(o).length);
  return !!(n(d.shifts) || (d.fish && d.fish.length) || n(d.ot && d.ot.log) ||
            n(d.wishes) || n(d.deposits) || n(d.rich) ||
            (d.stockCustom && d.stockCustom.length) || (d.stock && n(d.stock.pos)));
}
/* 数据丰富度：条目越多说明是「用得多的那台设备」 */
function dataScore(d){
  if(!d) return 0;
  const k = o => Object.keys(o || {}).length;
  return k(d.shifts) * 3 + k(d.ot && d.ot.log) * 2 + ((d.fish || []).length) * 2 +
         ((d.wishes || []).length) * 3 + ((d.deposits || []).length) * 2 +
         ((d.wall || []).length) + k(d.rich) * 2;
}
/* 云端 vs 本机，谁赢：
   1) 本机没跟这账号同步过 + 本机是真数据 + 比云端新 + 比云端更丰富 → 旧版升级的一次性桥接，上传
   2) 本机确实有未上传改动 → 上传
   3) 其余一律以云端为准（新设备、空白数据永远覆盖不了云端） */
function reconcile(remoteData, remoteSaved){
  const le = store.get('lastEdit', 0) || 0;
  const remoteD = (remoteData && remoteData.data) || {};
  if(!anchored() && hasRealData(D) && le > parseSaved(remoteSaved) &&
     dataScore(D) > dataScore(remoteD)){
    setAnchor(AUTH.user, remoteSaved);
    pushData();
    return 'up';
  }
  if(localNewerThan(remoteSaved)){ pushData(); return 'up'; }
  applyRemote(remoteData, remoteSaved);
  return 'down';
}
async function fetchRemote(){
  if(!AUTH.token) return false;
  try{
    const g = await getRemote();
    if(!g.ok){
      if(g.error === 'unauthorized'){ authSet('', ''); return false; }
      setSyncState('服务器返回异常，暂用本机缓存');
      return false;
    }
    if(g.has){
      if(reconcile(g.data, g.saved) === 'up') setSyncState('本机有更新的改动，正在上传…');
      else setSyncState('已同步 ' + String(g.saved || '').slice(11, 16));
    }
    else { setAnchor(AUTH.user, ''); setSyncState('首次使用，上传本机数据…'); pushData(); }
    return true;
  }catch(e){ setSyncState('离线，暂用本机缓存'); return true; }
}
async function doLogin(){
  const u = $('lgUser').value.trim(), p = $('lgPass').value;
  $('lgErr').textContent = '';
  if(!u || !p){ $('lgErr').textContent = '账号和密码都要填'; return; }
  $('lgBtn').textContent = '登录中…'; $('lgBtn').disabled = true;
  try{
    const r = await fetch(PUSH_API + '/login', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: u, password: p})
    }).then(r => r.json());
    if(!r.ok){ $('lgErr').textContent = r.error || '登录失败'; return; }
    authSet(r.token, r.user);
    hideLogin();
    const d = r.data || {};
    const has = !!((d.settings && Object.keys(d.settings).length) || (d.data && Object.keys(d.data).length));
    if(has){
      const way = reconcile(d, r.saved);
      toast(way === 'up' ? '登录成功，本机改动较新，正在上传…' : '登录成功，数据已从云端同步 ✓');
    }else{
      setAnchor(r.user, '');
      toast('登录成功，正在上传本机数据…');
      pushData();
    }
    if(!$('acctSync').textContent) setSyncState('已同步 ✓');
  }catch(e){ $('lgErr').textContent = '连不上服务器，检查一下网络'; }
  finally{ $('lgBtn').textContent = '登录'; $('lgBtn').disabled = false; }
}
async function doLogout(silent){
  const tk = AUTH.token;
  authSet('', '');
  dirty = false; store.set('syncAnchor', null);   // 换账号后重新对齐，别拿旧锚点判定
  try{ if(tk) await fetch(PUSH_API + '/logout', {method: 'POST', headers: {'Authorization': 'Bearer ' + tk}}); }catch(e){}
  if(!silent) toast('已退出登录');
  showLogin();
  $('lgPass').value = '';
}
$('lgBtn').onclick = doLogin;
$('lgPass').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); doLogin(); } });
$('lgUser').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); $('lgPass').focus(); } });
$('logoutBtn').onclick = () => modal({
  emoji: '👋', title: '退出登录？', text: '数据都已经存在服务器上，下次登录还能找回来。',
  ok: '退出', cancel: '再想想', onOk: () => doLogout()
});
(async function bootAuth(){
  if(!AUTH.token){ showLogin(); return; }
  $('acctName').textContent = AUTH.user || '';
  const ok = await fetchRemote();
  if(!ok) showLogin();
})();

/* ---------- 电脑端桌面小窗（置顶常驻） ---------- */
let pipWin = null, pipTimer = null;
function pipSupported(){ return 'documentPictureInPicture' in window; }
if(!pipSupported()){ const b = $('pipBtn'); if(b) b.style.display = 'none'; }
async function openPip(){
  if(!pipSupported()) return toast('这个浏览器不支持桌面小窗，Chrome / Edge 116 以上才有');
  if(pipWin && !pipWin.closed){ pipWin.focus(); return; }
  try{
    pipWin = await documentPictureInPicture.requestWindow({width: 300, height: 186});
  }catch(e){ return toast('小窗没打开，再点一次试试'); }
  const doc = pipWin.document;
  doc.body.innerHTML = `
    <style>
      *{box-sizing:border-box;margin:0}
      body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#FFF4D9;color:#1F1A13;
        display:flex;flex-direction:column;justify-content:space-between;height:100vh;padding:12px 14px;overflow:hidden}
      .top{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .chip{font-size:12px;font-weight:900;background:#FFFDF7;border:2px solid #1F1A13;border-radius:9px;padding:2px 7px;white-space:nowrap}
      .shift{font-size:12px;font-weight:800;color:#7A6F5F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .amt{font-size:34px;font-weight:900;letter-spacing:-1px;margin:4px 0 0;font-variant-numeric:tabular-nums}
      .sub{font-size:13px;font-weight:800;color:#7A6F5F;margin-top:2px}
      .track{height:9px;border-radius:9px;background:#F3E6C6;border:2px solid #1F1A13;overflow:hidden;margin-top:8px}
      .track i{display:block;height:100%;width:0;background:#FF5A36;transition:width .3s linear}
    </style>
    <div class="top"><span class="chip" id="pChip">—</span><span class="shift" id="pShift"></span></div>
    <div>
      <div class="amt" id="pAmt">¥0.00</div>
      <div class="sub" id="pSub"></div>
      <div class="track"><i id="pBar"></i></div>
    </div>`;
  const els = {
    chip: doc.getElementById('pChip'), shift: doc.getElementById('pShift'),
    amt: doc.getElementById('pAmt'), sub: doc.getElementById('pSub'), bar: doc.getElementById('pBar')
  };
  const upd = () => {
    if(!pipWin || pipWin.closed) return;
    const now = new Date(), st = status(now), sh = shiftOf(now), w = windowOf(now), sec = secOfDay(now);
    els.chip.textContent = (STATUS[st] && STATUS[st].chip) || '';
    els.shift.textContent = w
      ? SHIFT[sh].emoji + ' ' + SHIFT[sh].name + ' ' + fmtT(w[0]) + '–' + (w[1] === 86400 ? '24:00' : fmtT(w[1]))
      : '😴 休息日';
    els.amt.textContent = S.hidden ? '¥***' : yuan(earnedToday(now));
    let sub;
    if(!w) sub = '今天不用上班';
    else if(st === 'before') sub = '还有 ' + clock(w[0] - sec, true) + ' 上班';
    else if(st === 'after') sub = '今日收工，明天见';
    else if(st === 'lunch' || st === 'lunchPaid') sub = '午休中，距离下班 ' + clock(w[1] - sec, true);
    else sub = '距离下班 ' + clock(w[1] - sec, true);
    els.sub.textContent = sub;
    const pct = w ? Math.min(100, Math.max(0, (sec - w[0]) / (w[1] - w[0]) * 100)) : 100;
    els.bar.style.width = pct.toFixed(1) + '%';
  };
  upd();
  clearInterval(pipTimer);
  pipTimer = setInterval(upd, 500);
  pipWin.addEventListener('pagehide', () => { clearInterval(pipTimer); pipTimer = null; pipWin = null; });
}
$('pipBtn').onclick = openPip;

/* ---------- PWA ---------- */
(function(){
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if(!standalone && iOS && !store.get('pwaHinted', false)){
    store.set('pwaHinted', true);
    setTimeout(() => toast('iPhone：点分享 ⬆️ → 添加到主屏幕，就像装了 App'), 1200);
  }
  if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
    // 有新版 SW 接管后自动刷新一次（避免用户一直看到旧缓存）
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(reloading) return;
      reloading = true;
      location.reload();
    });
    const check = () => navigator.serviceWorker.register('sw.js?v=8', { updateViaCache: 'none' })
      .then(reg => reg.update().catch(() => {}))
      .catch(() => {});
    check();
    // 从后台切回来、以及每隔 1 小时，主动查一次更新
    document.addEventListener('visibilitychange', () => { if(!document.hidden) check(); });
    setInterval(check, 3600 * 1000);
  }
})();

/* 版本自检：CDN 会把 index.html 缓存 4 小时，这里带随机参数探一次
   v.json，发现线上有更新就自动跳过去，免得手机端长期停在旧版本 */
(function buildCheck(){
  if(!/^https?:$/.test(location.protocol)) return;
  fetch('./v.json?t=' + Date.now(), {cache: 'no-store'})
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      if(!j || !j.build) return;
      const foot = document.querySelector('.foot');
      if(foot && foot.textContent.indexOf('v' + j.build) >= 0) return;   // 已经是新版
      if(sessionStorage.getItem('buildHop') === j.build) return;         // 防来回跳
      sessionStorage.setItem('buildHop', j.build);
      location.replace('./?v=' + encodeURIComponent(j.build));
    }).catch(() => {});
})();
