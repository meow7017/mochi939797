// ===== Mochi Service Worker：离线缓存 + 网络优先 =====
// v3.5.54：CACHE 名由 build.mjs 每次构建自动更新（mochi-<时间戳>），
// 新版本部署后旧缓存自动失效 → 强制更新到最新版
// v3.6.x：网络优先 + 超时兜底。GitHub Pages 在国内网络经常慢/卡，原实现
// fetch/addAll 均无超时——SW 卡在 installing 时 Chrome 安卓「安装到桌面」
// 会一直显示「正在安装」永不完成（WebAPK 安装要经 SW 拉 start_url/图标）。
// 现在每个请求最多等 NETWORK_TIMEOUT 毫秒，超时立即回退缓存（没缓存则快速
// 失败），SW 最迟约 10 秒内必然激活，安装/加载都不再无限挂起。
const CACHE = 'mochi-v1';
const BUILD_INFO = '';
const PRECACHE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-180.png'];
// v3.10.x：网络优先超时从 8000 → 3500ms。GitHub Pages 国内访问经常 >8s，
// 原 8s 超时导致手机端 fetch 频繁超时 → 回退 SW 缓存旧 index.html → 用户永远
// 看不到新版。缩短到 3.5s：慢网络下页面秒开（回退缓存），配合页面版本检测 +
// PRECACHE_NOW 预取机制，用户点「刷新使用新版」时能真正拿到最新版。
const NETWORK_TIMEOUT = 3500; // 网络请求等待上限（毫秒）

// 带超时的 fetch：超时按失败处理，走回退逻辑
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('net-timeout')), ms);
    fetch(req).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// v3.28.x：缓存版本号。CACHE 名固定为 mochi-<构建时间戳 base36>（build.mjs 每次
// 构建替换），时间戳单调递增 → base36 数值越大 = 越新的构建。跨旧版回退选缓存时
// 按此排序取最新，杜绝「慢网络回退到任意旧缓存 → 退回旧版布局/白屏」。
function cacheVersion(name) {
  const m = /^mochi-([a-z0-9]+)$/.exec(String(name || ''));
  if (m) {
    const v = parseInt(m[1], 36);
    if (!isNaN(v)) return v;
  }
  return 0;
}

self.addEventListener('install', (e) => {
  // 跳过等待：新 sw 安装后立即接管（配合每次构建新缓存名 → 强制更新）
  self.skipWaiting();
  // 预缓存逐文件超时 + 单文件失败不影响整体：网络再差也保证 SW 能激活，
  // 不阻塞浏览器安装流程
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(PRECACHE.map((url) =>
        fetchWithTimeout(url, NETWORK_TIMEOUT).then((res) => {
          if (res && res.ok) return c.put(url, res);
        })
      ))
    ).catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  // v3.7.x：删旧缓存前先确认当前 CACHE 已缓存 index.html。precache 在慢网络下可能
  // 全部 8s 超时失败（PRECACHE 逐文件 allSettled）→ 新 CACHE 为空，此时若照旧删光
  // 旧缓存，导航回退 caches.match('./index.html') 拿不到 → Response.error() → 白屏。
  // iOS PWA 切回前台弱网时极易触发（Edge/Safari 切回瞬间网络未就绪 + SW 更新竞态）。
  // 当前 CACHE 无 index.html 时，保留一个含 index.html 的旧缓存兜底，等下次更新再清；
  // 旧缓存都没有 index.html 才全删（留着也无用）。
  e.waitUntil(
    caches.keys().then((keys) => {
      const oldKeys = keys.filter((k) => k !== CACHE);
      const cleanup = !oldKeys.length ? Promise.resolve()
        : caches.open(CACHE).then((c) => c.match('./index.html')).then((hit) => {
            if (hit) return Promise.all(oldKeys.map((k) => caches.delete(k)));
            return Promise.all(oldKeys.map((k) =>
              caches.open(k).then((c) => c.match('./index.html')).then((m) => m ? k : null)
            )).then((hits) => {
              // v3.28.x：命中多个旧缓存时保留「最新」一个做兜底（hits.find(Boolean)
              // 按 caches.keys() 顺序取第一个，通常是老缓存 → 用户下次导航回退会退回旧版）。
              // 按 base36 版本降序排，取最新的旧缓存；其余照删。
              const keep = hits.filter(Boolean).sort((a, b) => cacheVersion(b) - cacheVersion(a))[0];
              if (keep) return Promise.all(oldKeys.filter((k) => k !== keep).map((k) => caches.delete(k)));
              return Promise.all(oldKeys.map((k) => caches.delete(k)));
            });
          });
      return cleanup
        .then(() => self.clients.claim())
        .then(() => {
          // v3.27.x：precache 失败时当前 CACHE 可能没 index.html，导航回退会命中旧缓存旧版
          // → 用户"退回旧版白屏"（iOS PWA 切后台回前台 WebKit 重新加载 + 网络超时回退）。
          // claim 后异步补一次 fetch 写入当前 CACHE（不阻塞，失败有旧缓存兜底），
          // 下次导航回退优先命中当前 CACHE（新版），不再退回旧版。
          return caches.open(CACHE).then((c) => c.match('./index.html')).then((hit) => {
            if (hit) return;
            return fetchWithTimeout('./index.html', NETWORK_TIMEOUT).then((res) => {
              if (res && res.ok) return c.put('./index.html', res);
            }).catch(() => {});
          });
        });
    })
  );
});

self.addEventListener('message', (e) => {
  // v3.10.x：页面点击「刷新使用新版」时先发 PRECACHE_NOW，让 SW 立即把最新
  // index.html 写进当前缓存，确认完成后再 reload——否则弱网下 reload 的导航请求
  // 仍可能超时回退旧缓存，用户永远卡在旧版（GitHub Pages 国内访问慢的根因场景）。
  const data = e.data || {};
  if (data.type !== 'PRECACHE_NOW') return;
  const urls = Array.isArray(data.urls) ? data.urls : ['./index.html'];
  caches.open(CACHE).then((c) =>
    Promise.allSettled(urls.map((u) =>
      fetchWithTimeout(u, NETWORK_TIMEOUT).then((res) => {
        if (res && res.ok) { c.put(u, res); return true; }
        return false;
      })
    ))
  ).then(() => {
    // 无论成功与否都回执，页面有超时兜底；网络再差也要让刷新流程能继续
    try { if (e.source && e.source.postMessage) e.source.postMessage({ type: 'PRECACHE_DONE' }); } catch (x) {}
  }).catch(() => {
    try { if (e.source && e.source.postMessage) e.source.postMessage({ type: 'PRECACHE_DONE' }); } catch (x) {}
  });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 跨域请求不接管，交给浏览器原生网络（不缓存、不拦截）
  if (new URL(req.url).origin !== self.location.origin) return;
  // v3.7.x：版本/公告文件一律不拦截、不缓存——SW 网络优先的超时兜底会让慢网络下
  // version.json（带 ?v= 唯一参数、缓存永不命中）8s 超时后 Response.error()，
  // 页面版本检测静默失败 → 用户永远收不到「有新版本」提示、一直停在旧缓存。
  // 这类小文件放行给浏览器原生网络（有浏览器 HTTP 缓存，请求极小、即时返回），
  // 版本检测才真正可靠。notice.json（开屏公告）同理。
  const u = new URL(req.url);
  if (u.pathname.endsWith('/version.json') || u.pathname.endsWith('/notice.json')) return;
  // 网络优先：在线时始终用最新，超时/失败才回退缓存
  e.respondWith(
    fetchWithTimeout(req, NETWORK_TIMEOUT)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => {
        // 仅导航请求回退到 index.html；其他资源（manifest/图标/JS 等）
        // 只回退自身缓存，绝不用 HTML 顶替——否则安装/更新流程会拿到错误内容
        const fallback = req.mode === 'navigate'
          ? caches.open(CACHE).then((c) => c.match('./index.html')).then((m) => m || caches.keys().then((keys) => {
              // v3.7.x：主缓存无 index.html（precache 失败 / activate 保留了旧缓存兜底），
              // 遍历所有缓存找第一个命中的 index.html。原 for 循环首次即 return 只查
              // keys[0]，漏掉其余缓存——改为 reduce 顺序探测，命中即返回，保证导航永不白屏。
              // v3.28.x：reduce 按 caches.keys() 原顺序探测，命中第一个旧缓存（常为最老缓存）
              // → 慢网络下用户被回退到旧版布局（图标缺失/白屏）。现先按 base36 版本降序
              // 排序再探测，优先命中「最新」的旧缓存，尽可能停留在新版。
              return keys.slice().sort((a, b) => cacheVersion(b) - cacheVersion(a)).reduce((p, k) =>
                p.then((found) => found || caches.match('./index.html', { cacheName: k }))
              , Promise.resolve(null));
            }))
          : caches.match(req);
        return fallback.then((m) => {
          // v3.27.x：缓存也没有时不再直接 Response.error()（白屏）——
          // iOS 15 反馈「开屏一直自己刷新然后白屏，完全打不开」：GitHub Pages 国内
          // 慢网络（实测 ~30KB/s）下网络优先 3.5s 必然超时，若预缓存又失败/旧缓存被清，
          // 导航回退命中空缓存 → Response.error() → 白屏，用户刷新后同样超时 → 看似
          // 「一直自己刷新」。兜底改为再发一次不带超时的网络请求（SW 内部 fetch 不会
          // 再次触发本 SW 拦截，无死循环风险）：慢就慢，等 GitHub Pages 慢慢传完，成功
          // 后照常写入缓存，后续刷新走缓存秒开；只有网络真正不可达才由浏览器报错页。
          if (m) return m;
          return fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put('./index.html', copy));
            }
            return res;
          });
        });
      })
  );
});

// v3.5.114：移除「页面通知 → 清缓存 + 强制 reload」机制。
// 旧逻辑会让用户刚进入桌面就被打断刷新回开屏（每次构建 sw.js 内容都变，更新频繁时必现）。
// 现在新 sw 安装即 skipWaiting 接管，activate 自动清理旧缓存，当前页面继续可用，
// 用户下次刷新自然加载最新版；旧页面发来的 UPDATE_READY 消息在此一律忽略。

// ===== v3.15.x：离线消息提醒（Periodic Background Sync，零后端） =====
// 页面端（bg-keep.js psync 段）把可发文案快照写入 IDB 根键 xy-home-v2:psync-snap，
// 并注册 periodicsync。页面全关后浏览器按自身策略定期唤醒本 SW：读快照 → 随机抽
// 一条 → 弹系统通知，同时把该条追加进 xy-home-v2:psync-queue；用户回开应用后由
// 页面端 drainPsyncQueue 安全补投递进聊天（走 chatAddIn 内存链路，绝不直写 chat-msgs）。
// 如实边界（设置页状态行同步展示）：仅 Chromium 系支持且需 PWA 添加到桌面；调度
// 频率由浏览器决定（通常数小时~一天一次，非精确闹钟）；浏览器进程被系统杀死后
// 无法唤醒——那需要真推送服务端，本项目纯本地架构暂不引入。

const PSYNC_SNAP_KEY = 'xy-home-v2:psync-snap';
const PSYNC_QUEUE_KEY = 'xy-home-v2:psync-queue';
const PSYNC_TAG = 'mochi-ta-msg';
const PSYNC_SNAP_TTL = 7 * 24 * 60 * 60 * 1000; // 快照 7 天未刷新（长期没开应用）不再打扰

function psyncOpenDb() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open('mochi-db', 1);
    req.onupgradeneeded = function () { try { req.result.createObjectStore('kv'); } catch (e) {} };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('psync idb open fail')); };
  });
}
function psyncIdbGet(key) {
  return psyncOpenDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('kv', 'readonly');
      var rq = tx.objectStore('kv').get(key);
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
  });
}
function psyncIdbSet(key, val) {
  return psyncOpenDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

self.addEventListener('periodicsync', function (e) {
  if (e.tag !== PSYNC_TAG) return;
  e.waitUntil((async function () {
    const snap = await psyncIdbGet(PSYNC_SNAP_KEY);
    if (!snap || !Array.isArray(snap.texts) || !snap.texts.length) return;
    if (!snap.ts || Date.now() - snap.ts > PSYNC_SNAP_TTL) return;
    const pick = snap.texts[Math.floor(Math.random() * snap.texts.length)];
    const text = pick && pick.t ? String(pick.t) : '';
    if (!text) return;
    let arr = [];
    try { const q = await psyncIdbGet(PSYNC_QUEUE_KEY); if (Array.isArray(q)) arr = q; } catch (e2) {}
    arr.push({ t: text, cid: snap.cid || 'default', ts: Date.now(), k: pick.k || '' });
    while (arr.length > 20) arr.shift();
    await psyncIdbSet(PSYNC_QUEUE_KEY, arr);
    await self.registration.showNotification(snap.name || 'TA', {
      body: text,
      tag: PSYNC_TAG,
      renotify: true,
      icon: './icon-192.png',
      badge: './icon-192.png'
    });
  })().catch(function () {}));
});

// v3.26.x：notificationclick 此前只处理 PSYNC_TAG（离线消息提醒）一条，后台弹窗
// （bgNotifyCheck → showSysNotification → reg.showNotification）发的通知不带 tag，
// 点击直接 return → 既不 focus 也不 openWindow，用户反馈「点后台弹窗没反应」。
// 现统一处理所有通知点击：聚焦已有窗口 / 开新窗口，并 postMessage 通知页面端跳聊天页。
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const tag = (e.notification && e.notification.tag) || '';
  e.waitUntil((async function () {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (cs && cs.length) {
      const c = cs[0];
      try { await c.focus(); } catch (x) {}
      try { c.postMessage({ type: 'MOCHI_NOTIFY_CLICK', tag: tag }); } catch (x) {}
      return;
    }
    try {
      const w = await self.clients.openWindow('./');
      if (w && w.postMessage) {
        // 新开窗口页面脚本可能尚未注册 message 监听，重试几次
        for (let i = 0; i < 3; i++) {
          await new Promise(function (r) { setTimeout(r, 800); });
          try { w.postMessage({ type: 'MOCHI_NOTIFY_CLICK', tag: tag }); } catch (x) { break; }
        }
      }
    } catch (x) {}
  })());
});
