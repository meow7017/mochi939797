# 本次构建者：AI-B

### 2026-08-30 22:06（#101 帮我决定加载失败诊断加强：功能入口体检）
- [AI-B 域]（**改动文件：src/js/device.js；构建状态：已构建·sw mochi-mtfvutd7，哨兵 0 哑哨兵、sw.js 3/3、verify.mjs 10/10、verify-diag-report.mjs 18/18，未提交**）。
- 需求/反馈：用户安卓 Chrome/Edge 报【帮我决定】总是"加载失败"（chat.js:4769 的 else 分支，window.openDecision falsy 时触发）。用户版本 = a6d854a（v3.26.371，ts=1788093190014）。Playwright 测工作区产物 + HEAD(a6d854a) 产物：桌面完全正常（openDecision 是 function，完整点击流程面板打开）。**核心矛盾**：用户诊断说"启动文件异常：无"（__jsErrors 空，decision.js 没抛错），但点击 more-decide 仍"加载失败"（openDecision undefined）。理论上 decision.js 抛错必被 build.mjs 的 catch push 到 __jsErrors（device.js:14 初始化它），但用户诊断无记录。
- 方案：device.js 诊断生成（1120 行后）加「功能入口体检」节，检查 typeof window.openDecision/openGroupDecision/activePrefix/xyStore/idbGet/idbSet，缺失则列出。用户更新后点帮我决定再采集诊断，即可确认 openDecision 是否赋值，区分「decision.js 抛错但 __jsErrors 没捕获」vs「openDecision 赋值了但点击走 else」。
- 验证：node --check 过；verify.mjs 10/10；verify-diag-report.mjs 18/18。待用户更新到 sw mochi-mtfvutd7 后采集诊断（先点帮我决定看到"加载失败"再采集）。
- **需要用户配合**：更新到新版本（sw mochi-mtfvutd7）→ 进聊天页点"帮我决定"看到"加载失败" → 设置页"复制诊断信息" → 把诊断文本发我，重点看「功能入口体检」行。

### 2026-08-30 21:40（#96 网易云外链播放兜底收口 + #99 联系人收藏删歌保留 + 荣耀 x30i Wi-Fi 屏蔽结论）
- [跨域·music-player.js + chat-pages.css + build.mjs + FIX-REGRESSION.md + verify-music-ta-fav-keep.mjs（AI-A 域，接管补强已收口）]（**改动文件：src/js/music-player.js、src/css/chat-pages.css、build.mjs、FIX-REGRESSION.md、tools/verify-music-single-audio.mjs、tools/verify-music-ta-fav-keep.mjs；构建状态：已构建 sw mochi-mtfsv7e0 哨兵 146/146；verify.mjs 10/10 + 音乐专项全绿**）。
- 需求/反馈（三台真机）：① vivo Y35+Edge：链接/导入的网易云歌单歌曲一律「点击播放被浏览器拦截」且切后台更糟；② 荣耀 x30i+Edge：只能流量听歌、Wi-Fi 一直「被浏览器拦截」；③ 功能要求：桌面【音乐】→【联系人收藏歌曲】，音乐库删歌后联系人收藏记录要保留。
- 根因：#96 三源叠加——`startPlayback`/`toggle` 的 `play().catch()` 不接收错误对象、全当自动播放策略拦截；meting 对 VIP/失效歌返回 200 空 text/html 被 `resolveNeteaseDirectUrl` 当直链回投（一进就失败）；`corsproxy.io` 已死（401 强制 API key）仍在源列表里刷「网络失败 401」。荣耀 x30i 诊断（song 3325185866 免费 302→CDN、无网络失败日志）证实其 Wi-Fi 属**网络层屏蔽音乐源**（移动数据正常），非应用 bug。
- 方案：#96 ① 接收 err 仅 `NotAllowedError`（真自动播放策略）走 muted 解锁+handlePlayReject，其余走 `retryWithHttpsUrl`→`demoFallbackOrError` 兜底（加 `httpsRetrying/demoFallbackBusy` guard 防换源窗口期 teardown rejections 误判）；② `resolveNeteaseDirectUrl` 只认 `r.redirected || /^audio\//i.test(ct)`（200 空正文不再当直链）；③ corsproxy.io 从网易云歌单/详情/时长/fee 四源列表移除；④ 按错误类型给文案：源失败弹「在线歌曲加载失败：可能为会员歌曲、链接失效，或网络无法访问音乐源」，不再谎报「被浏览器拦截」；`offerRemoveDamagedSong` 文案同步改「可能为会员/失效歌曲」。#99 ① `music-favs-ta` 改存完整快照 `{id,name,artist,neteaseId,url,cover,duration,favAt}`（addTaFav 写全量）；② 旧纯 id 数据渲染自愈回补快照；③ 已删歌置灰+「已删除」小标签+副行提示；④ 可还原歌点击重新入库起播（restoreTaFavSong 回写收藏条目指向新 id），不可还原歌可移除。
- 验证：`node --check src/js/music-player.js` 过；`node tools/verify-music-vip-filter.mjs` 6/6；`node tools/verify-music-single-audio.mjs` 15/15（mock 的 reject 改 `re.name='NotAllowedError'`、stub 带 302/audio 头匹配新校验）；`node tools/verify-music-vip-clean.mjs` 6/6；`node tools/verify-music-bg-resume.mjs` 10/10；`node tools/verify-music-dur-cover.mjs` 9/9；新增 `node tools/verify-music-ta-fav-keep.mjs` 10/10（旧纯 id 自愈/已删歌展示/删歌后保留+还原起播/不可还原移除）；`node tools/verify.mjs` 10/10。
- 荣耀 x30i 结论：Wi-Fi 屏蔽音乐源为运营商/网络侧限制，应用侧无法绕过（HTTPS 混合内容、代理均已试），已给准确 toast 如实告知。已构建收口，见本次 commit。

### 2026-08-30 21:21（#100 二阶段：哨兵装上牙齿 + 诊断线索窗口 5→20 + 回归清单/交接日志自愈 + verify 批量 runner）
- [AI-B 域]（**改动文件：build.mjs、src/js/device.js、package.json、FIX-REGRESSION.md、WORKLOG.md；新增 tools/verify-sentinel-teeth.mjs、tools/verify-suite.mjs，tools/verify-diag-report.mjs 补第 6 节；构建状态：已提交（0b4ad34，与 #96/#99 同批入库）；本目录产物其后已由并行会话带 #101 改动重建为 sw mochi-mtfvutd7**）。
- P0 哨兵由「只警告」改成真拦：缺失/回流 → console.error + `process.exitCode = 1`（sw.js 专项哨兵同口径，检查自身抛错也置失败）；报错行按登记的 `file` 复核 src 并给出处置提示（「src 里也没有＝修复真丢了，去补回」/「src 里仍在＝产物没接入，查 jsFiles/cssFiles」）；新增「哑哨兵体检」——needle 在自己登记的文件里不存在、或多条登记共用同一 needle，都报警（这两种都拦不住回归）。
- 反向对照 `node tools/verify-sentinel-teeth.mjs` 13/13：在临时副本里逐条删掉 #100 的 5 行修复源码，重建必报警且退出码 = 1（此前删掉 `__jsErrors` 初始化行构建仍 146/146 全绿＝哨兵无牙）。这一轮顺带修好 4 条既有哑哨兵（memo-arc / my-arc / chat-settings / default-cards，needle 与他处文本撞名），只改 build.mjs 登记，未动 AI-A 的 src。
- P1 诊断线索窗口：`ERR_CAP` 5→20（5 条窗口用户报障时早被后续报错刷掉），调用栈只随最近 3 条输出（20 条全带栈会把报障文本撑到剪贴板截断）；`tools/verify-diag-report.mjs` 加第 6 节（播种 30 次抛错 → 环形 20 条 / 正文 20 行 / 栈 ≤12 行），整脚本 18/18。
- P3 批量 runner：新增 `tools/verify-suite.mjs` + `npm run verify:all`（181 个 verify 脚本此前只能逐个手敲、实际没人跑）。默认并发 3、单脚本 240s 超时，支持文件名过滤 / `--jobs` / `--tail` / `--strict`；失败项打印退出码与输出末行，>60s 的项单独列出来。默认退出码 0（可见性优先，脚本里混着断言过期和需真机/外网两类），清单清干净后用 `--strict` 当门禁。
- P3 首份全量基线（本目录从未整体跑过 182 个脚本，对 sw `mochi-mtfv6u56`）：**113 通过 / 69 失败或超时 / 0 环境不满足**；其中 69 个红项对本目录最新产物重跑一遍（排除"跑的是一半新一半旧的产物"）**3 转绿 / 65 断言失败 / 1 超时**，即有效基线 **116 通过 / 65 断言失败 / 1 超时（共 182）**。转绿：`verify-bubble-css` 8/8、`verify-music-filter` 15/15、`verify-quote-image` 13/13。唯一超时 `verify-pong-balance`（pong 胜率统计需大量对局，240s 未跑完，非断言失败）。65 项红绝大多数是"断言期望已被后续版本改掉"与需真机/外网两类，尚未逐项判定——需要对方处理：这批红项按域分给 AI-A 逐项销账（该修的修、过期改期望或删），别整体忽略；`--strict` 在此之前不能当门禁。
- 文档自修：FIX-REGRESSION.md 有 3 行被正文裸 `|` 打断（#3 `split(/\r\n|\r|\n/)`、#78 `idn === n || cn === n`、#96 `r.redirected || /^audio\\/…`），已按表内既有写法转义为 `\|`（打断行的碎片原先被表格吞成空列，正文错位）；同时压掉按列对齐的空格填充、表内 4 处空行和 7 列假表头（154KB → 98 条统一 4 列，脚本逐格校验正文内容前后一致）。WORKLOG.md 660 条 / 4997 行远超自家上限，超出部分整段移入 `WORKLOG-archive/2026-08.md`（原文照搬，状态以 git log 与 FIX-REGRESSION.md 为准）。另按 AGENTS.md 要求留痕：本轮改了 **AGENTS.md「回归防线」**小节，把「needle 要在登记的那个 src 文件里唯一 + 哑哨兵体检」「哨兵缺失/回流 → 构建退出码 1 + 处置提示」「`npm run verify:all` 一次性复跑」写进协议。
- 需要对方处理（AI-A）：`node tools/verify-mail-cfg-per-cid.mjs` 在本目录产物上 **6/10 红**——B2「当前桌面未越自己的每日上限 → 0 封 实测 1」、B4「甲达自己上限后不再来第 2 封」、B5「default / 乙仍 0 封 → {"def":1,"yi":0}」，即「信箱每日上限按桌面独立」实际不成立。**根因（另一会话已定位，本目录 mail.js 同状态）**：2026-08-28 信箱键改 per-cid 时 `const incId = cStore().get(MAIL_KEY) || '';` 把「收件箱键读成空串」当成「信箱里已无来信」，`load()` 随即 `filter(l => l.id !== incId)` 滤掉全部 partnerReply/myReply、render 再把 content 为空的寄出信滤掉 → 列表空白，且上限守卫全部早退不再来信。修法要按「键不存在 vs 无来信」双态语义（哨兵里那条空串归一化不够，读键处仍是空串＝无来信）。mail.js 属你方，按 AGENTS.md 未代改；若脚本期望已被后续改动取代，请同步改脚本与 FIX-REGRESSION 行。

### 2026-08-30 20:42（此间「对方当前时间」复用列表首位梦角半小时段——两个时间不再矛盾）
- [跨域·cjian.js（AI-A 域）]（**改动文件：src/js/cjian.js；构建状态：未构建（node --check 过；halfRangeOf 12 例验证全 OK）**）。
- 需求/反馈：用户指出「对方当前时间」卡片（全天随机 16:42 申时）与列表梦角卡片（未正 14:30–14:59 感觉不到 有空）两个时间矛盾，期望「对方当前时间」先抽时段再抽具体时刻、时段与列表卡片完全一致。
- 根因：两个功能是独立的两套时间——「对方当前时间」`taTimeOf(cid)`（桌面级，键 `cjian-ta-time`）合并该桌面**所有梦角 slots 并集**抽时刻，无 slots 梦角时退回全天随机（`hh=rand(0,23);mm=rand(0,59)` 一步到位，无时段概念）；列表卡片 `cardEl` 用 `worldMinuteOf(c)`（梦角级，键 `cjian-ott`）按梦角 id 各自抽。两者来源/持久化/刷新周期都独立，无联动，展示形式也不同（前者标签"全天随机"+hh:mm+整时辰名，后者 half+range+状态）。
- 方案：① 新增 `halfRangeOf(wm)`（cjian.js:858）——由世界分钟算半小时段 {lo,hi,half,range}，与 `timeInfo` 的 half/range 同源（含跨午夜同既有行为，不引入新差异）；② `taTimeOf` 重抽分支改为复用列表首位梦角 `worldMinuteOf(c0)` 的半小时段，在该段 [lo,hi] 里抽具体时刻，存 `t.half/t.range` 供标签展示；桌面无梦角时退回全天先抽时辰（12 时辰等概率）再 `slotMinuteRange` 抽时刻；③ `taSlotLabel` 改为优先显示 `t.half+' '+t.range`（如"未正 14:30–14:59"），旧数据无该字段则实时取首位梦角 `halfRangeOf` 兜底，无梦角才回"全天随机"。删去原 slots 并集收集 + `slotStartH` 记录逻辑。
- 验证：`node --check src/js/cjian.js` 过；临时脚本 12 例（含 14:30/14:59 用户场景、跨午夜 23:30）确认 half/range 与 timeInfo 一致、wm 落 [lo,hi]、抽中 total 落 [lo,hi]，脚本已删。待构建者 build + 真机：首位梦角世界时间在某半小时段时，「对方当前时间」标签显示同一 half+range、hh:mm 落在该段。
- 跨域改动 cjian.js（AI-A 域）理由：用户直接报告该矛盾并指明改向（复用列表首位梦角时段）。未碰 AI-A 在途文件（git status 干净，cjian.js 无对方改动）。**需要 AI-A 知晓**：`taTimeOf` 不再合并桌面所有梦角 slots 并集抽时刻，改为复用 `loadRoster(cid)[0]` 首位梦角的半小时段；`taSlotLabel` 不再区分 hasSlots/"全天随机"，始终显示 half+range。若你在改 cjian.js 的 roster 顺序/世界时间链路，注意「对方当前时间」现在依赖首位梦角 `worldMinuteOf`。

### 2026-08-30 19:58（#98 提问记录不显示：TA提问即进记录 + 单选题回答也写history）
- [跨域·ta-ask.js + chat-pages.css（AI-A 域）+ build.mjs + FIX-REGRESSION.md]（**改动文件：src/js/ta-ask.js、src/css/chat-pages.css、build.mjs、FIX-REGRESSION.md；构建状态：未构建（node --check src/js/ta-ask.js 过；19:55 那次 build 在本改动之前，产物未含 __taAskReplyWrapped/tc-li-pending）**）。
- 需求/反馈：荣耀x60i/夸克浏览器，聊天里联系人有提问，但主页【提问记录】没显示。
- 根因：① pushAsk（ta-ask.js:501）发 ask-card 只写 chat-msgs，不写 ta-ask.history；history 只在 openAskReply 回答后写（ta-ask.js:610）→ 未回答的提问不进记录。② 单选题点选项直接调 chatAskReply（chat.js:1367），不经 openAskReply → 单选题回答从不写 history（即使回答了记录也空）。默认题库 11 道单选题（q_s1~q_s11），用户大概率命中单选题。与设备/浏览器无关。
- 方案：① pushAsk 发卡时生成 askTs 透传进 chat-msgs 记录（chat.js:2509 addRec 已透传 askTs），同步往 ta-ask.history 写 {q,a:'',reply:'',ts:askTs,status:'pending'}；② 包装 window.chatAskReply（ta-ask.js 加载在 chat.js 之后），回答时按 askTs 找 pending 更新为 answered，找不到则新增兜底；排除 deskCk 查岗卡；③ openAskReply 删原 history.push（包装层统一写）；④ renderAskRecords 渲染 pending 显示橙黄"待回答"标签（.tc-li-pending 追加到 chat-pages.css 末尾）。
- 验证：node --check 过。待构建者 build + 真机荣耀x60i/夸克：TA 提问后立即进提问记录（待回答），回答后更新为已回答（文字题+单选题）；deskCk 查岗不污染。
- 跨域改动 AI-A 文件理由：用户直接报告该 bug；ta-ask.js + chat-pages.css 均在 AI-A 名下。未碰 AI-A 在途文件（ta-ask.js 无对方改动；chat-pages.css 末尾追加不冲突）。chat-pages.css 因并行会话持续改写致 edit 竞态，.tc-li-pending 改用 Add-Content 追加末尾。其他三 tab（小问题/好奇/吐槽）同设计但缺稳定关联键透传，未本次改，建议后续统一。
### 2026-08-30 20:10（联系人主动消息爱心标识去掉灰色阴影）
- [AI-A 域]（**改动文件：src/css/chat-main.css；构建状态：未构建**）。
- 反馈：聊天里联系人主动发送消息的爱心标识（.msg-hi-heart）有灰色阴影。根因：v3.26.x 该元素带双层 filter:drop-shadow（白色发光 + 黑色投影 rgba(0,0,0,.22)），浅色气泡上黑色投影呈灰色。已整行删除 filter，爱心恢复纯色。dark.css / chat-pages.css 无此元素覆盖，一处改动即可。
- **跨域改动 build.mjs**（AI-B 域，理由：回归防线）：FIX_SENTINELS 加 1 条 absent 哨兵（`drop-shadow(0 1px 1px rgba(0,0,0,.22))`，加回即报警）；FIX-REGRESSION.md 加 #97 行（共享文件）。
- **待 AI-B 下次构建收口**（本次未构建、未提交）。

### 2026-08-30 19:55（诊断信息「读取中…」截断三修 + 回填链路打通 + 构建收口）
- [AI-B 域]（**改动文件：src/js/device.js、新增 tools/verify-diag-report.mjs；构建状态：已构建·sw mochi-mtfr6ow6，哨兵 132/132、sw.js 哨兵 3/3、verify 10/10、新脚本 15/15**）。
- 需求/根因：审计「复制诊断信息」发现三处真实缺陷（均有产物实测佐证）。① 外层只有 3s 单保险丝，而子任务自带 8~9s 预算 → IDB 一慢，「最近错误/开关持久化体检/桌面归属体检/IDB 大键明细」整批停在「读取中…」，偏偏只有这几行能定位存储故障（WORKLOG 里 2026-08-30 iPhone 16 Pro 真机诊断即如此，前一日只修了 IDB 侧、次日复发）；② build.mjs 兜底写的 `if (window.__jsErrors)` 全项目无人初始化（实测产物里 undefined）→ 任何功能文件启动抛错被静默丢弃，诊断里也看不到；`diagToast` 依赖的 `window.toast` 同样从未赋值（实测 undefined）→ 从点击到弹窗出内容之间用户零反馈，正是「点了没反应」类反馈的观感来源；③ 角标 SEEN_KEY 存的是「上次看过时读到的条数」，而错误环形上限 5 条 → 满 5 之后新错误永远算不出未读，角标形同常暗。
- 方案：① 软/硬双预算——3.5s 先交首屏（未读到的行明确改写为「未读到（本机存储响应慢，稍后自动补全）」，绝不裸留「读取中…」冒充），Promise.all 或 12s 硬预算进入终态（残留行改标「未完成（本机存储无响应…）」），终态之后才自动复制；600ms 轮询只在首屏已交付后驱动回填（否则会把软预算抢成 0.7s、交出更残缺的首屏）。② device.js 是 jsFiles 第一个文件，在其首行初始化 `window.__jsErrors`，诊断新增「启动文件异常」节列出出错文件名；diagToast 改为 window.toast 优先、否则自绘 #cc-toast。③ SEEN_KEY 改存最后一条错误的时间戳、按 `t >` 比较并显示未读条数，遗留旧格式值（条数）自动视为未读并自愈。
- **过程中踩到的真实断点（值得记）**：回填原计划走 `ctl.text(txt)`，实测无效——personalize.js 里 `ctl.text()` 的 getter 优先读 `#modal-textarea`，setter 却只写 `#modal-input.value`，而 textarea 模式下 input 是 hidden 的（setter/getter 不对称）。改为直写可见 `#modal-textarea`。另：全站弹窗共用同一批 DOM 且「点遮罩/取消」只 close() 不回调 cb（`closed` 永远 false），回填窗口最长 30s，会把诊断长文灌进用户随后打开的别的弹窗——补 modalAlive()（遮罩可见 + 标题仍是「复制诊断信息」）判活，不过关即视同关闭、停止回填与自动复制。**需要 AI-A 知晓**：这三条是诊断侧行为，未碰弹窗组件本体；ctl.text 的 setter/getter 不对称仍在（其他 textarea 弹窗若将来用 setter 会踩同一个坑，需要时再收口到 personalize.js）。
- 验证：`node tools/verify-diag-report.mjs`（新增，跑真产物，15/15）——含 3.5s 交付实测 3583ms、挂起场景 12149ms 必给终态、回填后「未读到」残留 0 处、角标三场景、关窗后迟到回填不污染别的弹窗。构建产物哨兵 132/132 未破。
- **本次构建收口说明（给 AI-A）**：产物已包含你们 WORKLOG 标「未构建」的 #96 music-player.js、心意币 p2-features.js + chat-pages.css，以及 build.mjs #96 哨兵——这些改动现在在 index.html 里（尚未 git 提交，提交时请连产物一起）。但**构建窗口内新出现的 src/js/ta-ask.js（M）不在本产物里**，若已改完请自行构建或留言给我。
- 待办（未做，原因说明）：本次三项修复没登记 FIX_SENTINELS / FIX-REGRESSION.md 行——build.mjs 与 FIX-REGRESSION.md 当时都在你们手里带未提交改动（#96 哨兵），避免并行写同一文件冲突。现在有空位的话请补登记，或留言给我由构建者统一加（哨兵特征串建议：`window.__jsErrors = window.__jsErrors || []`、`未读到（本机存储响应慢`、`modalAlive`）。

### 2026-08-30 19:46（#96 网易云外链播放"被浏览器拦截"误报修复——区分 play() reject 错误类型）
- [跨域·music-player.js + build.mjs + FIX-REGRESSION.md]（**改动文件：src/js/music-player.js（startPlayback/toggle 的 play().catch）、build.mjs（#96 哨兵）、FIX-REGRESSION.md（#96 行）；构建状态：未构建（node --check src/js/music-player.js 过）**）。
- 需求/反馈：用户问「为什么不同手机浏览器播放网易云歌单链接的歌曲，总是显示被浏览器拦截」，要求修复。
- 根因（代码推理）：`music-player.js` 的 `startPlayback`(1962行)/`toggle`(2588行) 在 `audio.play()` 被 reject 时**不接收错误对象、不区分错误类型**，把所有失败都当自动播放策略拦截。网易云歌曲 `audio.src` 是跨域 meting URL（api.injahow.cn），部分浏览器在跨域 media 数据未就绪时 `play()` 返回非 `NotAllowedError` 的 reject（NotSupportedError/AbortError 等，实为源加载失败/跨域/混合内容/meting 不可达），旧代码一律走 muted 静音解锁 → 仍失败 → 弹「点击播放被浏览器拦截」，吞掉了本应走的 retryWithHttpsUrl/demoFallbackOrError 兜底路径，且误导用户以为是浏览器问题。
- 方案：`play().catch((err) => …)` 接收错误对象，仅 `err.name === 'NotAllowedError'`（真自动播放策略）才走 muted 静音解锁 + handlePlayReject；其他错误走 retryWithHttpsUrl（拉 https 直链重播）→ demoFallbackOrError（内置旋律/坏链提示），不再弹「被浏览器拦截」。toggle（暂停后再播）同款区分。onloadedmetadata 补播、musicHoldForCall 恢复未改（playRejected 现只在 NotAllowedError 时置位，补播逻辑自然收窄；通话恢复文案温和）。
- 验证：node --check src/js/music-player.js 过。待构建后跑哨兵 + 真机：网易云歌曲点击播放——源正常直接出声；源加载失败走「正在获取完整版直链…」→ 内置旋律兜底或「播放失败，换一首歌试试」，不再弹「被浏览器拦截」；本地歌曲/真自动播放场景仍走 muted 静音解锁不受影响。
- 跨域改动 music-player.js（AI-A 域）理由：用户直接要求修复，根因明确在 play().catch 不区分错误类型。改动仅限两处 catch 回调加错误类型分支，未碰播放/兜底/媒体会话等其他逻辑。**需要 AI-A 知晓**：若你正在改 music-player.js 的播放链路，注意 #96 在 startPlayback/toggle 的 catch 里加了 `err.name !== 'NotAllowedError'` 分流——非自动播放错误现在走 retryWithHttpsUrl/demoFallbackOrError，别把这条分支误删。

### 2026-08-30 19:35（心意币存钱改 per-cid + 共用余额 + 切换联系人 + 聊天提醒）
- [跨域·p2-features.js + chat-pages.css（AI-A 域）]（**改动文件：src/js/p2-features.js、src/css/chat-pages.css；构建状态：未构建（node --check src/js/p2-features.js 过）**）。
- 需求/反馈：用户检查发现「联系人在心意币存钱里存入时聊天无提醒」；并要求「心意币存钱里可以切换桌面联系人」「我和联系人应该共用这个存钱」。
- 根因：原心意币存钱数据全局共享（piggyStore=xyStore('xy-home-v2')）且分 my/ta 双账户；piggyCoinAdd 不调 chatAddSystem（仅 TA 塞币彩蛋 piggyCoinMaybeTa 发聊天消息）。
- 方案：① 数据改 per-cid（storeFor(viewCid)，键 piggy-coin2-*）；② 合并 my/ta 双账户为单一共用余额，存一笔/取一笔不再选账户（存扣 myBalance、取退 myBalance）；③ 顶部加联系人切换器（不切桌面，只切存钱罐查看，viewCid 模块变量）；④ 存入/取出时若 viewCid=当前联系人则 chatAddSystem 发系统消息；⑤ 旧全局 piggy-coin-*（含 side）一次性合并迁移到 default 命名空间（piggyCoinMigrate，首次切到 coin tab 触发）；⑥ TA 塞币/取回彩蛋加 piggyCoinIsCurrent 守卫。
- 验证：node --check src/js/p2-features.js 过；grep 确认无 piggyCoinTotal/piggyCoinBal('my'/'ta')/coin-bal-my/coin-bal-ta 拋留。待构建者 build + 真机：多联系人各自存钱罐独立、切换查看、存取聊天有系统消息、旧数据迁移到 default。
- 跨域改动 AI-A 文件理由：用户直接指派该需求；p2-features.js（心意币存钱）+ chat-pages.css（样式）均在 AI-A 名下。未碰 AI-A 在途文件（19:22 那条 chat-pages.css 改动已构建，本条追加新选择器到文件末尾不冲突）。

### 2026-08-30 19:22（#95 朋友圈动态图片格宽统一：删除单图/双图的按张数特判）
- [AI-A 域·chat-pages.css + FIX-REGRESSION.md + tools/verify-feed-img-size.mjs + 跨域 build.mjs（新增 2 条 absent 哨兵）]（**改动文件：src/css/chat-pages.css、build.mjs、FIX-REGRESSION.md、tools/verify-feed-img-size.mjs（新建）；构建状态：本会话未构建——但构建者 19:19 那次 build 已把我的 chat-pages.css 改动扫进产物（实测 index.html 内三条特判规则 0 命中、`.feed-imgs img` 统一规则在位），我的 2 条新哨兵还没被任何构建跑过（19:19 用的是改动前数组 129/129，下次构建应为 131/131）**）。
- 需求/反馈：用户问「为什么联系人发 1 张图和 2 张图、多张图，朋友圈动态里图片显示的大小都不一样」，并要求统一（首条消息明确「统一为带多个图时显示的大小」）。
- 根因（headless 390×844 实测，不靠推理）：v3.5.94 的 `.feed-imgs` 九宫格基础规则本身是统一的（`repeat(3,1fr)` + `img{width:100%;aspect-ratio:1/1;object-fit:cover}`），但紧跟的三条按张数特判把它拆成三档——单图 `:has(img:only-of-type){max-width:66%}`（容器缩到 66% 却仍按 3 列分格 → 只落到第 1 列，约 22% 行宽）+ `img:only-of-type{aspect-ratio:auto}`（格高随原图比例自由变高）；双图改 `repeat(2,1fr)` + `max-width:80%`（约 40% 行宽，反而最大）。实测正文宽 324px：单图 67.3×100.9px（高宽比 1.5）／双图 126.6px／3、4、9 图 104px。
- 方案：删掉这三条特判，1/2/3+ 张一律每格 1/3 正文宽、1:1 裁切（图少时右侧留白）。渲染路径零改动（`feed.js` 的 `contentHtmlFor` 是单一出口，TA 发布／我的发布／全部朋友圈三处共用），顺带去掉了这两处对 `:has()` 的依赖。已知代价（用户明确要求统一到多图档尺寸）：单图在列表里不再是「原比例大图」，竖图/长图被裁成正方形缩略图，点图看大图链路不变。
- 验证：`node tools/verify-feed-img-size.mjs` **6/6**（直读 src/css、不需要构建；含反向对照——把删掉的三条规则追加回样式末尾能重现 67.3/126.6/104 三档不一致与单图高宽比 1.5）。哨兵 2 条 absent：`feed-imgs:has(`、`feed-imgs img:only-of-type`（特判被并行会话加回即报警）。`node --check build.mjs` 过。**待构建者**下次构建确认哨兵 131/131；真机复核：同一条动态分别发 1/2/3 张图 → 格宽一致、点图仍看大图、正文里混排的表情包并入图片网格后不再撑高。
- 跨域改动 build.mjs（AI-B 域）理由：#95 属删除型修复，按 AGENTS.md 回归防线登记 `absent` 哨兵（该机制正是为「删掉的规则被并行会话改回来」而设）。未碰对方在途文件（src/js/call.js 19:16 那条与 index.html/sw.js/version.json 产物）。附注：2026-08-30 防线审计指出 tools/ 下 144 个 verify 脚本无入口引用——本条已在 FIX-REGRESSION.md #95 行验证列直接写明 `node tools/verify-feed-img-size.mjs`，不留新孤儿。
- 顺带发现（不属本域、未改）：19:16 那条 call.js 条目与「> 上一构建」行被并发编辑粘在同一行了（该条目「验证」句尾直接接上 `> 上一构建：AI（sw mochi-mtfll2ag…）`），下次收口的人顺手断开即可。

### 2026-08-30 19:16（#94 续2：通话恢复失效根因——call-active 被命名空间迁移误删，改用 sessionStorage）
- [AI 域·call.js]（**改动文件：src/js/call.js；构建状态：已构建（sw mochi-mtfpsc6z，哨兵 129/129，verify 10/10）**）。
- 根因：call-active 存 localStorage 全局键 xy-home-v2:call-active，被 contacts.js 命名空间迁移 cleanupOld 当成旧顶层业务键迁进 default 桌面并删原键 → 刷新后 recoverCall 读原键为 null 不恢复（第一次刷新恢复后 call-active 被迁走，第二次起失效）。
- 方案：call-active 改用 sessionStorage（跨 reload 同 tab 保留、不被 idbRestore/迁移逻辑碰、关 tab 自然清除=通话断）。saveCallActive/clearCallActive/recoverCall 全改 sessionStorage。加兜底：__mochiDataReady 已 true 时直接 recoverCall，否则监听 mochi-restore-done（防事件早派发错过）。
- 验证：无头 Chrome 实测——植入 sessionStorage call-active 连续 3 次 reload，每次通话面板恢复 + 计时连续（34→38→42 秒）+ call-active 保持 present。node --check 过；构建哨兵 129/129；verify 10/10。> 上一构建：AI（sw mochi-mtfll2ag，哨兵 125/125 + sw.js 3/3，verify 10/10，已提交推送 main；收口 #92 + 工作区 #88-#91）

### 2026-08-30 19:08（#93 根本修复：mergeLists 字段级合并 + openLetter/openReply 重新 load 取最新完整数据）
- [AI-B 域·mail.js + FIX-REGRESSION.md]（**改动文件：src/js/mail.js（mergeLists/openLetter/openReply）、FIX-REGRESSION.md（#93 补根因）；构建状态：未构建（node --check src/js/mail.js 过）**）。
- 需求/反馈：用户补充关键线索——「回信后只有等联系人回了我的回信后才显示，之前无法点击查看只有空白」。据此定位根因（非 headless 可复现，靠代码推理）。
- 根因：`mailDbReady=false`（切桌面后 idbGet 未返回/启动早期）→ `load()` 降级读剥图快照（content 空）→ `submitReply` 用该 list 设 myReply 后 `save` → `mailMergeFromIdb` 合并 IDB 完整版（content 有 + myReply 空）与快照版（content 空 + myReply 有）时，`mergeLists` 原实现按 `letterLen` 整体取更大一方 → content 或 myReply 丢失 → 点开空白；TA 回信后 partnerReply 落地使整版 letterLen 最大胜出才显示。
- 方案：① `mergeLists` 改字段级合并——content/myReply/partnerReply/read 各取更完整一方（图片优先），不整体覆盖；② `openLetter`/`openReply` 开头重新 `load().find(id)` 取最新完整数据，覆盖 render list 传来的可能过期 l。
- 验证：node --check src/js/mail.js 过。待构建者 build 后跑 verify-mail-ios-reply.mjs + 真机红米 K80 Chrome：切桌面后回信再点开，content/myReply 不丢。
- 不构建、不提交，等构建者收口（本条为根本修复，与 f143621 防御性修复叠加）。

### 2026-08-30 19:07（#86 补强：遗留副本清理链两处缺陷——墙钟兜底 + LS 大键迁移排除，均反向对照实测）
- [AI-B 域·data-backup.js + idb.js + build.mjs(新增 2 条哨兵) + tools/verify-garden-dataloss.mjs + FIX-REGRESSION.md]（**改动文件：src/js/data-backup.js（`purgeOnce` 幂等包装 + 20s 墙钟兜底）、src/js/idb.js（LS→IDB 大键迁移排除副本键）、build.mjs（#86 两条新哨兵）、tools/verify-garden-dataloss.mjs（新增 Case D/E、修 `gotoPage` 导航提交竞态与 `harvestall` 误断言，共 27 项）、FIX-REGRESSION.md #86 行补写；构建状态：本会话未构建未提交——产物已被构建者会话随 f143621（sw mochi-mtfovmmr，哨兵 129/129）收口，两处补强在产物里实测在位（index.html:70343 `function purgeOnce()` / 20s 兜底 / idb 迁移排除在 14933 行）**）。
- 需求/反馈：用户追问「还有缺陷吗」→ 复核 #86 清理链自身，抓到两处真缺陷：不是副本功能本身，而是「清理在什么设备上根本不会跑」和「清理完又被谁复活」。
- 根因与方案：① 触发原来只有 `mochi-restore-done` 事件路径，而 #83 之后 12 秒保险丝不再设 `__mochiDataReady`（只派发 `mochi-restore-slow`）→ IDB 整轮挂起的设备上事件永不到达、清理一次都不跑，而 IDB 最慢、遗留副本最大的恰好是同一批机型；补 `purgeOnce()` 幂等包装 + `setTimeout(purgeOnce, 20000)` 墙钟兜底（照 idb.js `wrjMergeFromIdb` 挂起兜底同款做法；幂等包装让 #90 的「删→复核→重试」链只起一套，两条链并发会互相误判复核结果）。② `idb.js` LS→IDB 大键迁移未排除该键 → 以 LS 形态存在的副本（远古版本或手工改过的备份包）必然远超 `LS_BIG_LIMIT` 而被收进 `bigKeys`，整包读进内存 + 写回 IDB + 常驻 `memoryCache`，等于把刚清掉的副本复活一份还白钉几百 MB 堆；补 `continue` 排除，交给 purge。
- 验证（每处都做了反向对照，不靠推理）：撤 ① → Case E（`Page.addScriptToEvaluateOnNewDocument` 注入 `__mochiDataReady` 恒 false + `stopImmediatePropagation` 掐死事件）实测 35 秒副本一直在、E3 FAIL；撤 ② → Case D（播种 420045 字符 LS-only 副本 + 清 sessionStorage `xy-ls-big-migrated` 强制重跑迁移）实测 `window.idbGetCached` 命中 420045 字符、D1 FAIL。两处恢复后 `node tools/verify-garden-dataloss.mjs` **27/27**；哨兵审计 129 条 0 缺失；`npm run verify` 10/10；`grep -rn "TEMP-NEGATIVE-CONTROL" src/ tools/` 已清空。**待真机**：IDB 挂起机（小米 14U / iPhone XS）启动 20s 后 → 设置→查看存储/诊断，副本应已消失。
- **⚠ 需要构建者处理（一句话）**：`git show HEAD:src/js/idb.js` 第 918 行仍是 `// TEMP-NEGATIVE-CONTROL: if (k === 'xy-home-v2:__auto-backup-snapshot') continue;`——我做反向对照期间的形态被 f143621 夹带提交了（staged blob 未刷新，产物 index.html 反而是好的 → 线上行为正确、哨兵也没报，因为注释行里照样含 needle 子串）。工作区已改回有效行，`git status` 里的 `M src/js/idb.js` 就是这一行，**下次提交请把该文件带上**。附带好处：若谁从 HEAD 重新 build，`minifyJs` 会整行丢弃 `//` 注释 → 产物缺 needle → 该条哨兵会醒目报警，不会静默上线。
- 未动对方在途文件（19:06 红包封面 / mail.js / call.js 均未碰），本条只改 AI-B 域。WORKLOG 仍 4700+ 行、超 3000 行归档线，建议本轮收口后归档一次。

### 2026-08-30 19:06（红包封面支持我/TA 分别上传 + 七夕特别红包仅七夕当天显示）
- [跨域·chat.js]（**改动文件：src/js/chat.js；构建状态：未构建（node --check 过）**）。
- 需求/反馈：① 发红包只能上传"我的"封面，无法上传联系人（TA）的封面；② 红包面板非七夕仍显示"七夕特别红包"区块，应仅七夕当天显示。
- 根因：① rpCoverGet/Set 只用单键 'rp-cover'，不区分 rpSide（我发/TA发共用一封面），上传/删除/渲染/发送全操作同一份；② openRpPanel 非七夕分支 rpQixiSection.hidden=false，只藏了"今天七夕"标签，整块 ¥7.77/77.77/777.77 金额按钮仍可见。
- 方案：
  - 封面键按 side 拆为 'rp-cover-out'（我的）/ 'rp-cover-in'（TA 的）；rpCoverKey(side)/rpCoverGet(side)/rpCoverSet(side,dataUrl) 全部带 side。
  - rpRenderCover 用当前 rpSide 渲染，按钮文案动态变"上传我的/TA的封面""删除我的/TA的封面"，未设置时预览提示"未设置我的/TA的封面"。
  - 切换"我发/TA发"时调 rpRenderCover() 重渲染对应封面；上传/删除按钮用 rpSide；sendRedpacket 用 rpCoverGet(rpSide)；消息渲染按 rpCoverGet(rec.side) 各取各的封面；TA 主动发红包（trySystemAutoSend）用 rpCoverGet('in')。
  - 非七夕 rpQixiSection.hidden=true 隐藏整块（原 false 只藏标签）。
- 验证：node --check src/js/chat.js 过。待构建 + 真机：切"我发"上传图→只我发出的红包显示该封面；切"TA发"上传另一图→TA 红包显示该封面、我的红包不显示 TA 的图；非七夕打开红包面板无"七夕特别红包"区块，七夕当天（QIXI_DATES 含当日）显示。
- 跨域改动 chat.js（AI-A 域）理由：用户直接要求改红包功能，红包逻辑全在 chat.js。未改 template.html（封面区结构不变，文案由 JS 动态控制）。

### 2026-08-30 18:42（#94 续：加「刷新后恢复通话」设置项，开启后刷新继续通话）
- [AI 域·call.js + reply-settings.js + template.html]（**改动文件：src/js/call.js、src/js/reply-settings.js、src/template.html；构建状态：本会话已构建（sw mochi-mtfokb1w，哨兵 129/129，verify 10/10）**）。
- 需求/反馈：用户追问——能否恢复因刷新中断的通话，做成可设置。
- 方案：通话状态已持久化（call-active），刷新后可重建。callCfg 加 resume 字段（从 replyCfg['call-resume'] 读，默认 1）。recoverCall 改为：call-resume 开启 + connectedTime 有值 → 重建 currentCall{status:'connected',connectedTime} + 显示通话小框/大面板（callMiniEnabled 决定）+ startCallDuration 从接通时刻继续计时（startCallDuration 改为不覆盖已存在的 connectedTime）；关闭 → 记中断记录（原 #94 逻辑）。设置项「刷新后恢复通话」加在通话设置页（toggle 开关，reply-settings 默认 call-resume:1 + 三处开关绑定数组注册）。TA 本地模拟无需重连，恢复=恢复本地 UI+计时+概率挂断定时器；恢复后挂断走正常 endCall 记正常记录（时长含刷新前+后）。
- 验证：node --check 过；构建哨兵 129/129；verify 10/10；产物含 call-resume/recoverCall/开关 UI。待真机：接通→刷新→通话面板恢复计时继续；关闭开关→刷新→主页通话记录红色中断条目。
### 2026-08-30 18:2x（修复：红米 K80 Chrome 信箱回信/寄信后列表空、看不到回信与寄出信内容 → FIX-REGRESSION #93）
- [AI-A 域·mail.js + build.mjs(哨兵 needle) + FIX-REGRESSION.md]（**改动文件：src/js/mail.js（submitReply/sendLetter/openLetter/render 四处防御）、build.mjs（#93 哨兵 needle）；构建状态：未构建（node --check src/js/mail.js 过）**）。
- 需求/反馈：红米 K80 Chrome 信箱里点联系人的信回了信，不显示内容；重新点这封信也看不到回信；寄出的信也不显示内容。用户补充「信箱顶部列表里就是空的，完全没有我写信的内容，什么也没有」，纯文字和含图片信件都不显示。
- 根因（如实说明）：**headless Chrome 390×844 移动端 UA + ce-box 转换 + 真实打字 + 含图片信件多轮复现均正常**（aa1bd3e 线上产物与工作区 mochi-mtfll2ag 产物都正常：寄信后 outItems=1、回信 myReply 保存并显示、openLetter 正文/图片渲染无误），**真机红米 K80 Chrome 的差异无法在 headless 复现**。按最可能根因做防御性修复：
  - **① submitReply（确认的 UX bug）**：原实现 `showPage('page-mail')` 后**不 `selectMailTab`**，回信后停在旧 tab（常是「寄出的信」），用户看不到刚回信的来信、以为回信没成功→补 `selectMailTab('in')`，并在 `showPage`+`selectMailTab` 让 DOM 可见后再 `render()`。
  - **② sendLetter**：原实现 `render()` 在 `showPage` 之前，page-mail 仍 hidden 时写 innerHTML，个别安卓内核对 hidden 元素 innerHTML 渲染延迟→改为 `showPage`+`selectMailTab` 后再 `render()`（双渲染兜底，零副作用）。
  - **③ openLetter**：`openTCPanel` 后若 tc-body 无 `.mail-paper`（渲染未生效）重试注入 html。
  - **④ render()**：列表项数与 inList/outList.length 不符时重试 innerHTML（防御 hidden 元素渲染延迟）。
- 验证：node --check src/js/mail.js 过。**待构建者** build 后跑 `node tools/verify-mail-ios-reply.mjs`（信箱回信回归）+ 真机红米 K80 Chrome 复测：寄信→「寄出的信」tab 立即看到信件；回信→「收到的信」tab 立即看到来信带「已回信」标签；点开信件正文/回信内容正常显示。
- 未验证部分（如实说明）：本会话不构建，**真机红米 K80 行为没有被任何真实浏览器跑过**，四项修复均为防御性（不改变正常路径逻辑，只加重试与 tab 切换），低风险但根因未 100% 确认。若真机升级后仍复现，需用户协助在 Chrome console 跑诊断代码（读 activeStore().get('mail-letters') + DOM 列表项数）定位。
- 不构建、不提交，等构建者收口。

### 2026-08-30 18:31（修复：接通后刷新页面通话中断不记录、主页通话记录无中断标识 → #94）
- [AI 域·call.js + records.js + chat-pages.css + dark.css]（**改动文件：src/js/call.js、src/js/records.js、src/css/chat-pages.css、src/css/dark.css；构建状态：本会话待构建**）。
- 需求/反馈：用户报障——每次刷新网站，进行中的通话（已接通）中断后，没有显示在主页【通话记录】里，也没有与正常挂断区分。
- 根因：currentCall 只存内存（call.js:164），刷新时 JS 上下文销毁，endCall→notifyCallEnd→addCallRecord 不触发 → 通话记录丢失。原 visibilitychange 仅处理响铃中切后台（记"未接听"），已接通状态刷新/关闭无任何处理。渲染（records.js:332）只区分 in/out 方向，不区分中断/挂断。
- 方案：
  - call.js：通话进行中状态持久化到全局键 xy-home-v2:call-active（bindCall/answerCall/去电接通时 saveCallActive 写 cid/direction/connectedTime 等；endCall 时 clearCallActive）。启动恢复：监听 mochi-restore-done（此时 records-call 已从 IDB 回填，unshift 写回不覆盖）→ 检测 call-active 残留且 connectedTime 有值 → 补写 {type,text:"通话中断（页面刷新或异常退出）· 时长 xx",ts,ended:"interrupt"} 到归属桌面（storeFor(cid)）records-call + IDB + 补聊天系统消息（chatAddSystem/chatAppendToDeskMsg）。
  - records.js：渲染时 x.ended === "interrupt" → listitem 加 .tc-call-interrupt + 标题行加红色「中断」标签 chip；暴露 window.__renderHomeCall 供恢复后刷新。
  - chat-pages.css + dark.css：.tc-call-interrupt（红色左边框+浅红底）+ .tc-li-interrupt-tag（红底白字小标签）样式 + 暗色适配。
- 验证：node --check call.js/records.js 过。待构建 + 真机：接通通话→刷新→重进主页通话记录出现红色「中断」条目（含时长）；正常挂断仍原样无中断标签；崩溃/划掉同效。
- 跨域：call.js 属 AI-B 域，records.js/chat-pages.css/dark.css 属 AI-A 域，本次按构建者统一收口。
### 2026-08-30 18:15（新增诊断字段：字卡/回复/收藏 存储明细，便于手机端报障 583MB 来源）
- [AI-A 域·chatcard.js + 跨域 device.js]（**改动文件：src/js/chatcard.js（末尾挂 window.__ccStorageDiag）、src/js/device.js（诊断【数据】节 839 行后加 6 行调用，已有 __replyPoolDiag 同款跨域先例）；构建状态：未构建（node --check 两文件全过）**）。
- 需求/反馈：用户在「查看存储」看到「字卡/回复/收藏 514 键 583.6MB」怀疑有错误，但电脑无数据、只能在手机测，无法用 DevTools Console 跑诊断脚本。希望在设置→复制诊断信息里加字段方便远端判断。
- 方案：chatcard.js 挂 `window.__ccStorageDiag()`（返回 Promise<string>）——遍历 LS + IDB（idbListKeys/idbGetMany），按 personalize.js:5247 同款正则归「字卡/回复/收藏」类，输出：① LS/IDB/合计 键数+大小 ② Top15 大键 ③ ⚠ LS 残留大键（>200KB，应已迁 IDB，残留=双倍计算）④ ⚠ 旧各桌面 my-emoji-groups 遗留（应只剩全局一份）⑤ 各桌面专属 cc-groups 大小 ⑥ 公用 cc-groups-public 大小。只读不写。device.js 跨域加 6 行异步 job 调用（照 846 行 IndexedDB 大键明细同款 jobs.push 占位行模式）。
- 跨域改动 device.js 理由：诊断信息是用户唯一可在手机回传的报障面，__ccStorageDiag 挂在 chatcard.js（AI-A 域），device.js 诊断【数据】节需读它；已有 __replyPoolDiag（839 行）同款跨域先例，本次仅加 6 行调用，未改 device.js 既有逻辑。
- 验证：node --check chatcard.js / device.js 全过。未构建，待构建者收口后用户手机刷新→设置→复制诊断信息，【数据】节会出现「字卡/回复/收藏明细：」段，贴回来即可定位 583MB 真凶（大键/LS 残留双倍/旧各桌面遗留）。
- **需要对方处理（AI-B，一句话）**：device.js 839 行后我加的 6 行 `__ccStorageDiag` 调用，若你方重构诊断【数据】节请保留这段调用（或合并进你的结构）。函数本体在 chatcard.js（AI-A 域），你方无需维护。

### 2026-08-30 17:5x（#88 复核收口：D 项告知改自带 #cc-toast 渲染，并发现全项目 `window.toast` 死全局）
- [AI-B 域·device.js + build.mjs(哨兵 needle)]（**改动文件：src/js/device.js（#88 D 项末尾 IIFE）、build.mjs（#88 device.js 那条哨兵 needle）；构建状态：未构建（`node --check` device/contacts/bg-keep/chat 四文件全过）**）。
- 触发：用户追问「确定没有错误吗」，我按产物实测复核而不是复述代码，抓到自己一处真错。
- **根因（我的错）**：#88 D 项「LS 失效当场告知」原写 `window.toast(...)`。`node -e` 复现 + 全项目 grep 证明 **`window.toast` 从未被赋值**：build.mjs 把每个 JS 文件单独包进 `(function(){try{…}catch{…})()`（build.mjs:86-89），`src/js/chat.js:5674` 顶层的 `function toast` 只是文件内私有，挂不上 window；产物里 `window.toast =`（排除 `=== 'function'` 判断）命中 **0 次**。原代码的 `typeof !== 'function' → setTimeout 重试 20 次` 会静默空转 10 秒然后什么都不显示，等于修复没生效且无人报错。
- 方案：**不依赖任何外部 toast**，device.js 内自带一份 `#cc-toast` 渲染（同 id + `.show` 类，样式由 chat-pages.css:155-173 全局提供，与 chat.js `toast()` 同款实现），并按 `.splash`（z-index 999）压在 toast（99）之上这一事实**等开屏 `.hide` 后再说**（500ms×120 上限），`sessionStorage` 标志保证一会话一次。
- 哨兵：#88 的 device.js 那条 needle 从 `__lsStatus`（两版都在，测不出这次回退）改为用户可见文案 `本机浏览器本地存储受限`。**总数不变（仍 6 条 #88）**。
- **需要对方处理（AI-A，一句话）**：`window.toast` 死全局导致 **6 处调用静默失效**——`cjian.js:45`、`ck-question.js:119`、`device.js:1172 diagToast`、`incoming-requests.js:118/377`、`p2-features.js:1448`、`ta-invite.js:45`（查岗提示、设置导入导出提示、诊断提示全都不弹）。最省的做法是在 `chat.js` 顶层 `function toast` 之后补一行 `window.toast = toast;`（chat.js 在 device.js 之后加载，且这些调用点全部已写 `typeof window.toast === 'function'` 保护，加了立刻全活）。属 AI-A 域文件，我未擅自改。
- 运行时验证（本轮补做，真无头 Chromium + CDP，临时脚本按规矩已删）：把 `src/js/device.js` 末尾这段 IIFE 连同 chat-pages.css 的 `#cc-toast` 真实样式注入页面，用 `Storage.prototype.setItem` 拦截让写探针抛 `QuotaExceededError` → `window.__lsStatus = "unwritable(QuotaExceededError)"`；页内实测 `typeof window.toast === "undefined"`（死全局坐实）；开屏 `.splash` 在场时 `#cc-toast` **不存在**（不抢话、不被 999 层盖住）→ splash `.hide` 后 toast 出现 `class="cc-toast show"`、`opacity:1`、`z-index:99`、矩形在视口内、文案逐字正确 → 2.6s 后 `opacity:0` 自动消失。**6/6 全过**。仍未验证的两块：①整包集成（本测试只跑这一段，不与 idbRestore/contacts 同场），②小米 14U 真机上 LS/IDB 的真实表现——产物 `index.html`（17:41）里还是旧版本，需构建者再 build 一次后才谈得上线上生效。
- #88 其余三项（A 桌面校正 / B 后台开关重应用 / C authOk 防整包覆盖）本轮复核与 #90 会话改动**共存无冲突**：`chat.js` 现在 `authOk` 闸门在前、`chatLedgerGuard` 在后，守卫拒绝路径仍会暂存 `pendingLocal` 并限流强制 `loadMsgs(true)`，不存在「两道闸互相顶死导致永不落盘」。

### 2026-08-30 17:5x（修复：手机后台浏览器弹窗「TA的吃饭提醒」重复弹两条 → FIX-REGRESSION #93）
- [AI-A 域·p2-features.js]（**改动文件：src/js/p2-features.js（eatRemindFire 删一行冗余 bgNotifyCheck + 注释）；构建状态：未构建（node --check 过）**）。
- 需求/反馈：用户报障，手机后台浏览器弹窗「TA的吃饭提醒」会重新提醒变成两条（截图：17:47:43 标题「TA」+ 17:47:44 标题「TA的吃饭提醒」，正文同为「糖醋排骨 挺好的，去吃这个吧」）。
- 根因：eatRemindFire 同时调 ① chatAddIn(text,{tag:'吃饭提醒'}) ② 手动 bgNotifyCheck(text,...,{name:'TA的吃饭提醒'})。但 chatAddIn→addIn→addRec 在后台时已由 showDeskMsg→showDeskPopup(isHidden)→bgNotifyCheck 发一条通知（标题 chatPartnerName()=「TA」，chat.js:2477-2479/2346-2352/2288-2291）；手动那次又发一条（标题「TA的吃饭提醒」）。bgNotifyCheck 去重指纹 markNotified 在 showSysNotification 异步 resolve 后才登记（bg-keep.js:1151-1153），两次调用同步背靠背 → 第二条查 notifiedDup 时第一条还没登记 → 两条都过闸门都弹出。
- 方案：删掉 p2-features.js:2919 那行手动 bgNotifyCheck，通知统一由 chatAddIn 内部发一条（标题=联系人名，符合「TA 主动发消息」世界观，且与喝水提醒等其他系统功能同款——它们只走 chatAddIn 不手动 bgNotifyCheck）。前台行为不变（原手动那条前台 markSeen 返回不发通知），仅后台少一条冗余。
- 验证：node --check src/js/p2-features.js 过。**待构建者**：收口后真机验证——饭点窗口内后台浏览器收到吃饭提醒只弹一条通知（标题=联系人名），不再两条；聊天记录里仍是一条带「吃饭提醒」tag chip 的消息。
- 跨域改动 p2-features.js（AI-A 域），理由：根因就在该文件多调了一次 AI-B 域的 bgNotifyCheck，删冗余调用是最小最安全的修法；未动 bg-keep.js。不构建、不提交，等构建者收口。

### 2026-08-30 17:4x（修复：部署站「网页还没加载完就能进、进去数据不全/还在加载」+「切桌面打开聊天记录要等好几秒、没有加载进度提示」）
- [AI 域·clock.js + chat.js + chat-main.css + template.html + build.mjs(哨兵) + FIX-REGRESSION.md + WORKLOG.md]（**改动文件：src/js/clock.js、src/js/chat.js、src/css/chat-main.css、src/template.html；构建状态：本会话已构建（哨兵 127/127、sw.js 3/3、verify 10/10）**）。
- 需求/反馈（同一用户会话）：①「为什么部署的 github 链接总是浏览器还没把网页加载完成就能点击进入，进入之后数据不完整，点进去发现网页还在加载」；②「切换桌面联系人，打开【聊天】页面，里面的聊天记录要加载好几秒才显示」；③「切换桌面联系人的时候没有进度条的弹窗显示数据加载的进度」。
- 根因：①进入门控此前**只等「数据就绪」（`__mochiDataReady`）**——GitHub Pages 国内冷启动资源慢、数据恢复又超 12s 时，idbRestore 保险丝派发 `mochi-restore-slow`，开屏「仍要进入」逃生口在浏览器还没拉完页面时就出现，点进半加载页面（数据不全的实况）；另一可能是设备 PWA 还在跑旧缓存（旧版 12s 保险丝静默放行，正是 #83 已修的 bug）。已核对线上是最新（部署于 2026-08-30 16:53）。②③ 切桌面后 `contact-switched` 只清空 msgs/置 `chatDbReady=false` 并武装 15s 保险丝，**不预读**；用户点开聊天 `enterChat` 才发 `loadMsgs` → IDB 异步读库期间消息区空白无任何反馈（且冷加载无本地待合并时 `changed=false`，读库完成后原路径不重渲，记录要到下次触发渲染才出现）——正是「要等好几秒」+「没有进度提示」。
- 修复：
  - **clock.js（进入门控）**：新增「页面加载完成」门控 `windowLoaded`（window load + readyState complete 双保险；30s 兜底防个别资源挂起时 load 永不触发导致开屏卡死）；「点击进入」「仍要进入」都要求页面加载完成才放行；加载文案按状态区分「正在加载数据…/数据较多，仍在加载…/正在加载页面…」（数据就绪但页面未加载完时如实提示）；`enter()` 守卫补 `loaded()`。
  - **chat.js（聊天记录加载）**：①`contact-switched` 时立即 `loadMsgs()` **预读**新桌面记录（用户导航/点开聊天前读库已在跑，打开时往往已就绪）；②`loadMsgs` 读库完成后若聊天页开着且消息区仍空（冷加载 changed=false 原路径不重渲）→ 补渲染一次；③新增 `updateChatLoading()` + `enterChat` 显示 / `renderWindow`·保险丝·切桌面 隐藏，消息区中央覆盖**非阻塞进度条**（`pointer-events:none` 不挡滚动/点击）「正在加载聊天记录…」，读库完成自动消失。④保险丝就绪后同样隐藏进度条。
  - **template.html + chat-main.css**：`#chat-loading` 卡片（白底圆角卡 + 黑色滑动进度条动画 + 文案），绝对定位覆盖消息区。
- 验证：node --check 全过；node build.mjs 成功（哨兵 127/127、sw.js 3/3）；node tools/verify.mjs 10/10。**待真机（弱网冷启动）**：①页面加载完成前「点击进入/仍要进入」都不出现，页面加载完成后数据仍未就绪才见「仍要进入」；②切桌面→立即点开聊天→消息区出现进度条（快速设备可能一闪而过或直接显示记录）→记录出现进度条消失；③发送消息/切页正常，进度条不遮挡消息区操作。

### 2026-08-30 17:3x（互动卡片展开收藏时显示发送时间，精确到秒）
- [AI-A 域·chat.js + chat-main.css]（**改动文件：src/js/chat.js（favHeartHtml 改为接受 rec，心形后拼 .msg-fav-time 时间标签；16 处调用传 rec）、src/css/chat-main.css（新增 .msg-fav-time + .show-fav 显示规则）；构建状态：未构建（node --check 过）**）。
- 需求：聊天互动卡片点击展开收藏心形时，也显示该卡片是联系人什么时间发送的，时间精确到秒。
- 方案：favHeartHtml(rec) 在心形按钮后拼接 `<div class="msg-fav-time"><发送者> HH:MM:SS 发送</div>`，发送者按 rec.side 取 chatUserName/chatPartnerName；fmtTime 已精确到秒；CSS 默认 display:none，.msg-ask-card.show-fav / .msg-choose-card.show-fav 时与心形一同 display:block + favFadeIn 动画。红包/花/礼物/佳肴卡片心形目前无 show-fav toggle（既有，不在本次范围），favHeartHtml 已统一支持，后续加 toggle 即自动生效。
- 验证：node --check src/js/chat.js 过；16 处调用全部传 rec，无残留 favHeartHtml()。
- 不构建、不提交，等构建者收口。

### 2026-08-30 17:2x（修复：iPhone 15 Plus 进「系统预设字卡」能滑、点【返回】卡住且卡回去后整页持续卡 → 字卡库列表改真虚拟窗口，FIX-REGRESSION #91）
- [AI-A 域·default-cards.js + chatcard.js + chat-pages.css]（**改动文件：src/js/default-cards.js（`mountCardView` 渲染改视口虚拟窗口）、src/js/chatcard.js（`refreshLibCounts` force 分支走带缓存 `pubGroupsRaw()`）、src/css/chat-pages.css（新增 `.cc-vspace` + 标注 v3.11.x「全量渲染对性能无影响」旧结论已被推翻）**；构建状态：**代码本体已由构建者会话随本轮 build 收口（sw mochi-mtfll2ag，哨兵 125/125 含本条新增 4 条）**；本会话自身未构建、未提交）。
- 需求/反馈：用户报「iPhone 15 Plus + Safari/Edge/Chrome 三浏览器一致：点进系统预设字卡可以滑动，但点返回就开始卡住，即便卡回去了整个页面也会变得非常卡」。给出两个决策：渲染改**真虚拟滚动窗口**（不是懒加载批次、不是分页），并**一起修**「每次返回重新 JSON.parse 自定义字卡大库」。
- 根因（headless 390×844 实测，非猜测）：该页把当前分类整包铺进 DOM——main 4903 行 = **33221 节点 / 4628 个 checkbox**，全站节点 1.08 万 → 3.3~4.4 万。①返回时各页 `MutationObserver` 的选择器扫描被膨胀文档放大：长任务 [104,57]ms、点击到两帧 161.9ms；②iOS 上三个浏览器都是 WebKit，`display:none` 要销毁数万渲染对象、再进时整棵重建 → 「返回那一刻卡死」；③返回后 33221 节点常驻不释放 → 之后每次切页都付税＝「整页持续卡」，二次进入仍 524.6ms。旧根因文档（chat-pages.css v3.11.x 注释）写着「全量渲染对性能无影响」，是本次踩坑依据，已就地标注推翻。
- 方案：`mountCardView`（dc/fc/dk 三库共用，一处改三处生效）①数据拉平成 `flat`（`{header}` / `{c,cat}`）+ `Float64Array` 高度与前缀和 + 二分 `indexAt`，只渲染视口 ±0.8 屏（条目数下限 24）；②顶/底 `.cc-vspace` 占位块撑回全高（滚动范围 269786px 与旧版一致＝全量行仍可达，用户看不出差别）；③**先写后读**测高（连续 `offsetTop` 差值，末行走底部占位块）后按 `delta` 静默补正 scrollTop，未实测条目用均值估高；④滚动容器**动态判定**：`clipsContent` 启发（overflowY 可滚且真的溢出）+ capture 阶段 `document` 上的 `scroll` 事件用 `e.target` 锁定，兼容 dc 页由 page 滚 / fc 列表自滚 / 窗口滚动三种形态（写死容器会选到 `min-height:auto` 被撑高、永不裁剪的 `.card-list`，窗口就再也不推进）；⑤rAF 合并 + containment 迟滞 + `hidden` 变化重排；⑥跨 tab 搜索结果按真实分类 `rec.cat` 写开关（委托监听照旧）。
- 验证：新建 `tools/verify-preset-card-window.mjs`（20 项，**可提交资产**）：DOM 有界／滚动范围保留／窗口随滚动推进／末条＝该分类数据末条／可见区无占位空白／返回无 ≥50ms 长任务／二次进出不退化／单卡开关写对 `dc-off-<分类>:<文案>`／搜索收窄与恢复／功能字卡页同规则。新产物 **20/20**；用 `git show HEAD:index.html` 造旧产物对照 **12/20**（失败项恰是 DOM 有界／窗口推进／返回长任务／残留四类）。实测新产物：全站节点 10850→11284、列表子树 154~285、返回两帧 26.6ms 且零长任务、二次进入 43.8ms／返回 48ms。**局限：以上均为 headless Chrome 数字，WebKit 的渲染树销毁/重建成本无法在无头环境复现 → 需真机 iPhone 复核。**
- 跨域改动（tools/ 属 AI-B，本会话按 AI-B 侧处理，理由：**#91 窗口化会让三个既有 verify 脚本的「整表渲染」断言失效，属于必须同步的测试资产**）：`tools/verify-water-chat.mjs`（先点「梦角催喝水」分组 chip 再断言组头/卡片数，用完复原「全部」）、`tools/verify-period-care.mjs`（C6~C8 前先点「经期关心」chip；另修 C10 期望 tab 表漏 `音乐` 导致 31/32 误报，与 #91 无关）、`tools/verify-ta-gender.mjs`（「喝水 tab 6 组 30 张」改为遍历各分组 chip 累加渲染数）。三个脚本修后 24/24、32/32、22/22 全过；`npm run verify` 10/10。**待构建者**：这些脚本的断言若再出现「渲染条数明显少于数据条数」，先想是不是窗口化，别改回全量渲染。
- 需要真机验证（用户侧）：iPhone 15 Plus 三个浏览器分别测 ①进「系统预设字卡」→ 滑到底 → 点返回，是否还卡；②返回后立刻切聊天/设置页是否流畅；③「其他互动功能字卡」「查岗回应字卡」两页滚动+搜索是否正常；④单卡开关灰态与刷新后是否保持。诊断信息（设置→诊断）若再出现「返回后整页卡」请一并回传。
