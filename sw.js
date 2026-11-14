/* 今天赚了吗 · service worker
   策略：
   - 页面导航（HTML）走「网络优先」，保证每次打开都是最新版；断网时回退缓存
   - 静态资源（图标、manifest）走「缓存优先 + 后台更新」
   - 每次发布改 CACHE 版本号，activate 时清掉旧缓存 */
const CACHE = 'zhuanlema-v11';
const ASSETS = ['./', './index.html', './today.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    const olds = ks.filter(k => k !== CACHE);
    await Promise.all(olds.map(k => caches.delete(k)));
    await self.clients.claim();
    // 从旧版本升级过来时，主动刷新已打开的页面，用户不必手动清缓存
    if(olds.length){
      const cs = await self.clients.matchAll({ type: 'window' });
      cs.forEach(c => { try { c.navigate(c.url); } catch(err){} });
    }
  })());
});

self.addEventListener('message', e => {
  if(e.data === 'skip-waiting') self.skipWaiting();
});

/* ---------- 班次提醒：接收推送 ---------- */
self.addEventListener('push', e => {
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }
  catch(err){ d = {title: '班次提醒', body: e.data ? e.data.text() : ''}; }
  const title = d.title || '今天赚了吗';
  const opts = {
    body: d.body || '',
    tag: d.tag || 'shift-reminder',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    renotify: true,
    data: {url: d.url || './'}
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(cs => {
      for(const c of cs){
        if('focus' in c){
          try{ c.navigate(target); }catch(err){}
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

const isDoc = req =>
  req.mode === 'navigate' ||
  (req.headers.get('accept') || '').includes('text/html');

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;

  // HTML：网络优先，拿到就更新缓存；失败才用缓存
  if(isDoc(req)){
    e.respondWith(
      fetch(req)
        .then(res => {
          if(res && res.ok){
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }

  // 其他静态资源：缓存优先 + 后台静默更新
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if(res && res.ok && new URL(req.url).origin === location.origin){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
