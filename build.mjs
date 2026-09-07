// ===== 组装脚本 =====
// 把 src/ 下的模板 + 按页面拆分的 CSS + 按功能拆分的 JS
// 拼装成单个可直接双击打开的 index.html（完整功能）。
// 用法：在 mochi 目录下运行  node build.mjs
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

// ===== 构建前健康检查（v3.6.x） =====
// 防止把「未完成的改动 / 调试脚本」混进产物——历史教训：构建者跑 build 时工作区里
// 有对方进行中的改动，产物悄悄带上半成品；tools/tmp-*.mjs / smoke-*.mjs 调试脚本
// 也险些被 add -A 提交。检出时醒目警告（不阻止构建，构建者自行判断；
// AGENTS.md 约定构建前 git status 核对）。
try {
  const out = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '';
  const lines = out.split('\n').filter(Boolean);
  // 所有未跟踪的 .mjs 调试脚本（tmp-*/smoke-*/verify-* 等临时工具）
  const tmpUntracked = lines.filter(l => l.startsWith('??') && /[\w.-]*\.mjs/.test(l));
  const modified = lines.filter(l => !l.startsWith('??'));
  if (tmpUntracked.length) {
    console.warn('⚠️  检测到未跟踪调试脚本（.mjs，可能是临时工具）：\n  ' + tmpUntracked.join('\n  ') + '\n  请确认这些不要随产物提交（建议加进 .gitignore 或删除）。');
  }
  if (modified.length) {
    console.warn('⚠️  工作区有未提交改动 ' + modified.length + ' 个文件：\n  ' + modified.map(l => '  ' + l.slice(0, 90)).join('\n') + '\n  构建产物会包含这些改动——请确认对方已保存完整（AGENTS.md：不夹带未完成的一半改动）。');
  }
} catch (e) { /* 非 git 环境 / git 不可用：跳过检查 */ }

// ===== 构建信息（开屏显示 + sw 缓存版本号，v3.5.54） =====
const buildTime = new Date();
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const buildInfo = '部署于 ' + buildTime.getFullYear() + '-' + pad(buildTime.getMonth() + 1) + '-' + pad(buildTime.getDate()) +
  ' ' + pad(buildTime.getHours()) + ':' + pad(buildTime.getMinutes());
const buildStamp = buildTime.getTime().toString(36); // sw 缓存名版本号（每次构建必变）
// 应用版本号（设置页底部与开屏共用）
// v3.26.x：自动从 git 提交数生成（v3.26.<提交数>）——此前手动维护 APP_VERSION，
// 与提交 message 里的版本号经常不同步（混用 v3.5.x/v3.6.x）。现在每次提交后构建，
// 版本号自动 +1、永不需要人工对齐；提交 message 前缀保持 v3.26.x 系列即可。
// ⚠️ 版本系列升级时（如 v3.26 → v3.27）把下面的前缀一起改掉，与提交 message 对齐。
// 非 git 环境（脚本被拷贝/CI 无 git）回退 v3.26.0 兜底。
let APP_VERSION = 'v3.26.0';
try {
  const cnt = execSync('git rev-list --count HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (cnt && /^\d+$/.test(cnt)) APP_VERSION = 'v3.26.' + cnt;
} catch (e) { /* 无 git：保持兜底 */ }

// 按顺序拼接样式 / 脚本（顺序即生效顺序）
  const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css'];
  const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'personalize.js', 'chat.js', 'group-chat.js', 'chatcard.js', 'chat-settings.js', 'reply-settings.js', 'fav-settings.js', 'default-cards-data.js', 'default-cards.js', 'mood-followup-data.js', 'mood-reply-cards.js', 'ta-mood-data.js', 'ta-mood.js', 'music-player.js', 'calendar.js', 'divination.js', 'avatar-lib.js', 'ta-ask.js', 'bg-keep.js', 'records.js', 'call.js', 'mail.js', 'feed.js', 'p2-features.js', 'decision.js', 'group-decision.js', 'sfx.js', 'fullscreen.js', 'data-backup.js', 'pwa.js', 'mobile-adapt.js'];

// ===== 零依赖保守压缩 =====
// 只删注释/空行/缩进，不改任何代码语义（无依赖、无解析器）。
// 已核查全项目：无模板字符串插值（${}）、无 eval、无跨行反引号/字符串续行——
// 逐行处理 JS 安全；CSS 块注释可跨行、字符串内不含 /* ，整文件非贪婪匹配安全。
// 超长单行（如 default-cards-data.js 6.5 万字符的数据 JSON 行）整行保留不动。
const MINIFY_KEEP_LINE = 8000;
function minifyJs(code) {
  const lines = code.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.length > MINIFY_KEEP_LINE) { out.push(raw); continue; } // 数据行原样保留
    const t = raw.trim();
    if (!t) continue;                   // 空行
    if (t.startsWith('//')) continue;   // 整行 // 注释（行内尾注释不动，字符串/URL 里可能有 //）
    out.push(t);                        // 去行首缩进 + 行尾空白
  }
  return out.join('\n');
}
function minifyCss(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\/\s*/g, '') // 块注释（含跨行）
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

let html = read('template.html');
const styles = cssFiles.map(f => minifyCss(read(join('css', f)))).join('\n');
// 每个 JS 文件独立 try/catch 包裹：单文件运行时报错不再连坐后续所有功能
// （如某个文件在特定设备抛错，之前会导致之后文件的绑定全部失效）
const jsWrapped = jsFiles.map(f => {
  const code = minifyJs(read(join('js', f)));
  return '(function () { try {\n' + code + '\n} catch (__e) { try { console.error("[JS] ' + f + '", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();';
});
// v3.27.x：拆 script 块（修复 iOS 15 开屏无限刷新白屏）——
// 产物单块内联脚本曾达 2.85MB，iOS 15 的 WebKit(615)/JavaScriptCore 对超大单块
// script 解析会触发内存限制 → WebContent 进程崩溃 → Safari 显示「此页面出现问题」
// 并自动重新加载 → 每加载必崩 → 无限刷新循环 → 白屏打不开（iOS 上所有浏览器都是
// WebKit 内核，故「所有浏览器」现象一致）。拆成多块后每块远小于引擎单块解析上限，
// 块间保持 jsFiles 顺序（依赖前置不变），全局 window 共享不受影响。
// v3.26.x #91：按 UTF-8 字节数而非字符数计量——原用 s.length（UTF-16 码单元数），
// 中文注释 1 字符 .length=1 但 UTF-8 占 3 字节；产物写盘/WebKit 解析均按字节，导致
// 「字符数 600K」的块实际字节数达 1.4MB+，仍触发 WebKit 单块解析崩溃 → iOS 15/18
// Safari 无限自动刷新白屏（用户诊断：DOM 就绪 36s、SW 不支持、刷新打不开）。改用
// Buffer.byteLength 后每块真实字节数 ≤ 上限，iOS WebKit 不再崩溃。
const SCRIPT_CHUNK_LIMIT = 500 * 1024; // 每块 UTF-8 字节数上限（500KB，留余量低于 iOS 15 单块安全阈值）
function chunkScripts(items) {
  const chunks = [];
  let cur = [];
  let size = 0;
  const byteLen = (s) => Buffer.byteLength(s, 'utf8');
  items.forEach(function (s) {
    const sl = byteLen(s);
    if (size + sl > SCRIPT_CHUNK_LIMIT && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push(s); size += sl;
  });
  if (cur.length) chunks.push(cur);
  return chunks;
}
const scriptChunks = chunkScripts(jsWrapped);

// v3.15.x：改用函数返回值注入——字符串替换会把包内 $&/$'/$` 当特殊模式处理，
// 源码里出现这些序列（正则/模板片段）时产物被静默撑爆+残留占位符（2026-08-26 实测踩坑）
html = html.replace('/*__STYLES__*/', () => styles);
// v3.27.x：多块注入——第一块沿用模板内既有 <script>，后续块用 </script><script> 分隔，
// 每个功能文件仍是独立 IIFE+try/catch，块间顺序执行语义不变
html = html.replace('/*__SCRIPTS__*/', () =>
  scriptChunks.map((c, i) => (i === 0 ? c.join('\n') : '</script>\n<script>' + c.join('\n'))).join('\n')
);
// 注入部署时间（开屏显示）
html = html.replace('__BUILD_INFO__', buildInfo);
// 注入当前构建时间戳（页面自身版本基线，v3.7.x）——
// pwa.js 版本检测用它当基线，不再依赖「首次 fetch 的 version.json 时间戳」：
// 旧缓存页面 + 网络拿到最新 version.json 时，旧逻辑把最新时间戳当基线 → 永不提示
// 更新；注入页面自身的部署时间戳后，任何比它新的 version.json 都会触发更新提示
html = html.split('__BUILD_TS__').join(String(buildTime.getTime()));
// 版本号两处（开屏 + 设置页底部）都要替换：replace 用字符串只替换第一处，改用 split/join 全局替换
html = html.split('__APP_VERSION__').join(APP_VERSION);

const out = join(root, 'index.html');
writeFileSync(out, html);
console.log('已生成 index.html（' + html.length + ' 字节，' + (html.split('\n').length) + ' 行）');

// v3.6.x：生成版本文件 version.json（部署到站点根目录）——
// 手机端靠它检测新版本（fetch 对比时间戳），不依赖 Service Worker 更新机制
//（sw 只在页面加载/导航时检查、iOS Safari 检测不可靠，开着旧页面永远收不到提醒）。
const versionJson = JSON.stringify({ ts: buildTime.getTime(), info: buildInfo });
writeFileSync(join(root, 'version.json'), versionJson);
console.log('已生成 version.json（' + versionJson + '）');

// ===== 复制 PWA 文件到根目录（随 GitHub Pages 部署） =====
// sw.js 缓存名改为每次构建的 buildStamp → 新版本部署后老缓存自动失效，强制更新
const pwaFiles = ['manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon-180.png', 'icon-maskable-512.png', 'notice.json'];
pwaFiles.forEach(f => copyFileSync(join(root, 'src', 'pwa', f), join(root, f)));
const swPath = join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace(/const CACHE = 'mochi-[^']*';/, "const CACHE = 'mochi-" + buildStamp + "';");
sw = sw.replace(/const BUILD_INFO = '[^']*';/, "const BUILD_INFO = '" + buildInfo + "';");
if (!sw.includes('const BUILD_INFO')) {
  sw = sw.replace("const CACHE = 'mochi-" + buildStamp + "';", "const CACHE = 'mochi-" + buildStamp + "';\nconst BUILD_INFO = '" + buildInfo + "';");
}
writeFileSync(swPath, sw);
console.log('已复制 PWA 文件 → ' + pwaFiles.join(', ') + '（sw 缓存版本: mochi-' + buildStamp + '）');

// ===== 关键修复哨兵（v3.16.x） =====
// 历史教训：修复被并行会话覆盖 / 编辑器旧缓冲回写 / 新文件漏接入 build.mjs，
// 都会让「已修复的问题在新版本复发」，且构建/布局检查照常通过、无人发现。
// 构建完成后对产物做特征检查——每个曾用户反馈过的关键修复对应一个代码特征
// （函数名/常量/选择器）。特征缺失 = 修复可能被覆盖 → 醒目警告（不阻断构建，
// 构建者自行判断；有对应 verify-xxx.mjs 的可补跑确认）。
// 删除型修复（移除某功能/入口）：加 { absent: true }，表示 needle 出现在产物中才报警
// （防止并行会话/旧缓冲把已移除的代码改回来）。
// 维护：新增关键修复时在此登记一行 { name, file, needle }（needle 为产物中的特征串）。
const FIX_SENTINELS = [
  { name: 'iOS 15 拆 script 块（产物多块，防单块超 600KB 触发 WebKit 解析崩溃/白屏）', file: 'index.html', needle: '</script>\n<script>' },
  { name: '颜文字缺字形字符已替换（ᴥ absent，fix-kaomoji-chars 第二批）', file: 'index.html', needle: 'ᴥ', absent: true },
  { name: 'iOS 键盘输入栏停靠（_ensureInputDocked）', file: 'js/mobile-adapt.js', needle: '_ensureInputDocked' },
  { name: 'iOS 保活音频静音（kaIsIOS/0.002）', file: 'js/bg-keep.js', needle: 'kaIsIOS' },
  { name: '批量导入按行拆分（\\r\\n|\\r|\\n）', file: 'js/chatcard.js', needle: 'split(/\\r\\n|\\r|\\n/)' },
  { name: 'GIF 动图直存（跳过压缩）', file: 'js/chatcard.js', needle: 'isGif' },
  { name: '新文件接入产物（漂流瓶）', file: 'index.html', needle: 'drift-bottle' },
  { name: '新文件接入产物（TA的心情）', file: 'index.html', needle: 'ta-mood' },
  { name: '多联系人切换渲染修复（applyAvatars）', file: 'js/contacts.js', needle: 'applyAvatars' },
  { name: '信箱数据丢失防护（mailDbReady）', file: 'js/mail.js', needle: 'mailDbReady' },
  { name: '大图崩溃防护（>8MB 拦截）', file: 'js/personalize.js', needle: '8 * 1024 * 1024' },
  { name: '情绪字卡总开关（triggerEmotionChain 总闸）', file: 'js/mood-reply-cards.js', needle: 'if (!enabled(\'mood\')) return null' },
  { name: '通知图标降级（noMedia）', file: 'js/bg-keep.js', needle: 'noMedia' },
  { name: '引用快照防 base64 霸屏（quoteTextOf/quoteSnapOf）', file: 'js/chat.js', needle: 'function quoteTextOf' },
  { name: '设备判定手动布局兜底（__layout-pref）', file: 'js/device.js', needle: 'pref:mobile' },
  { name: '全屏横屏判定改判物理方向（viewportLandscape）', file: 'js/fullscreen.js', needle: 'function viewportLandscape' },
  { name: '收藏判重按归属（TA收藏不挡我的收藏）', file: 'js/chat.js', needle: "(f.by || 'me') !== 'ta'" },
  { name: '收藏启动回填只补不覆盖（防旧IDB快照回滚）', file: 'js/chat.js', needle: "cur.length <= 2) store.set('fav-msgs'" },
  { name: '语音播放钮互动态·双图标（playing 三角换暂停竖条）', file: 'js/chat.js', needle: 'voice-ico-pause' },
  { name: '语音播放钮互动态·按压反馈（:active 微缩）', file: 'css/chat-main.css', needle: '.msg-voice-play:active' },
  { name: '单聊联系人消息音效（addIn 播 sfx-in，read/silent 除外）', file: 'js/chat.js', needle: "opts.special !== 'read'" },
  { name: '音效等待 AudioContext resume 后再 start（Via/WebView）', file: 'js/sfx.js', needle: 'p.then(start)' },
  { name: '群聊引用防 base64 霸屏（gcQuoteTextSafe）', file: 'js/group-chat.js', needle: 'gcQuoteTextSafe' },
  { name: '聊天大数据分批/延迟归一化（防 OOM 崩溃）', file: 'js/chat.js', needle: 'scheduleDeferredNormalization' },
  { name: '消息长按打开操作菜单（openMsgActionsAt 长按+轻点）', file: 'js/chat.js', needle: 'openMsgActionsAt' },
  { name: '群聊消息长按打开引用菜单（gcOpenMsgActions 长按+轻点）', file: 'js/group-chat.js', needle: 'gcOpenMsgActions' },
  { name: '错误记录双写 IndexedDB（readErrs 回退读取，防"最近错误：无"丢线索）', file: 'js/device.js', needle: 'idbSet(ERR_KEY' },
  { name: '更新条防重复（ver-update-ack-ts 按版本免打扰 + showVerBar 跨通道收口）', file: 'js/pwa.js', needle: 'ver-update-ack-ts' },
  { name: '公用拍一拍选中态去虚线统一（poke-tab-pub.sel 实心）', file: 'css/dark.css', needle: 'poke-tab-pub.sel { background:var(--ink)' },
  { name: '导出聊天记录以 IDB 权威为准（lsBig 兜底，防取旧快照）', file: 'js/data-backup.js', needle: '留待 IndexedDB 权威读取' },
  { name: '恢复默认桌面预选中确认（ctl.pills 预选「确定恢复默认」，只点确定也生效）', file: 'js/personalize.js', needle: "ctl.pills([{ label: '确定恢复默认', value: '1' }], '1')" },
  { name: '内置壁纸预设可见性（bgPresetCss + applyBgVisibility 认预设）', file: 'js/personalize.js', needle: 'bgPresetCss' },
  { name: '应用美化方案预选中确认（桌面+聊天 ctl.pills 预选「应用」，只点确定也生效）', file: 'js/personalize.js', needle: "ctl.pills([{ label: '应用', value: 'ok' }], 'ok')" },
  { name: '冷启动回复池取回自定义字卡（replyScopeGroups 重载 + 就绪判定不再被默认字卡遮蔽）', file: 'js/chatcard.js', needle: 'function replyScopeGroups' },
  { name: '导出进度遮罩 + 确认后再下载（impShow 复用 + anchorDownload 只在用户点确定后触发）', file: 'js/data-backup.js', needle: 'anchorDownload' },
  { name: '诊断复制改原生 execCommand + 按钮补 type=button（修点【复制】无反馈/整页刷新）', file: 'js/device.js', needle: 'document.execCommand(\'copy\')' },
  { name: '弹窗底部按钮补 type=button（取消默认 submit 整页刷新）', file: 'index.html', needle: 'type="button" class="modal-btn copy" id="modal-export"' },
  { name: '编辑消息同步重建 parts（防发送新消息后重渲染回退成原文）', file: 'js/chat.js', needle: '.filter(p => p && p.k !== \'text\')' },
  { name: 'idbSet 写入挂起 4s 超时+重建重试（荣耀/Edge 事务挂起静默丢写）', file: 'js/idb.js', needle: '连接疑似挂起' },
  { name: 'idbHydrateKey 慢读取回 6s+8s（慢但可用 IDB 低端机自定义字卡取不回落兜底）', file: 'js/idb.js', needle: 'window.idbHydrateKey = function' },
  { name: '小键写日志 __wr-journal（杀进程回滚 LS 后设置开关回退的恢复链）', file: 'js/idb.js', needle: '__wr-journal' },
  { name: '语音开关去掉静默早退守卫 + mochi-wrj-heal 重同步（首点无反应）', file: 'js/chat-settings.js', needle: "document.addEventListener('mochi-wrj-heal', syncVs);" },
  { name: 'dc-* 开关监听 mochi-wrj-heal 重同步（退出重进设置回退自愈）', file: 'js/default-cards.js', needle: "document.addEventListener('mochi-wrj-heal', function () {\ntry {" },
  { name: '诊断「开关持久化体检」（LS/读取/IDB 三层值 + LS 写探针）', file: 'js/device.js', needle: '开关持久化体检' },
  { name: '自动备份副本已下线：启动时自动清理遗留副本释放空间（purgeLegacySnapshot）', file: 'js/data-backup.js', needle: 'purgeLegacySnapshot' },
  { name: '后台听歌不误报「会员/移出」弹窗（offerRemoveDamagedSong 后台直返不计数 + 回前台 bgResumeFails 清零）', file: 'js/music-player.js', needle: '后台冻结/断流误触发 onerror，不弹「移出」窗不计数' },
  { name: '聊天昵称与桌面解耦（chatLabel dk=null 只读 cs-lbl-*，不回退桌面键）', file: 'js/chat.js', needle: "chatLabel('cs-lbl-partner', null, 'TA')" },
  { name: '聊天设置昵称行不再显示跟随桌面（未设置显示默认占位）', file: 'js/chat-settings.js', needle: "未设置（默认 TA）" },
  { name: '通话昵称与聊天域解耦（cs-lbl-partner 优先，不读桌面键）', file: 'js/call.js', needle: "store.get('cs-lbl-partner') || (window.taWord ? window.taWord() : 'TA')" },
  { name: 'migrateLegacy def/root 提升函数顶部（修启动 ReferenceError 中断迁移）', file: 'js/contacts.js', needle: 'const root = window.xyStore(G);' },
  { name: 'iOS Edge 视口事件盲区兜底（window resize/工具条显隐 + 1s 轮询并进自愈，修输入栏下空一大块/页面上移残留）', file: 'js/mobile-adapt.js', needle: "addEventListener('orientationchange', onIosVvEvent)" },
  { name: '位置面板返回按钮半屏也显示（.loc-back 默认 flex，修聊天寻踪半框入口无返回按钮无法关闭）', file: 'css/chat-pages.css', needle: '.loc-back {\ndisplay:flex;' },
  { name: '桌面「已摸鱼」卡与「今日情话」卡文字水平对齐（.mini-card fish .mc-b 与情话等高，修两卡标题/正文错位）', file: 'css/home.css', needle: '.mini-card[data-card-bg="fish"] .mc-b' },
  { name: '单聊持久化改空闲调度（schedulePersist，修发消息/来消息/切页 2~3s 长任务卡顿）', file: 'js/chat.js', needle: 'function schedulePersist' },
  { name: '群聊持久化改空闲调度（gSchedulePersist，同上修大群聊全量同步写卡顿）', file: 'js/group-chat.js', needle: 'function gSchedulePersist' },
  { name: '桌面长按误触入口已移除（仅「编辑布局」主动进移动模式，修图标被误拖乱/要求固定一行4个）', file: 'js/personalize.js', needle: 'pressTimer = setTimeout(() => {\npressTimer = null;\nenterMoveMode();\nstartDeskDrag(e, t);', absent: true },
  { name: '移动模式横滑翻页判定已移除（图标横向拖动直接拖拽，修华为只能竖着换排）', file: 'js/personalize.js', needle: 'Math.abs(dx) > Math.abs(dy) * 1.5', absent: true },
  { name: '恢复默认桌面等 IDB 删除落盘再 reload（防华为/慢 IDB 回填旧布局，修「恢复默认没生效」）', file: 'js/personalize.js', needle: "idbDelete(P + ':desk-layout')" },
  { name: '弹窗文件导入自动应用（_modalOpts 修 opts 作用域 ReferenceError，修「导入美化方案选完文件没反应」）', file: 'js/personalize.js', needle: '_modalOpts' },
  { name: '弹窗嵌套守卫（_openSeq：fire 内开新弹窗则外层 close 跳过，修「导出美化方案」选完来源看不到导出方式）', file: 'js/personalize.js', needle: '_openSeq' },
  { name: '美化导出/导入只保留文件方式（「复制文字」整体移除，防剪贴板截断/粘贴导入不可行）', file: 'js/personalize.js', needle: 'function showBeautyFallback', absent: true },
  { name: '经期温柔动作后缀六条全部进字卡库（WARM_SUFFIX 同源，dc-off-period 逐张开关；防只写 1 条回归）', file: 'js/default-cards-data.js', needle: '（把你往怀里带了带）' },
  { name: '导出 IDB-only 大键重试兜底（IDB 读取失败重试一次 + LS 终极兜底，修>200KB 信箱数据导出丢失）', file: 'js/data-backup.js', needle: 'const lsV = localStorage.getItem(k)' },
  { name: '导出确认弹窗显示功能覆盖清单 + 体积自动换算 MB（fmtSize/exportCoverage，修导出看不到导了哪些功能/只有 KB）', file: 'js/data-backup.js', needle: '导出内容（全局全部数据）' },
  { name: 'idbSet 写入失败计数成功即清零 + 大包写入超时按体积放大（修旧数据多「存储异常」弹窗每会话必现：偶发失败污染全会话计数+合法大包写入被 4s 误判）', file: 'js/idb.js', needle: '成功即清零——只对连续失败告警' },
  { name: '拍一拍人称修复（sendPoke/performPoke 存 {me}/{ta} 占位符 + 渲染层 taFit 期间遮罩占位符，昵称不再被称呼改写成 他/ta/她）', file: 'js/chat.js', needle: "const hasPh = t.indexOf('{ta}') >= 0 || t.indexOf('{me}') >= 0" },
  { name: '音乐·TA 暂停再播放互动（播放中 taPauseProb 小概率 TA 暂停→发字卡→3.5s 后点播放恢复→再发字卡；设置可调、字卡库「音乐」tab 逐张开关）', file: 'js/music-player.js', needle: 'taPauseProb' },
  { name: '音乐·TA 暂停权限开关 + 防连发（taPauseEn 总开关关闭=彻底不触发；同一首歌只互动一次 + 冷却防"一直暂停又继续"）', file: 'js/music-player.js', needle: 'taPauseEn' },
  { name: '音乐·TA 暂停再播放字卡数据（「TA 暂停播放/TA 恢复播放」两组进系统预设字卡【其他互动功能字卡→音乐】）', file: 'js/default-cards-data.js', needle: 'TA 暂停播放' },
  { name: '音乐·TA 暂停播放补聊天系统消息（暂停时除字卡外再发"XX 暂停了音乐"系统消息，与其他音乐互动一致）', file: 'js/music-player.js', needle: '暂停了音乐' },
  { name: '音乐·TA 恢复播放补聊天系统消息（恢复时除字卡外再发"XX 又播放了音乐"系统消息）', file: 'js/music-player.js', needle: '又播放了音乐' },
  { name: '弱网/断网 play 拒绝回调判空（audio 异步回调期间可能已被 teardown 置空 → 先判空再解锁播放，修「Cannot read properties of null (reading \'play\')」红米K80 断网崩溃）', file: 'js/music-player.js', needle: '判空防 null.play()' },
  { name: '桌面图标 IDB 回填并行（Promise.all 一次读完 app-icon-*，修更新后首启「上传的图标图片消失数秒刷新才回来」）', file: 'js/personalize.js', needle: 'Promise.all(iconKeys.map' },
  { name: '互动卡片收藏全覆盖（cardSnapshot 补齐 ask/红包/送花/礼物/佳肴 + 心形按 data-idx 定位，修「有的卡片可以收藏有的点击无效」）', file: 'js/chat.js', needle: "favBtn.closest('[data-idx]')" },
  { name: '导出彻底不再写本机副本（absent 守卫：出现 idbSet(SNAPSHOT_KEY 即回归——iOS 导出闪退 #73 / 安卓导出后本地存储被写坏 #82 的根因）', file: 'js/data-backup.js', needle: 'idbSet(SNAPSHOT_KEY', absent: true },
  { name: '批量导入/上传持久化延后（scheduleSave 替代同步 saveGroups，修添加字卡后卡顿——同步序列化大库阻塞主线程）', file: 'js/chatcard.js', needle: "scheduleSave();\nrenderGroupsBar();\nrender();\ntoast('已导入 ' + imported" },
  { name: 'iOS PWA standalone ios-fs-active 下 .phone 用实测 --mochi-ios-h（修桌面图标被裁/100vh 超出视口）', file: 'css/base.css', needle: '.ios-pwa-standalone.ios-fs-active .phone' },
  { name: '后台音乐媒体条不丢（__musicWantPlay 暴露播放意图 + bg-keep 不让位覆盖歌曲媒体条 + onplay 重绑歌曲元数据，修红米K80 Chrome 通知栏媒体条时有时无/挂后台停播）', file: 'js/music-player.js', needle: '__musicWantPlay' },
  { name: '后台补播连续失败改冷却重试（bgResumeFailAt 60s 清零，修「挂后台总是自己停止播放」后无人拉起）', file: 'js/music-player.js', needle: 'bgResumeFailAt' },
  { name: '录音爆音修复（voiceMimePreferOpus：标准安卓 Chrome/Edge 走 webm/opus，修荣耀90 Edge 语音「滋啦滋啦」爆音；iOS/安卓 WebView 仍走 mp4/aac）', file: 'js/chat.js', needle: 'voiceMimePreferOpus' },
  { name: '桌面美化·全局字体快捷入口（复用聊天设置 cs-font 键，applyDeskCsFont 注入同款 @font-face，两边互通）', file: 'js/personalize.js', needle: 'applyDeskCsFont' },
  { name: '桌面美化·图标文字颜色（applyAppNameColor 注入 style 覆盖 .app .app-name color）', file: 'js/personalize.js', needle: 'applyAppNameColor' },
  { name: '桌面美化·颜色分区预览面板（desk-color-preview 各部位用 CSS 变量着色实时反映各项颜色）', file: 'template.html', needle: 'desk-color-preview' },
  { name: '贴贴同意后回应不带主动爱心（cuddle 回应去 initiative，修「同意贴贴后 TA 回应也显示主动联系爱心」）', file: 'js/chat.js', needle: "pick(CUDDLE_REPLIES), { initiative: true })", absent: true },
  { name: '大备份下载长命 blob URL（anchorDownload 保留到 pagehide/5 分钟才释放，修小米14U Edge 导出「点了下载没反应/没下载完」）', file: 'js/data-backup.js', needle: "addEventListener('pagehide', function h()" },
  { name: 'IDB 连接级错误判定加宽 + iOS 回前台主动重建连接（connLost 补 UnknownError/InternalError/TransactionInactiveError，修 iPhone 16 Pro Safari「存储异常」弹窗每会话必现）', file: 'js/idb.js', needle: 'armFgIdbReset' },
  { name: '开屏数据未就绪不放行（idbRestore 12s 保险丝改派发 mochi-restore-slow 不设 __mochiDataReady，修"没加载完就进入数据不全"）', file: 'js/idb.js', needle: 'mochi-restore-slow' },
  { name: '开屏「仍要进入」逃生口（splash-force-enter，数据超时未就绪时显示，进入提示数据可能不全）', file: 'js/clock.js', needle: 'splash-force-enter' },
  { name: '导出兜底读 memoryCache（idbGetCached，Safari IDB 挂起时导出朋友圈/聊天记录权威值不丢）', file: 'js/idb.js', needle: 'idbGetCached' },
  { name: '导出权威键强制读 IDB（isAuthorityKey，chat-msgs/feed-posts 不因 LS 有损小快照跳过 IDB 权威，修跨浏览器导入丢数据）', file: 'js/data-backup.js', needle: 'isAuthorityKey' },
  { name: '导入 chat-msgs 无 IDB 权威时 LS 快照写 IDB 兜底（chatFallback，不再无条件跳过导致彻底丢失）', file: 'js/data-backup.js', needle: 'chatFallback' },
  { name: '副本消费方已全部移除（absent 守卫：花园不再整包 JSON.parse 自动备份副本，防数百 MB 遗留快照 OOM）', file: 'js/garden.js', needle: 'offerSnapshotRecover', absent: true },
  { name: '聊天更多功能固定每行4个（.more-grid 改 4 列 grid + justify-items 居中，修不同屏宽 flex 换行每行 3~4 个不一）', file: 'css/chat-main.css', needle: 'grid-template-columns:repeat(4, 1fr); gap:14px; justify-items:center' },
  { name: '#88 启动按 IndexedDB 权威值校正当前桌面（correctCidFromIdb，修小米14U Edge LS 失效时「聊天记录几小时自己消失」＝桌面静默切回 default）', file: 'js/contacts.js', needle: 'correctCidFromIdb' },
  { name: '#88 migrateLegacy 判空改走 regStore（裸 localStorage 在 LS 失效机上恒空 → 每启动把真值改回 default，抵消上面的校正）', file: 'js/contacts.js', needle: "if (!regStore().get('active-contact'))" },
  { name: '#88 后台保活/通知开关回填后重应用（reheatBgSwitches，修 LS 启动读到空值导致「后台通知有时候自己关闭」）', file: 'js/bg-keep.js', needle: 'reheatBgSwitches' },
  { name: '#88 未读到权威值时不整包覆盖 chat-msgs（authOk 闸门 + pendingLocal 暂存，防读超时后一条新消息抹掉全部历史）', file: 'js/chat.js', needle: 'const authOk = chatDbReady && authLoadedPrefix === window.activePrefix();' },
  { name: '#88 诊断补整域 localStorage 占用与写探针结论（区分同 origin 其他站点占满配额 vs 本库损坏）', file: 'js/device.js', needle: 'localStorage 整域=' },
  { name: '#88 LS 失效自检并当场告知（__lsStatus + 自带 #cc-toast 提示「已改用数据库存储，数据不会丢」，不依赖 window.toast——产物里从未赋值）', file: 'js/device.js', needle: '本机浏览器本地存储受限' },
  { name: '#89 安卓收键盘卡顿修复（_aClosing 收起态：跳过逐帧 _aPinPan 强制 reflow + _aRefreshCe ce-box reflow，修红米/小米 Chrome 手动收起键盘那一刻卡顿）', file: 'js/mobile-adapt.js', needle: '_aClosing' },
  { name: '#90 IDB 严格三态清单/存在性探测（idbListKeys/idbHasKey：超时与「空库」彻底分开，[] 不再冒充「库里没有」）', file: 'js/idb.js', needle: 'window.idbHasKey = function' },
  { name: '#90 条数账本不进 #40 写日志（chat-meta 排除，防 LS 回滚把过期条数账本补回来误导守卫）', file: 'js/idb.js', needle: '/:chat-meta$/.test(key)' },
  { name: '#90 聊天记录条数账本 + 缩水守卫（chatLedgerGuard：可疑缩水时 IDB 与 LS 快照都不写 + 暂存 pendingLocal + 强制重读合并）', file: 'js/chat.js', needle: 'chatLedgerGuard' },
  { name: '#90 只有确认「库里没有」(has===false) 才新建单条数组（loadMsgs 与两条跨桌面追加路径，修后台通知回来一条消息覆盖整桌面历史）', file: 'js/chat.js', needle: 'return has === false;' },
  { name: '#90 读到有值却解析失败时绝不整包写回（readOk 闸门，防把读不懂的历史当成空数组覆盖）', file: 'js/chat.js', needle: 'if (!readOk) return;' },
  { name: '#90 写 active-contact=default 前先向 IDB 确认库里没有 + 校正逻辑抽函数支持直读 IDB（applyCidCorrection）', file: 'js/contacts.js', needle: 'applyCidCorrection' },
  { name: '#90 导出前清单没读到一律中止（idbListKeys 三态，绝不出具「全部数据完整」的近空备份）', file: 'js/data-backup.js', needle: '导出未完成' },
  { name: '#90 诊断新增「桌面归属体检」（三层 active-contact 并列 + 各桌面条数账本，区分记录被覆盖 vs 切错桌面）', file: 'js/device.js', needle: '桌面归属体检' },
  { name: '#91 预设/功能/查岗字卡列表改真虚拟窗口（flat+高度前缀和+视口±0.8 屏窗口+.cc-vspace 占位撑高，修 iPhone 15 Plus 进字卡库能滑但点返回卡死、卡回去后整页持续卡＝单分类整包铺进 3.3 万节点）', file: 'js/default-cards.js', needle: 'const V_PAD = 0.8' },
  { name: '#91 滚动容器动态判定（clipsContent 启发 + capture 阶段 scroll 事件锁定 e.target，兼容 dc 页由 page 滚 / fc 列表自滚 / 窗口滚三种形态，防窗口永不推进）', file: 'js/default-cards.js', needle: 'function clipsContent(' },
  { name: '#91 占位块样式在位（顶/底 .cc-vspace 撑回全高，滚动条长度与旧版一致＝全量行仍可达）', file: 'css/chat-pages.css', needle: 'cc-vspace' },
  { name: '#91 返回字卡库不再重复 JSON.parse 大库（refreshLibCounts force 分支走带缓存 pubGroupsRaw，多 MB 公用库每次返回解析两遍）', file: 'js/chatcard.js', needle: 'countOf(pubGroupsRaw())' },
  { name: '#92 字卡库离页/切作用域/切桌面冲刷（flushCcSave：200KB 大键只走异步 IDB + 120ms 防抖，刷新重进即丢公用/专享表情包上传，华为 P50E Edge 反馈）', file: 'js/chatcard.js', needle: 'function flushCcSave' },
  { name: '#92 切桌面先冲刷字卡库（setActiveContact 在 __activeCid 变更前 ccFlushSave，防 A 桌面待写 120ms 防抖写进 B 桌面键）', file: 'js/contacts.js', needle: "if (window.ccFlushSave) window.ccFlushSave()" },
  { name: '#93 回信后切到「收到的信」tab（submitReply 原 showPage 不 selectMailTab，停在旧 tab 看不到刚回信的来信，红米 K80 Chrome 反馈）', file: 'js/mail.js', needle: "selectMailTab('in');" },
  { name: '开屏进入门控补页面加载完成（window load 前「点击进入/仍要进入」都不放行，修 GitHub Pages 冷启动"网页还没加载完就能进、进去数据不全"）', file: 'js/clock.js', needle: '正在加载页面…' },
  { name: '#98 TA提问即进提问记录（pushAsk 发卡同步写 pending history + askTs 关联键透传，修"聊天有提问但主页提问记录空"）', file: 'js/ta-ask.js', needle: "status: 'pending'" },
  { name: '#98 chatAskReply 包装层统一写 ta-ask.history（覆盖文字题+单选题点选项两条回答路径，排除 deskCk 查岗卡）', file: 'js/ta-ask.js', needle: '__taAskReplyWrapped' },
  { name: '#98 提问记录待回答标签样式（.tc-li-pending 橙黄标签，TA已提问未回答时显示）', file: 'css/chat-pages.css', needle: 'tc-li-pending' },

  { name: '#86 遗留副本清理墙钟兜底 + 幂等（restore 整轮挂起、mochi-restore-done 永不到达时 20s 后仍清理；purgeOnce 保证 #90 的重试链只起一套）', file: 'js/data-backup.js', needle: 'function purgeOnce()' },
  { name: '#86 LS 大键迁移排除已下线副本键（不把几百 MB 遗留副本整包读进内存/写回 IDB/常驻 memoryCache，防清理后被复活）', file: 'js/idb.js', needle: "if (k === 'xy-home-v2:__auto-backup-snapshot') continue;" },
  { name: '#101 查看存储明细只列最大 5 项 + 占比条 + 百分比（其余折进「其他 N 项合计」，回归成流水账即报警）', file: 'js/personalize.js', needle: 'function pctOf(size, total)' },
  { name: '#101 展开区存储键名按桌面名显示（cid 命名空间换成联系人/桌面名，用户读得懂「谁的聊天记录」）', file: 'js/personalize.js', needle: 'function labelKey(k, names)' },
  { name: '#101 查看存储 IDB 键清单走 #90 严格三态（读不到不再退化成 [] 显示成「0 键」，也不再把「库里没有」冒充「读不到」）', file: 'js/personalize.js', needle: 'window.idbListKeys || window.idbGetAllKeys' },
  { name: '#101 总占用双口径分行「本项目占用合计」vs「浏览器整域已用」（防用户把同域名整域占用当成本应用数据/以为统计漏了）', file: 'index.html', needle: '本项目占用合计' },
  { name: '#101 占比条样式已接入产物（setting.css 的 .storage-cat-bar，漏接入 cssFiles 或样式被删即报警）', file: 'css/setting.css', needle: '.storage-cat-bar i { display:block' },
  { name: '#95 朋友圈图片格宽统一：单图/双图容器特判已删除（原 .feed-imgs:has(...) 使 1/2/3+ 图格宽 22%/40%/33% 不一致，加回即回归）', file: 'css/chat-pages.css', needle: 'feed-imgs:has(', absent: true },
  { name: '#95 朋友圈图片格宽统一：单图放弃 1:1 裁切的 aspect-ratio:auto 特例已删除（加回则单图随原图比例自由变高）', file: 'css/chat-pages.css', needle: 'feed-imgs img:only-of-type', absent: true },
  { name: '#96 网易云外链播放区分 play() reject 错误类型（非 NotAllowedError 走外链兜底，不再一律弹"被浏览器拦截"）', file: 'js/music-player.js', needle: "err.name !== 'NotAllowedError'" },
  { name: '#96 meting 直链解析校验 302/音频响应（VIP/失效歌 200 空正文不再当直链原样回投重播坏 URL）', file: 'js/music-player.js', needle: "r.redirected || /^audio\\//i.test(ct)" },
  { name: '#96 已死 corsproxy.io(401 强制 API key) 代理已从网易云 API 源列表移除（留着只刷「网络失败 401」日志，vivo Y35+Edge 诊断实证）', file: 'js/music-player.js', needle: 'https://corsproxy.io/?url=', absent: true },
  { name: '#96 播放拒绝按错误类型区分提示文案（源加载失败不再谎报"被浏览器拦截"）', file: 'js/music-player.js', needle: '在线歌曲加载失败' },
  { name: '#99 TA收藏改存歌曲快照（纯 ID 方案删歌后记录隐形；用户要求删歌后联系人收藏记录依旧保留）', file: 'js/music-player.js', needle: 'function taFavList()' },
  { name: '#99 TA收藏列表已删歌曲标识样式（置灰 + 已删除小标签）', file: 'css/chat-pages.css', needle: 'ta-fav-gone' },
  { name: '联系人主动消息爱心标识已去灰色阴影（.msg-hi-heart 双层 drop-shadow 已删，加回即回归）', file: 'css/chat-main.css', needle: 'drop-shadow(0 1px 1px rgba(0,0,0,.22))', absent: true },
  { name: '#100 诊断启动异常采集前置（window.__jsErrors 此前全项目无人初始化，build 兜底 if(window.__jsErrors) 恒 false＝功能文件启动异常静默丢弃）', file: 'js/device.js', needle: 'window.__jsErrors = window.__jsErrors || []; } catch (e0) {}' },
  { name: '#100 诊断软/硬双预算首屏标注（原 3s 单保险丝把 IDB 慢机的「最近错误/开关持久化体检/桌面归属体检/IDB 大键明细」整批截成裸「读取中…」，2026-08-30 iPhone 16 Pro 真机诊断实证）', file: 'js/device.js', needle: '未读到（本机存储响应慢，稍后自动补全）' },
  { name: '#100 诊断终态回填直写可见 #modal-textarea + 弹窗判活（ctl.text 的 setter 只写 hidden 的 #modal-input，回填曾静默失效；全站弹窗共用 DOM，关窗后迟到回填会灌进别的弹窗）', file: 'js/device.js', needle: 'if (!modalAlive()) { closed = true; return; }' },
  { name: '#100 诊断角标按最后一条错误时间戳判未读（原存条数，环形写满后新错误永远算不出未读＝角标常暗、错误线索看不见）', file: 'js/device.js', needle: 'const seen = Number(localStorage.getItem(SEEN_KEY)) || 0;' },
  { name: '#100 最近错误环形上限 5→20 且调用栈只给最近 3 条（5 条窗口用户报障时早已刷掉；全带栈会把报障文本撑到剪贴板截断）', file: 'js/device.js', needle: 'const ERR_CAP = 20;' },
  { name: '红米K80 切后台无法自动播下一首回归修复（后台非 NotAllowedError 拒绝不再烧一次性 https 重试链，恢复 scheduleBgResume 退避补播，源短暂恢复即接上）', file: 'js/music-player.js', needle: 'if (document.hidden) {\nbgBrokeAudio = true;\nplayRejected = true;\nscheduleBgResume();' },
];
try {
  const built = readFileSync(join(root, 'index.html'), 'utf8');
  const missing = FIX_SENTINELS.filter(s => !s.absent && !built.includes(s.needle));
  const leaked = FIX_SENTINELS.filter(s => s.absent && built.includes(s.needle));
  // v3.26.x #100：产物缺失时再对照源文件——「src 里也没有」和「src 有但产物没有」
  // 是两种完全不同的故障（前者修复真被覆盖、后者是漏接入构建或被旧缓冲回写），
  // 处置路径不一样，以前只有一句「请确认修复是否仍有效」，全靠人猜。
  // needle 含 \n 的是压缩后的多行特征（源文件带缩进/空行），按行分段判。
  const srcState = function (s) {
    if (!s.file || s.file === 'index.html') return null;
    let src;
    try { src = readFileSync(join(root, 'src', s.file), 'utf8'); } catch (e) { return 'nofile'; }
    return s.needle.split('\n').every(function (seg) { return src.includes(seg); });
  };
  // v3.26.x #100：「哑哨兵」体检——两种真正拦不住回归的登记方式。
  // A 锚点指错地方：登记的 file 是某个 src 源文件，但该 needle 在那个文件里根本不存在，
  //   它能报绿纯粹靠产物里别处的同名文本 → 把这个文件的修复整块删掉也不会报警。
  //   （实测踩过：needle `window.__jsErrors = window.__jsErrors || []` 在 chat.js 也有
  //   一份，把 device.js 的初始化整行删掉，146/146 仍然全绿。）
  // B 一条 needle 被多条登记共用：两条互相掩盖，出问题时也分不清是哪次修复丢了。
  // 注：不再按「产物内出现次数 ≥2」报警——那是噪音（实测 70 条），同名文本多处出现
  // 通常仍会随守卫一起消失，拦得住。只警告不置失败码，登记人把锚点收到唯一即可。
  const dead = [];
  const misanchored = FIX_SENTINELS.filter(function (s) {
    if (s.absent || !s.file || s.file === 'index.html') return false;
    const st = srcState(s);
    if (st === 'nofile') { dead.push(s); return false; }
    return st === false;
  });
  const byNeedle = {};
  FIX_SENTINELS.forEach(function (s) { (byNeedle[s.needle] = byNeedle[s.needle] || []).push(s.name); });
  const shared = Object.keys(byNeedle).filter(function (k) { return byNeedle[k].length > 1; });
  // C 针在注释里：needle 在 src 里存在，但只写在整行注释里（minifyJs 丢整行 `//`、
  //   minifyCss 丢块注释）→ 压缩后产物永远不可能命中，构建恒定失败却看不出谁的问题。
  //   做法是把登记的那个 src 文件按对应压缩函数走一遍再比对（多行 needle 跳过：
  //   多行按「压缩后的相邻行」写，逐段判由上面的锚点检查负责）。
  const lostInMinify = FIX_SENTINELS.filter(function (s) {
    if (s.absent || !s.file || s.file === 'index.html' || s.needle.indexOf('\n') >= 0) return false;
    let src;
    try { src = readFileSync(join(root, 'src', s.file), 'utf8'); } catch (e) { return false; }
    if (!src.includes(s.needle)) return false; // 文件里根本没有＝上面的「锚点指错」已经报了
    const min = /\.css(\||$)/.test(s.file) ? minifyCss(src) : minifyJs(src);
    return !min.includes(s.needle);
  });
  if (misanchored.length || shared.length || dead.length || lostInMinify.length) {
    console.warn('⚠️  哑哨兵 ' + (misanchored.length + shared.length + dead.length + lostInMinify.length) + ' 条（拦不住回归，请把 needle 收到「该源文件里唯一」）：');
    misanchored.forEach(function (s) {
      console.warn('   · 锚点指错：[' + s.name + '] 登记的 ' + s.file + ' 里找不到 needle "' + s.needle + '"（产物里是靠别处同名文本过的检）');
    });
    lostInMinify.forEach(function (s) {
      console.warn('   · 针在注释里：[' + s.name + '] needle "' + s.needle + '" 在 src/' + s.file + ' 里只出现在注释中，压缩后必丢（产物永不命中，换成同行代码特征）');
    });
    dead.forEach(function (s) {
      console.warn('   · 死锚点：[' + s.name + '] 登记的 src/' + s.file + ' 已不存在（文件改名/下线，needle 与修复脱钩）');
    });
    shared.forEach(function (k) {
      console.warn('   · 共用 needle "' + k + '"：' + byNeedle[k].map(n => '[' + n + ']').join(' '));
    });
  } else {
    console.log('✅ 哑哨兵体检 0 条（每条 needle 都在自己登记的那个 src 文件里、且无共用锚点）');
  }
  const hintOf = function (s) {
    const st = srcState(s);
    if (st === null) return '';
    if (st === 'nofile') return ' ← 源文件 src/' + s.file + ' 不存在（被改名/删除？哨兵登记要跟着改）';
    if (!s.absent) return st ? ' ← src 里仍在＝产物没接入（查 build.mjs 的 jsFiles/cssFiles，或产物被旧缓冲覆盖）' : ' ← src 里也没有＝修复真丢了，去 src/' + s.file + ' 补回';
    return st ? ' ← src 里也回来了＝删除被改回' : ' ← 只有产物里有＝产物比 src 旧，重新构建';
  };
  if (missing.length || leaked.length) {
    if (missing.length) {
      console.error('❌ 关键修复哨兵检查：以下 ' + missing.length + ' 项特征在产物中缺失（修复被覆盖/未接入）：');
      missing.forEach(s => console.error('   · [' + s.name + '] 应含 "' + s.needle + '"（' + s.file + '）' + hintOf(s)));
    }
    if (leaked.length) {
      console.error('❌ 删除型修复哨兵：以下 ' + leaked.length + ' 项「应不存在」的特征又回来了（移除被并行改动/旧缓冲覆盖）：');
      leaked.forEach(s => console.error('   · [' + s.name + '] 不应含 "' + s.needle + '"（' + s.file + '）' + hintOf(s)));
    }
    console.error('   哨兵是回归防线的最后一道——请逐条确认后再提交（对应 verify-xxx.mjs 可补跑复核）。');
  } else {
    console.log('✅ 关键修复哨兵 ' + FIX_SENTINELS.length + '/' + FIX_SENTINELS.length + ' 全部在位（修复无丢失）');
  }
  // v3.26.x #100：哨兵必须能让构建失败。此前全文件没有一次 exit，
  // 警告只在人眼里、CI 里永远是绿的——「修复被静默覆盖」正是这套防线要拦的事。
  // 放在最后：产物此时已写盘，失败不会留下半成品产物。
  if (missing.length || leaked.length) process.exitCode = 1;
} catch (e) {
  console.error('❌ 哨兵检查未能执行（产物读不到？）：' + (e && e.message));
  process.exitCode = 1;
}
// v3.27.x：sw.js 专项哨兵（导航回退优先当前 CACHE + activate 补 fetch 自愈，防被并行会话覆盖）
try {
  const swSrc = readFileSync(join(root, 'sw.js'), 'utf8');
  const swNeedles = [
    'caches.open(CACHE).then((c) => c.match(\'./index.html\')).then((m) => m || caches.keys()',
    'claim 后异步补一次 fetch 写入当前 CACHE',
    'sort((a, b) => cacheVersion(b) - cacheVersion(a))'
  ];
  const swMissing = swNeedles.filter(n => !swSrc.includes(n));
  if (swMissing.length) {
    console.error('❌ sw.js 关键修复哨兵：以下特征缺失（修复可能被覆盖）：');
    swMissing.forEach(n => console.error('   · 应含 "' + n + '"'));
    process.exitCode = 1; // v3.26.x #100：同主哨兵，缺失必须让构建失败
  } else {
    console.log('✅ sw.js 哨兵 ' + swNeedles.length + '/' + swNeedles.length + ' 在位');
  }
} catch (e) { console.error('❌ sw.js 哨兵未能执行：' + (e && e.message)); process.exitCode = 1; }
