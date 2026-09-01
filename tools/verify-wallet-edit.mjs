// ===== 专项：红包 / 心意市集 余额行修改「我的 / TA」金额（单层弹窗重构） =====
// 用法：node tools/verify-wallet-edit.mjs
// 背景（用户反馈：红包和心意集市里无法修改联系人的金额）：
//   旧版点余额行后「我的→TA」两步连续 openModal（60ms 间隔）——真机上第二层
//   常因键盘收起/再聚焦竞态无法输入（=改不了联系人的金额），第一步输入非法
//   还会静默跳过第二步。重构为单层弹窗：胶囊选侧 + 一个输入框（留空不改）。
// 验证（自组装临时站点跑真实 UI，同 verify-mail-cfg-per-cid 先例；不触发 build）：
//   静态断言接线 + 运行时走 点余额行→(选胶囊)→输入→确定 全链路，覆盖
//   默认侧/TA 侧/留空保护/非法输入/回显，红包与心意币两个入口都测。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : ''));
}

// ---- A 组：源码静态断言 ----
{
  const chat = readFileSync(join(root, 'src', 'js', 'chat.js'), 'utf8');
  const gift = readFileSync(join(root, 'src', 'js', 'gift-shop.js'), 'utf8');
  const m1 = chat.match(/function rpEditWallet\(\)[\s\S]*?\n  \}/);
  const m2 = gift.match(/function giftEditWallet\(\)[\s\S]*?\n  \}/);
  const b1 = m1 ? m1[0] : '', b2 = m2 ? m2[0] : '';
  check('A1 rpEditWallet 单层弹窗：pills 选侧（my/ta）+ 无嵌套二级弹窗',
    /pills:\s*\[\{\s*value:\s*'my'/.test(b1) && !/setTimeout\(\(\) => \{\s*window\.openModal/.test(b1));
  check('A2 giftEditWallet 同款重构：无嵌套二级弹窗',
    /pills:\s*\[\{\s*value:\s*'my'/.test(b2) && !/setTimeout\(function \(\) \{\s*window\.openModal/.test(b2));
  check('A3 两处带余额 staticText 提示 + 数字键盘 inputmode/placeholder',
    /留空确定 = 不改动/.test(b1) && /inputmode:\s*'decimal'/.test(b1) && /placeholder:\s*'/.test(b1) &&
    /留空确定 = 不改动/.test(b2) && /inputmode:\s*'decimal'/.test(b2) && /placeholder:\s*'/.test(b2));
}

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }

const tmpSite = mkdtempSync(join(tmpdir(), 'mochi-wallet-'));
const html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let outHtml = '';
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  const cm = bm.match(/cssFiles\s*=\s*\[([\s\S]*?)\]/);
  const jm = bm.match(/jsFiles\s*=\s*\[([\s\S]*?)\]/);
  const parseArr = (m) => (m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : []);
  const cssFiles = parseArr(cm), jsFiles = parseArr(jm);
  if (!cssFiles.length || !jsFiles.length) { console.error('无法从 build.mjs 解析文件清单'); process.exit(1); }
  const cssAll = cssFiles.map(f => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
  const jsAll = jsFiles.map((f) => {
    try { return readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) { return ''; }
  }).join('\n');
  if (!/修改钱包金额（元）/.test(jsAll) || !/修改心意币（元）/.test(jsAll)) { console.error('JS 拼接缺少新版钱包弹窗'); process.exit(1); }
  outHtml = html.replace('/*__STYLES__*/', () => cssAll).replace('/*__SCRIPTS__*/', () => jsAll);
}
writeFileSync(join(tmpSite, 'index.html'), outHtml);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(tmpSite, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(tmpSite)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[ext(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
function ext(p) { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i); }
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-wallet-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) {
      console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function loadApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
  await sleep(2300);
  await evalJs("(function(){var m=document.getElementById('cc-scope-mask');if(m&&!m.hidden){var b=document.getElementById('csn-ok');if(b)b.click();}return true;})()");
  await sleep(400);
}

// 种子余额（default 桌面），重启一次让各模块渲染读到种子值
await loadApp();
await evalJs(`(function(){
  try{
    localStorage.setItem('xy-home-v2:default:rp-wallet',JSON.stringify({myBalance:8800,systemBalance:9900}));
    localStorage.setItem('xy-home-v2:default:gift-wallet',JSON.stringify({myBalance:1234,systemBalance:5678}));
  }catch(e){}
  return true;
})()`);
await loadApp();

const walletOf = async (key) => JSON.parse(await evalJs(`(function(){try{return localStorage.getItem('xy-home-v2:default:${key}')||'{}';}catch(e){return '{}';}})()`));

// 弹窗辅助：打开→快照；pill(n) 点第 n 个胶囊；type(s) 输入；ok 确定
async function openBy(id) {
  await evalJs(`(function(){var b=document.getElementById('${id}');if(b)b.click();return true;})()`);
  await sleep(350);
  return evalJs(`(function(){
    var mask=document.getElementById('modal-mask'),t=document.getElementById('modal-title'),
        st=document.getElementById('modal-static'),inp=document.getElementById('modal-input');
    var pills=[].map.call(document.querySelectorAll('#modal-pills .pill'),function(p){return p.textContent;});
    return JSON.stringify({hidden:!!(mask&&mask.hidden),title:t?t.textContent:'',st:st&&!st.hidden?(st.textContent||''):'',val:(inp&&inp.value)||'',pills:pills});
  })()`);
}
async function pill(n) {
  return evalJs(`(function(){var p=document.querySelectorAll('#modal-pills .pill')[${n}];if(p)p.click();return true;})()`);
}
async function typeIn(s) {
  return evalJs(`(function(){var i=document.getElementById('modal-input');i.value='';i.value=${JSON.stringify(s)};return true;})()`);
}
async function ok() {
  await evalJs("(function(){var b=document.getElementById('modal-ok');if(b)b.click();return true;})()");
  await sleep(250);
}

console.log('== 红包钱包 ==');
let s1 = JSON.parse(await openBy('rp-balance'));
check('B1 点余额行出单层弹窗：标题/双胶囊/空输入/余额提示',
  s1.title === '修改钱包金额（元）' && s1.pills.length === 2 && s1.val === '' && /¥88\.00/.test(s1.st) && /¥99\.00/.test(s1.st), s1);

async function modalOpen() {
  return JSON.parse(await evalJs(`(function(){
    var mask=document.getElementById('modal-mask'),ok=document.getElementById('modal-ok'),
        on=document.querySelector('#modal-pills .pill.on'),inp=document.getElementById('modal-input');
    return JSON.stringify({open:!!(mask&&!mask.hidden),okTxt:ok?ok.textContent:'',onPill:on?on.textContent:'',val:(inp&&inp.value)||''});
  })()`));
}

await pill(1); // 选「TA」
await typeIn('12.34');
await ok();
let w = await walletOf('rp-wallet');
s1 = await modalOpen();
check('B2 选 TA + 12.34 → 只改 TA 余额；弹窗保持打开并翻转到「我的」侧',
  w.systemBalance === 1234 && w.myBalance === 8800 && s1.open === true && s1.onPill === '我的' && s1.okTxt === '完成', { w, m: s1 });

await typeIn('55.55'); // 续填另一侧：当前胶囊=我的
await ok();
w = await walletOf('rp-wallet');
s1 = await modalOpen();
check('B3 同弹窗续填我的 55.55 → 我的余额更新且仍不关窗',
  w.myBalance === 5555 && w.systemBalance === 1234 && s1.open === true, { w, m: s1 });

await ok(); // 留空点【完成】→ 关闭
s1 = await modalOpen();
check('B4 留空点【完成】→ 弹窗关闭（连续编辑结束）', s1.open === false);

const echo = await evalJs("(function(){return (document.getElementById('rp-balance')||{}).textContent||'';})()");
check('B5 余额行回显新值', /55\.55/.test(echo) && /12\.34/.test(echo), echo);

s1 = JSON.parse(await openBy('rp-balance'));
await pill(1); // 选 TA 但留空
await ok();
w = await walletOf('rp-wallet');
check('B6 选侧但留空确定 → 双侧都不变且关闭（留空=不改）',
  w.myBalance === 5555 && w.systemBalance === 1234 && (await modalOpen()).open === false, w);

s1 = JSON.parse(await openBy('rp-balance'));
await typeIn('abc');
await ok();
w = await walletOf('rp-wallet');
const toastTxt = await evalJs("(function(){var t=document.getElementById('cc-toast');return t?t.textContent:'';})()");
check('B7 非法输入 → 提示且双侧不变、正常关闭', w.myBalance === 5555 && w.systemBalance === 1234 && /金额无效/.test(toastTxt) && (await modalOpen()).open === false, { w, toastTxt });

console.log('== 心意市集 ==');
s1 = JSON.parse(await openBy('gift-balance'));
check('C1 点送礼面板余额行出弹窗：标题/胶囊/余额提示', s1.title === '修改心意币（元）' && s1.pills.length === 2 && /¥12\.34/.test(s1.st) && /¥56\.78/.test(s1.st), s1);
await pill(1);
await typeIn('7.89');
await ok();
w = await walletOf('gift-wallet');
s1 = await modalOpen();
check('C2 选 TA + 7.89 → 只改 TA 心意币，弹窗保持打开', w.systemBalance === 789 && w.myBalance === 1234 && s1.open === true, { w });
await evalJs("(function(){var b=document.getElementById('modal-cancel');if(b)b.click();return true;})()");
await sleep(200);
check('C3 取消随时可退出连续编辑', (await modalOpen()).open === false);

s1 = JSON.parse(await openBy('market-balance'));
await typeIn('3.50');
await ok();
w = await walletOf('gift-wallet');
await evalJs("(function(){var b=document.getElementById('modal-cancel');if(b)b.click();return true;})()");
check('C4 市集页余额行走同一弹窗：默认侧改我的心意币（12.34→3.50）', w.myBalance === 350 && w.systemBalance === 789, w);

const pass = results.filter(r => r.ok).length;
console.log('\n结果：' + pass + '/' + results.length + ' 项通过');
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
process.exit(pass === results.length ? 0 : 1);
