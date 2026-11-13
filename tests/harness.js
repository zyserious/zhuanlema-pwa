const fs = require('fs');
const vm = require('vm');

function makeEl(){
  const el = new Proxy({}, {
    get(t, k){
      if(k === 'style') return (t.style = t.style || {});
      if(k === 'classList') return (t.classList = t.classList || {add(){},remove(){},toggle(){},contains(){return false}});
      if(k === 'dataset') return (t.dataset = t.dataset || {});
      if(k === 'children' || k === 'childNodes') return [];
      if(k === 'value' || k === 'textContent' || k === 'innerHTML' || k === 'scrollTop' || k === 'scrollHeight') return t[k] === undefined ? '' : t[k];
      if(k === 'getBoundingClientRect') return () => ({top:0,left:0,width:0,height:0,bottom:0});
      if(k === 'getContext') return () => new Proxy({}, {get:()=>()=>{}});
      if(k === 'appendChild' || k === 'removeChild' || k === 'append' || k === 'prepend' ||
         k === 'addEventListener' || k === 'removeEventListener' || k === 'setAttribute' ||
         k === 'focus' || k === 'blur' || k === 'click' || k === 'remove' || k === 'insertBefore') return () => {};
      if(k === 'querySelector') return () => makeEl();
      if(k === 'querySelectorAll') return () => [];
      if(typeof k === 'string' && t[k] !== undefined) return t[k];
      return t[k];
    },
    set(t,k,v){ t[k]=v; return true; }
  });
  return el;
}

function boot(env, seed){
  const store = Object.assign({}, seed || {});
  const ctx = {
    console, setTimeout: (f)=>0, clearTimeout(){}, setInterval: ()=>0, clearInterval(){},
    requestAnimationFrame: ()=>0, cancelAnimationFrame(){},
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k,v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    document: {
      getElementById: id => (ctx.__els[id] = ctx.__els[id] || makeEl()),
      querySelector: () => makeEl(), querySelectorAll: () => [],
      createElement: () => makeEl(), addEventListener(){}, body: makeEl(),
      documentElement: makeEl(), hidden: false, visibilityState: 'visible',
      write(){}, execCommand(){}
    },
    navigator: { userAgent: env.ua || 'Mozilla/5.0 (iPhone) Safari', serviceWorker: null,
                 platform: env.platform || 'iPhone', maxTouchPoints: 5, standalone: false,
                 clipboard: {writeText: ()=>Promise.resolve()} },
    location: {href: 'https://app.example.com/', search: '', origin: 'https://app.example.com', reload(){}},
    history: {replaceState(){}, pushState(){}},
    matchMedia: () => ({matches:false, addEventListener(){}, addListener(){}}),
    fetch: env.fetch, Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, Error, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl, URL, Blob: function(){}, File: function(){},
    Notification: undefined, caches: undefined, indexedDB: undefined,
    __els: {},
    scrollTo(){}, getComputedStyle: () => ({getPropertyValue: () => ''}),
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 3, screen: {width:390,height:844},
    visualViewport: {height: 844, addEventListener(){}}, matchMedia: () => ({matches:false, addEventListener(){}}),
    alert(){}, confirm(){ return false; }
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/.app.js', 'utf8'), ctx, {filename:'.app.js'});
  ctx.__store = store;
  return ctx;
}
module.exports = { boot };
