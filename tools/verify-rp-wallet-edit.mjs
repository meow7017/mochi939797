// ===== 红包双钱包金额设置验证（用户反馈：红包里无法设置我的钱包和联系人钱包的金额）=====
// 覆盖：①红包面板余额行点击 → 弹「我的钱包」输入 → 确定 → 链式弹「TA 的钱包」输入 → 确定 → 双钱包落库+回显
//      ②取消第一个弹窗不链开第二个
//      ③留空确定 = 保持原值
//      ④非法输入（负数）拦截不改值
//      ⑤构建产物静态断言（新逻辑已进 index.html）
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
const cdpPort = 9960 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-rpwallet-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await gotoApp();
await evalJs(`(function(){
  Object.keys(localStorage).filter(function(k){return k.indexOf(':rp-wallet')>0;}).forEach(function(k){localStorage.removeItem(k);});
  window.__errs = [];
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
  var a = document.querySelector('.app[data-app="chat"]');
  if (a) a.click();
  var mr = document.getElementById('more-rp');
  if (mr) mr.click();
  return 'open';
})()`);
await sleep(700);

// ---- T 组：面板与余额行 ----
let s = await evalJs(`(function(){
  var panel = document.getElementById('chat-rp-panel');
  var bal = document.getElementById('rp-balance');
  return { panelOpen: !!(panel && !panel.hidden), text: bal ? bal.textContent : '' };
})()`);
check('T1 红包面板打开、余额行显示双钱包默认额+设置提示', s && s.panelOpen && s.text.indexOf('999999.99') >= 0 && s.text.indexOf('点此设置金额') >= 0, JSON.stringify(s));

// ---- A 组：完整设置链路 ----
s = await evalJs(`(function(){
  document.getElementById('rp-balance').click();
  var mask = document.getElementById('modal-mask');
  var title = document.getElementById('modal-title');
  var input = document.getElementById('modal-input');
  return { visible: !!(mask && !mask.hidden), title: title ? title.textContent : '', val: input ? String(input.value) : '' };
})()`);
await sleep(300);
check('A1 点余额行弹出「我的钱包金额（元）」且预填当前值', s && s.visible && s.title === '我的钱包金额（元）' && s.val === '999999.99', JSON.stringify(s));

s = await evalJs(`(function(){
  var input = document.getElementById('modal-input');
  input.value = '66.66';
  document.getElementById('modal-ok').click();
  return 'step1-ok';
})()`);
await sleep(400); // 二级弹窗延迟 60ms 开启
s = await evalJs(`(function(){
  var mask = document.getElementById('modal-mask');
  var title = document.getElementById('modal-title');
  var input = document.getElementById('modal-input');
  return { visible: !!(mask && !mask.hidden), title: title ? title.textContent : '', val: input ? String(input.value) : '' };
})()`);
check('A2 第一个确定后链式弹出「TA 的钱包金额（元）」且预填', s && s.visible && s.title === 'TA 的钱包金额（元）' && s.val === '999999.99', JSON.stringify(s));

s = await evalJs(`(function(){
  var input = document.getElementById('modal-input');
  input.value = '88.88';
  document.getElementById('modal-ok').click();
  return 'step2-ok';
})()`);
await sleep(400);
s = await evalJs(`(function(){
  var raw = localStorage.getItem('xy-home-v2:default:rp-wallet') || '';
  var bal = document.getElementById('rp-balance');
  var toastEl = document.getElementById('cc-toast');
  return { raw: raw, text: bal ? bal.textContent : '', toast: toastEl ? toastEl.textContent : '' };
})()`);
check('A3 双钱包写入存储（myBalance=6666 分 / systemBalance=8888 分）', s && s.raw.indexOf('"myBalance":6666') >= 0 && s.raw.indexOf('"systemBalance":8888') >= 0, String(s && s.raw));
check('A4 余额行回显新金额且出现更新提示', s && s.text.indexOf('¥66.66') >= 0 && s.text.indexOf('¥88.88') >= 0 && s.toast === '钱包金额已更新', JSON.stringify(s));

// ---- B 组：取消第一个弹窗不链开第二个 ----
s = await evalJs(`(function(){
  document.getElementById('rp-balance').click();
  var mask = document.getElementById('modal-mask');
  var ok = !!(mask && !mask.hidden);
  document.getElementById('modal-cancel').click();
  return { opened: ok, closedNow: !(mask && !mask.hidden) };
})()`);
await sleep(400);
let b = await evalJs(`!!(document.getElementById('modal-mask') && !document.getElementById('modal-mask').hidden)`);
check('B1 取消第一个弹窗后无链式第二弹窗', s && s.opened && s.closedNow && !b, JSON.stringify({ s, secondOpen: b }));

// ---- C 组：留空确定 = 保持原值 ----
s = await evalJs(`(function(){
  document.getElementById('rp-balance').click();
  var input = document.getElementById('modal-input');
  input.value = '';
  document.getElementById('modal-ok').click();
  return 'ok-empty-my';
})()`);
await sleep(400);
s = await evalJs(`(function(){
  var mask = document.getElementById('modal-mask');
  var input = document.getElementById('modal-input');
  var taVisible = !!(mask && !mask.hidden);
  if (!taVisible) return { taVisible: false };
  input.value = '';
  document.getElementById('modal-ok').click();
  return { taVisible: true, done: true };
})()`);
await sleep(400);
let c = await evalJs(`(function(){
  var w = JSON.parse(localStorage.getItem('xy-home-v2:default:rp-wallet'));
  var toastEl = document.getElementById('cc-toast');
  return { my: w.myBalance, sys: w.systemBalance, toast: toastEl ? toastEl.textContent : '' };
})()`);
check('C1 两步都留空确定：钱包数值保持不变并提示未改动', s && s.taVisible && c && c.my === 6666 && c.sys === 8888 && c.toast === '钱包金额未改动', JSON.stringify({ s, c }));

// ---- D 组：非法输入拦截 ----
s = await evalJs(`(function(){
  document.getElementById('rp-balance').click();
  var input = document.getElementById('modal-input');
  input.value = '-5';
  document.getElementById('modal-ok').click();
  return 'ok-neg';
})()`);
await sleep(400);
let d = await evalJs(`(function(){
  var mask = document.getElementById('modal-mask');
  var w = JSON.parse(localStorage.getItem('xy-home-v2:default:rp-wallet'));
  var toastEl = document.getElementById('cc-toast');
  return { secondOpen: !!(mask && !mask.hidden), my: w.myBalance, sys: w.systemBalance, toast: toastEl ? toastEl.textContent : '' };
})()`);
check('D1 负数被拦截：不落库、不链开第二弹窗、提示金额无效', d && !d.secondOpen && d.my === 6666 && d.sys === 8888 && d.toast === '金额无效，未修改', JSON.stringify(d));

// ---- F 组：构建产物静态断言 ----
{
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  check('F1 构建产物含余额行编辑入口（点此设置金额）', html.indexOf('点此设置金额') >= 0, '');
  check('F2 构建产物含钱包编辑函数与点击绑定', html.indexOf("我的钱包金额（元）") >= 0 && html.indexOf("TA 的钱包金额（元）") >= 0 && html.indexOf('rpEditWallet') >= 0, '');
}

const passed = results.filter((r) => r.ok).length;
console.log('\n结果：' + passed + '/' + results.length + ' 项通过');
chrome.kill(); server.close();
process.exit(passed === results.length ? 0 : 1);
