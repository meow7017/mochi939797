// ===== 心意币账本与红包拆分 + 心意币金额可编辑验证 =====
// 用户反馈：红包和心意集市的金额应是分开的；心意集市也要可编辑「我」和「联系人」的金额
// 覆盖：①老数据迁移（原共账本 rp-wallet 余额一次性继承到独立 gift-wallet）
//      ②市集余额行点击编辑双金额（我的/TA）落库 gift-wallet，红包账本 rp-wallet 不受影响
//      ③红包面板改钱包不影响心意币
//      ④聊天送礼面板余额行同样可编辑、非法输入拦截
//      ⑤构建产物静态断言
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9940 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gwallet-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function gotoApp() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1200);
}
async function walletState() {
  return evalJs(`(function(){
    var g = localStorage.getItem('xy-home-v2:default:gift-wallet');
    var r = localStorage.getItem('xy-home-v2:default:rp-wallet');
    return { gift: g ? JSON.parse(g) : null, rp: r ? JSON.parse(r) : null };
  })()`);
}
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// 首次加载：预置老共账本（模拟老用户），清掉独立账本后重载触发继承
await gotoApp();
await evalJs(`(function(){
  Object.keys(localStorage).filter(function(k){return k.indexOf(':gift-wallet')>0 || k.indexOf(':rp-wallet')>0;}).forEach(function(k){localStorage.removeItem(k);});
  localStorage.setItem('xy-home-v2:default:rp-wallet', JSON.stringify({ myBalance: 12345, systemBalance: 67890 }));
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  return 'seeded';
})()`);
await gotoApp();

// ---- M 组：迁移继承 ----
let s = await evalJs(`(function(){
  var a = document.querySelector('.app[data-app="market"]');
  if (!a) return { found: false };
  a.click();
  return { found: true };
})()`);
await sleep(800);
s = await evalJs(`(function(){
  var bal = document.getElementById('market-balance');
  return { found: !!document.querySelector('.app[data-app="market"]'), text: bal ? bal.textContent : '' };
})()`);
check('M1 市集页余额行显示继承的老账本余额+设置提示', s && s.found && String(s.text).indexOf('¥123.45') >= 0 && String(s.text).indexOf('¥678.90') >= 0 && String(s.text).indexOf('点此设置金额') >= 0, JSON.stringify(s));
s = await walletState();
check('M2 独立 gift-wallet 已落盘且与 rp-wallet 数值一致', s && s.gift && s.gift.myBalance === 12345 && s.gift.systemBalance === 67890 && s.rp && s.rp.myBalance === 12345, JSON.stringify(s));

// ---- S 组：市集余额行编辑（我的/TA）----
s = await evalJs(`(function(){
  document.getElementById('market-balance').click();
  var mask = document.getElementById('modal-mask');
  var title = document.getElementById('modal-title');
  var input = document.getElementById('modal-input');
  return { visible: !!(mask && !mask.hidden), title: title ? title.textContent : '', val: input ? String(input.value) : '' };
})()`);
await sleep(300);
check('S1 点市集余额行弹出「我的心意币金额（元）」且预填精确值', s && s.visible && s.title === '我的心意币金额（元）' && s.val === '123.45', JSON.stringify(s));

s = await evalJs(`(function(){
  var input = document.getElementById('modal-input');
  input.value = '100';
  document.getElementById('modal-ok').click();
  return 'ok';
})()`);
await sleep(400);
s = await evalJs(`(function(){
  var mask = document.getElementById('modal-mask');
  var title = document.getElementById('modal-title');
  var input = document.getElementById('modal-input');
  return { visible: !!(mask && !mask.hidden), title: title ? title.textContent : '', val: input ? String(input.value) : '' };
})()`);
check('S2 第一个确定后链式弹「TA 的心意币金额」且预填', s && s.visible && String(s.title).indexOf('的心意币金额（元）') > 0 && s.val === '678.90', JSON.stringify(s));

s = await evalJs(`(function(){
  var input = document.getElementById('modal-input');
  input.value = '200';
  document.getElementById('modal-ok').click();
  return 'ok';
})()`);
await sleep(400);
let w = await walletState();
let t = await evalJs(`(function(){
  var bal = document.getElementById('market-balance');
  var toastEl = document.getElementById('cc-toast');
  return { text: bal ? bal.textContent : '', toast: toastEl ? toastEl.textContent : '' };
})()`);
check('S3 双心意币写入 gift-wallet，rp-wallet 保持不变', w && w.gift && w.gift.myBalance === 10000 && w.gift.systemBalance === 20000 && w.rp && w.rp.myBalance === 12345 && w.rp.systemBalance === 67890, JSON.stringify(w));
check('S4 市集余额行回显新金额+更新提示', t && String(t.text).indexOf('¥100.00') >= 0 && String(t.text).indexOf('¥200.00') >= 0 && t.toast === '心意币金额已更新', JSON.stringify(t));

// ---- N 组：非法输入拦截 ----
s = await evalJs(`(function(){
  document.getElementById('market-balance').click();
  var input = document.getElementById('modal-input');
  input.value = '-3';
  document.getElementById('modal-ok').click();
  return 'ok';
})()`);
await sleep(400);
let n = await evalJs(`(function(){
  var mask = document.getElementById('modal-mask');
  var toastEl = document.getElementById('cc-toast');
  return { secondOpen: !!(mask && !mask.hidden), toast: toastEl ? toastEl.textContent : '' };
})()`);
w = await walletState();
check('N1 负数被拦截：不落库不链开、提示金额无效', n && !n.secondOpen && n.toast === '金额无效，未修改' && w.gift.myBalance === 10000 && w.rp.myBalance === 12345, JSON.stringify({ n, w }));

// ---- R 组：红包钱包独立性 ----
s = await evalJs(`(function(){
  document.getElementById('market-back').click();
  return 'back';
})()`);
await sleep(600);
s = await evalJs(`(function(){
  var a = document.querySelector('.app[data-app="chat"]');
  if (!a) return { found: false };
  a.click();
  var mr = document.getElementById('more-rp');
  if (mr) mr.click();
  return { found: true };
})()`);
await sleep(700);
s = await evalJs(`(function(){
  var bal = document.getElementById('rp-balance');
  return { text: bal ? bal.textContent : '' };
})()`);
check('R1 红包面板余额显示自己账本的值（预置的 123.45/678.90），未被心意币改动影响', s && String(s.text).indexOf('¥123.45') >= 0 && String(s.text).indexOf('¥678.90') >= 0 && String(s.text).indexOf('¥100.00') < 0, JSON.stringify(s));
s = await evalJs(`(function(){
  document.getElementById('rp-balance').click();
  var input = document.getElementById('modal-input');
  input.value = '5';
  document.getElementById('modal-ok').click();
  return 'ok1';
})()`);
await sleep(400);
s = await evalJs(`(function(){
  var input = document.getElementById('modal-input');
  input.value = '6';
  document.getElementById('modal-ok').click();
  return 'ok2';
})()`);
await sleep(400);
w = await walletState();
check('R2 红包钱包写入 rp-wallet，心意币 gift-wallet 不受影响', w && w.rp && w.rp.myBalance === 500 && w.rp.systemBalance === 600 && w.gift && w.gift.myBalance === 10000 && w.gift.systemBalance === 20000, JSON.stringify(w));

// ---- G 组：聊天送礼面板余额行可编辑 ----
s = await evalJs(`(function(){
  var mg = document.getElementById('more-gift');
  if (!mg) return { found: false };
  mg.click();
  var bal = document.getElementById('gift-balance');
  return { found: true, text: bal ? bal.textContent : '' };
})()`);
await sleep(500);
check('G1 送礼面板余额行显示心意币双余额', s && s.found && String(s.text).indexOf('¥100.00') >= 0 && String(s.text).indexOf('¥200.00') >= 0, JSON.stringify(s));
s = await evalJs(`(function(){
  document.getElementById('gift-balance').click();
  var mask = document.getElementById('modal-mask');
  var title = document.getElementById('modal-title');
  var input = document.getElementById('modal-input');
  var visible = !!(mask && !mask.hidden);
  var v = visible ? String(input.value) : '';
  if (visible) document.getElementById('modal-cancel').click();
  return { visible: visible, title: title ? title.textContent : '', val: v };
})()`);
await sleep(400);
check('G2 送礼面板余额行同样弹出编辑框（预填 100.00，取消关闭）', s && s.visible && s.title === '我的心意币金额（元）' && s.val === '100.00', JSON.stringify(s));

// ---- F 组：构建产物静态断言 ----
{
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  check('F1 构建产物使用独立键 gift-wallet 并保留旧键迁移', html.indexOf("WALLET_KEY = 'gift-wallet'") >= 0 && html.indexOf("LEGACY_WALLET_KEY = 'rp-wallet'") >= 0, '');
  check('F2 构建产物含心意币编辑入口与提示文案', html.indexOf('我的心意币金额（元）') >= 0 && html.indexOf('的心意币金额（元）') >= 0, '');
}

const errs = await evalJs('window.__errs || []');
check('Z 全程无 JS 异常', Array.isArray(errs) && !errs.length, JSON.stringify(errs));

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);
