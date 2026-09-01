// verify 批量 runner：一次跑完 tools/verify-*.mjs，逐个报退出码/耗时/末行摘要
// 立项原因（#100 审计）：tools/ 下 180+ 个回归脚本，此前只能一个个手敲，实际没人跑，
// 清单里写的「验证方式」是否仍成立无人知晓。本脚本把它变成一条命令的可见性。
// 用法：
//   node tools/verify-suite.mjs                 跑全部（默认并发 3，超时 180s）
//   node tools/verify-suite.mjs mail chat       只跑文件名含 mail 或 chat 的
//   node tools/verify-suite.mjs --jobs 1 --timeout 300000
//   node tools/verify-suite.mjs --strict        有失败则整体退出码 1（清干净清单后再当门禁用）
//   node tools/verify-suite.mjs --no-core       不带 tools/verify.mjs（布局主检查）
//   node tools/verify-suite.mjs --tail 12       失败项多打几行输出
// 退出码：默认 0（失败只做可见性报告——现存脚本里混有断言已过期、以及需要真机/网络的项，
// 一上来就当门禁会被整体跳过）；--strict 时有失败/超时/启动异常 → 1。
import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const SELF = 'verify-suite.mjs';

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const VALUE_OPTS = ['--jobs', '--timeout', '--tail'];
const filters = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('-')) { if (VALUE_OPTS.includes(a)) i++; continue; }
  filters.push(a);
}
const JOBS = Math.max(1, Number(opt('--jobs', 3)) || 3);
const TIMEOUT = Math.max(1000, Number(opt('--timeout', 180000)) || 180000);
const TAIL = Math.max(1, Number(opt('--tail', 6)) || 6);
const STRICT = has('--strict');

const toolsDir = join(root, 'tools');
let files = readdirSync(toolsDir).filter(f => /^verify-.*\.mjs$/.test(f) && f !== SELF).sort();
if (!has('--no-core') && existsSync(join(toolsDir, 'verify.mjs'))) files = ['verify.mjs'].concat(files);
if (filters.length) files = files.filter(f => filters.some(p => f.includes(p)));
if (!files.length) { console.log('没有匹配的 verify 脚本（过滤器：' + filters.join(', ') + '）'); process.exit(0); }

const runOne = file => new Promise(res => {
  const t0 = Date.now();
  const child = spawn(process.execPath, [join(toolsDir, file)], { cwd: root, windowsHide: true });
  let buf = '';
  let killed = '';
  const timer = setTimeout(() => { killed = 'timeout'; try { child.kill('SIGKILL'); } catch (e) {} }, TIMEOUT);
  child.stdout.on('data', d => { buf += d; if (buf.length > 400000) buf = buf.slice(-200000); });
  child.stderr.on('data', d => { buf += d; if (buf.length > 400000) buf = buf.slice(-200000); });
  child.on('error', e => { clearTimeout(timer); res({ file, code: -1, ms: Date.now() - t0, killed: 'spawn-error: ' + e.message, out: buf }); });
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    res({ file, code: code === null ? -1 : code, signal, ms: Date.now() - t0, killed, out: buf });
  });
});

const linesOf = out => out.replace(/\r/g, '').split('\n').map(s => s.trimEnd()).filter(Boolean);
const lastLine = out => { const l = linesOf(out); return l.length ? l[l.length - 1].slice(0, 90) : ''; };

// 「跑不动」不等于「跑红了」：浏览器起不来 / 需要外网 这类环境缺口单独归类，
// 混进失败里会让整份报告失去可信度（实测本机未装 playwright 浏览器时 14 个脚本一律红）。
const ENV_SIGS = [
  [/browserType\.launch|Executable doesn't exist|playwright install| Please run the following command/i, '浏览器未装（playwright）'],
  [/CHROME_PATH|找不到 (Chrome|Edge)|chrome\.exe.*not found|no running browser/i, '找不到 Chrome/Edge'],
  [/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|Failed to fetch|network.*unreachable|err_internet/i, '需要外网']
];
const envOf = out => { for (const [re, why] of ENV_SIGS) if (re.test(out)) return why; return ''; };

console.log('verify 套件：' + files.length + ' 个脚本，并发 ' + JOBS + '，单脚本超时 ' + (TIMEOUT / 1000) + 's');
console.log('（跑的是仓库根目录产物 index.html，请先 npm run build 再看结果）\n');

const results = [];
let cursor = 0;
const worker = async () => {
  while (cursor < files.length) {
    const file = files[cursor++];
    const r = await runOne(file);
    if (r.code !== 0 && !r.killed) r.env = envOf(r.out);
    results.push(r);
    const tag = r.killed ? '⏱ ' : (r.code === 0 ? '✅ ' : (r.env ? '⚠️ ' : '❌ '));
    console.log(tag + file.padEnd(46) + ' ' + String(r.ms) + 'ms  ' + (r.killed || r.env || ('exit ' + r.code)) + '  ' + lastLine(r.out));
  }
};
await Promise.all(Array.from({ length: Math.min(JOBS, files.length) }, worker));

results.sort((a, b) => a.file.localeCompare(b.file));
const timeouts = results.filter(r => r.killed);
const envBad = results.filter(r => !r.killed && r.env);
const failed = results.filter(r => !r.killed && !r.env && r.code !== 0);
const ok = results.filter(r => r.code === 0 && !r.killed).length;
const hard = failed.concat(timeouts);

if (hard.length) {
  console.log('\n===== 断言失败 / 超时 ' + hard.length + ' 项 =====');
  for (const r of hard) {
    console.log('\n--- ' + r.file + '（' + (r.killed || 'exit ' + r.code + (r.signal ? ' / ' + r.signal : '')) + '，' + r.ms + 'ms）');
    linesOf(r.out).slice(-TAIL).forEach(l => console.log('    ' + l.slice(0, 200)));
  }
}
if (envBad.length) {
  console.log('\n===== 环境不满足 ' + envBad.length + ' 项（不算回归，装好浏览器/接上外网后复跑）=====');
  envBad.forEach(r => console.log('  ⚠️  ' + r.file.padEnd(46) + r.env));
}
const slow = results.filter(r => r.ms > 60000).sort((a, b) => b.ms - a.ms);
if (slow.length) {
  console.log('\n===== 最慢 ' + Math.min(10, slow.length) + ' 项（>60s，值得复核是否卡在等待上）=====');
  slow.slice(0, 10).forEach(r => console.log('  ' + (r.ms / 1000).toFixed(1) + 's  ' + r.file));
}
console.log('\n===== 合计：' + ok + ' 通过 / ' + failed.length + ' 断言失败 / ' + envBad.length + ' 环境不满足 / ' + timeouts.length + ' 超时（共 ' + results.length + '）=====');
if (hard.length) {
  console.log('注意：断言失败 ≠ 一定是回归。现存脚本含「断言已被后续版本改掉」一类，' +
    '请逐项对照 FIX-REGRESSION.md 判定：该修的修，已过期的删或改期望，别整体忽略。' +
    '需要把它当门禁时用 --strict（断言失败或超时即退出码 1；环境不满足不算）。');
}
process.exit(hard.length && STRICT ? 1 : 0);
