// ===== 功能：导出数据 / 导入数据 =====
// 导出：收集全部本地数据（localStorage + IndexedDB 音乐文件/字卡/查岗记录）打包为 JSON 下载
// 导入：读取备份 JSON，确认后覆盖恢复并刷新页面
// v3.5.24 修复手机端导入丢数据：
//  - 写 localStorage 前先按字节估算总大小，超出配额的大键（聊天图片/头像库等）自动删掉并计数，
//    保证昵称/设置/聊天文字记录等小键全部恢复成功（不再因超配额静默丢数据）
//  - 写入失败逐条回滚（还原被清掉的旧值），不会出现"清空后写一半"的情况
//  - IndexedDB 改为逐条顺序写入（不再用 Promise.all 一拥而上，手机内存压力大时容易失败）
//  - 兼容旧 iOS 的 <input type=file> 读取（File.text() 老版本不支持时改用 FileReader）
(function () {
  // 容量余量：给正在运行的其他功能留一点（手机 localStorage 约 5MB，桌面 10MB）
  const LS_HEADROOM = 512 * 1024;
  // v3.7.0 引入、v3.29.x 下线：自动备份副本键。原设计是每次手动导出时把整包 JSON 再复制
  // 一份进 IndexedDB，供「数据几乎全空」时启动弹窗恢复。现已彻底不再写入，本常量只剩两个用途：
  //  ① 导出时排除该键（防自包含无限增长）；② 启动时清理旧版本遗留的那份副本（purgeLegacySnapshot）。
  const SNAPSHOT_KEY = 'xy-home-v2:__auto-backup-snapshot';

  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2600);
  }

  // v3.5.113：导入进度缓冲——读取/解析大备份（上百 MB）与逐条写入都需要时间，
  // 用全屏遮罩 + 进度条明确显示进度，避免用户以为卡死/没反应。
  function impEl() {
    let el = document.getElementById('cc-import-progress');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cc-import-progress';
      el.className = 'cc-import-progress';
      el.innerHTML = '<div class="cc-ip-box">' +
        '<div class="cc-ip-title" id="cc-ip-title">正在导入…</div>' +
        '<div class="cc-ip-bar"><div class="cc-ip-fill" id="cc-ip-fill"></div></div>' +
        '<div class="cc-ip-sub" id="cc-ip-sub"></div></div>';
      document.body.appendChild(el);
    }
    return el;
  }
  function impShow(title, sub, pct) {
    const el = impEl();
    el.hidden = false;
    const t = document.getElementById('cc-ip-title');
    const s = document.getElementById('cc-ip-sub');
    const f = document.getElementById('cc-ip-fill');
    if (t) t.textContent = title;
    if (s) s.textContent = sub || '';
    if (f) f.style.width = (pct == null ? '' : Math.max(0, Math.min(100, pct)) + '%');
  }
  function impHide() {
    const el = document.getElementById('cc-import-progress');
    if (el) el.hidden = true;
  }

  // 估算字符串体积（UTF-8 字节，用于配额判断）
  function byteLen(s) {
    if (s == null) return 0;
    if (typeof s !== 'string') s = JSON.stringify(s);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0xD800 || c > 0xDFFF ? 3 : 4;
    }
    return n;
  }

  // v3.9.x：本地时间格式化——toISOString() 是 UTC，直接 slice 显示会比本地时区早/晚数小时
  //（中国 UTC+8 显示时间早 8 小时），用户反馈"导入时显示的时间不对"。
  // 统一用此函数把 ISO 字符串转成本地时间 "YYYY-MM-DD HH:MM" 显示。
  function fmtLocalTime(iso) {
    if (!iso) return '未知';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '未知';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // 本地日期字符串（用于导出文件名，凌晨导出不会变成前一天日期）
  function localDateStr(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // 兼容旧 iOS：读取文件文本（File.text() 不支持时退回 FileReader）
  function readFileText(file) {
    return new Promise((resolve) => {
      if (typeof file.text === 'function') {
        file.text().then(resolve).catch(() => readViaReader());
      } else readViaReader();
      function readViaReader() {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => resolve('');
        r.readAsText(file, 'utf-8');
      }
    });
  }

  // 导出：localStorage + IndexedDB
  // v3.5.97：不受任何大小限制——按 IndexedDB / localStorage 实际数据全量导出。
  //   音乐文件、图片、聊天记录全部包含；导入时大键进 IndexedDB、小键进 localStorage，完整还原。
  async function doExport() {
    // v3.xx：导出进度遮罩——大备份（音乐/语音/图片全量）读取+打包要花时间，
    // 不能只弹一个 toast 让用户干等。复用 import 的进度遮罩，结束再隐藏。
    impShow('正在导出…', '正在读取全部数据', 3);
    const data = { version: '1.0', app: 'mochi-zika', exportTime: new Date().toISOString(), ls: {}, idb: {} };
    const add = (k, v) => {
      // 大键只进 data.idb（单镜像，导入进 IndexedDB）；小键进 data.ls
      if (byteLen(v) > 20 * 1024) data.idb[k] = v;
      else data.ls[k] = v;
    };
    // v3.27.x：修复「导出的聊天记录不是最新」——原实现先从 localStorage 把所有大键收进 data.idb，
    // 下面 IndexedDB 循环再用 `k in data.idb` 跳过，导致聊天记录永远取 localStorage 的「有损快照」
    //（chat.js 的 LS 快照超过 2MB 上限后不再更新、会冻结在旧时刻，且剥图/截断长文本），
    // IndexedDB 里的权威全量版（含图片/语音、最新消息）从未被导出。改为：
    //  ① LS 只收录小键（≤20KB，LS 是最新同步快照）；大键记入 lsBig 作兜底，不提前占位 data.idb；
    //  ② 大键一律从 IndexedDB 读权威值（双写键以 IDB 为准）；IDB 读失败/无此键再回落 LS 兜底。
    const lsBig = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('xy-home-v2:') !== 0) continue;
        if (k === SNAPSHOT_KEY) continue; // v3.7.0：副本键不进导出文件（防自包含无限增长）
        const v = localStorage.getItem(k);
        if (byteLen(v) > 20 * 1024) lsBig[k] = v; // 大键：留待 IndexedDB 权威读取
        else data.ls[k] = v;
      }
    } catch (e) {}
    // IndexedDB：音乐文件、字卡、聊天记录等全部权威数据
    // v3.9.x：修复"无法导出当前的所有数据"——原实现整个 for 循环包在一个 try-catch 里，
    // 某个键的 idbGet/arrayBuffer/btoa 抛错会终止整个循环，后续键全部丢失（导出文件缺数据）。
    // 改为每个键单独 try-catch：一个键失败只跳过该键，不影响其余键导出。
    // v3.26.x：权威键（chat-msgs/feed-posts）LS 是有损快照（剥图/截断或大键不进 LS），
    // IDB 才是完整权威值。这类键即使 LS 小键已收录也必须读 IDB 权威，否则导出有损快照
    //（丢图片/语音/长文本），跨浏览器导入后聊天记录/朋友圈丢失（用户反馈 Safari 导出→
    // Chrome 导入丢数据）。IDB 失败时从 memoryCache 兜底（idbRestore 回填值/本会话写入值），
    // 仍失败则记录到 exportMissing，导出结束明确提示用户备份可能不完整。
    function isAuthorityKey(k) {
      return /:chat-msgs$/.test(k) || /:feed-posts$/.test(k);
    }
    const exportMissing = []; // 权威键降级记录（只剩有损快照或丢失）
    // v3.26.x #90：键清单改走严格三态接口 idbListKeys（数组=权威清单 / null=没读到）。
    // 原 `idbGetAllKeys() || []` 把「挂起/超时」也当空库 → 导出一份只含 LS 小键的文件，
    // 末尾还提示「全部数据完整」：LS 整库失效的设备（本次报障的小米 14U Edge）上那是
    // 一份近乎空的备份，用户信了就清原设备 = 真丢。清单没读到一律中止、如实提示重试。
    if (window.idbListKeys || window.idbGetAllKeys) {
      let idbKeys = null;
      try {
        idbKeys = window.idbListKeys ? await window.idbListKeys() : ((await window.idbGetAllKeys()) || []);
      } catch (e) { idbKeys = null; }
      if (idbKeys === null) {
        impHide();
        if (window.openModal) {
          window.openModal('导出未完成', '', function () {}, {
            noInput: true, okText: '知道了',
            staticText: '没能读到本地数据库清单（浏览器存储繁忙或超时）。\n' +
              '为避免生成一份「看着完整其实缺数据」的备份，本次导出已中止。\n' +
              '请回到桌面稍等十几秒后再点「导出数据」；若多次失败，重启浏览器再试。'
          });
        } else {
          toast('导出未完成：未能读取本地数据库，请稍候重试');
        }
        return;
      }
      const idbTotal = idbKeys.length;
      let idbDone = 0;
      for (const k of idbKeys) {
        idbDone++;
        if (idbTotal) impShow('正在导出…', '正在读取全部数据 ' + idbDone + ' / ' + idbTotal, 8 + Math.round(idbDone / idbTotal * 60));
        try {
          if (k.indexOf('xy-home-v2:') !== 0) continue;
          if (k === SNAPSHOT_KEY) continue; // v3.7.0：副本键不进导出文件
          // 权威键不跳过（LS 有损快照不能代替 IDB 权威值）；双写一致键 LS 小键已收录则跳过
          if (k in data.ls && !isAuthorityKey(k)) continue;
          let v = await window.idbGet(k);
          if ((v === undefined || v === null) && lsBig[k] === undefined) {
            // IDB 读取失败且 lsBig 无兜底（典型场景：>200KB 的 IDB-only 键，xyStore 已从 LS 删除，
            // doExport LS 阶段遍历不到 → 无 lsBig 兜底；IDB 事务挂起/超时失败后该键会被静默跳过丢失）。
            // 重试一次给 IDB 连接恢复机会，读数之间不写进度以减轻 IO 竞争。
            v = await window.idbGet(k);
          }
          if (v !== undefined && v !== null) {
            // v3.6.x：本地音乐改存 Blob 后，备份导出需转成 dataURL 字符串（JSON 无法存 Blob），
            // 导入时由 add() 恢复为字符串 → 播放路径自动识别转回 Blob
            if (v instanceof Blob) {
              const buf = await v.arrayBuffer();
              const bytes = new Uint8Array(buf);
              let bin = '';
              const chunk = 0x8000;
              for (let i = 0; i < bytes.length; i += chunk) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
              }
              add(k, 'data:' + (v.type || 'audio/mpeg') + ';base64,' + btoa(bin));
            } else {
              add(k, v); // 权威值以 IDB 为准（含最新聊天记录）
            }
            delete lsBig[k]; // 已收录 IDB 权威值，不再回落 LS 兜底
            // 权威键已拿到 IDB 完整值，删 data.ls 里可能有的 LS 有损快照，避免导入时混入
            if (isAuthorityKey(k) && (k in data.ls)) { try { delete data.ls[k]; } catch (e) {} }
          } else if (window.idbGetCached && window.idbGetCached(k) !== undefined) {
            // v3.26.x：IDB 读取失败/超时，从 memoryCache 兜底（idbRestore 回填的大键 /
            // 本会话 xyStore.set 写入值）。Safari 等 IDB 事务易挂起的浏览器上，启动时
            // idbRestore 已慢慢回填进 memoryCache，导出时并发 idbGet 失败也能拿到最新值。
            add(k, window.idbGetCached(k));
            delete lsBig[k];
            if (isAuthorityKey(k) && (k in data.ls)) { try { delete data.ls[k]; } catch (e) {} }
          } else if (lsBig[k] !== undefined) {
            // IDB 无此键 / 读取失败 / 超时 → 回落 localStorage 兜底（至少不丢）
            add(k, lsBig[k]);
            delete lsBig[k];
            // v3.26.x：权威键回落 LS 兜底，可能是有损快照（chat-msgs 剥图/截断）→ 记录降级
            if (isAuthorityKey(k)) exportMissing.push(k);
          } else {
            // IDB 读取两次均失败 + lsBig 无兜底（>200KB IDB-only 键），最后尝试直接从 LS 读
            // （极端情况下 LS 可能有残留快照，聊胜于无）
            try {
              const lsV = localStorage.getItem(k);
              if (lsV !== null) { add(k, lsV); }
            } catch (e) {}
            // v3.26.x：权威键 IDB+memoryCache 均失败，只剩 LS 有损快照（或彻底没有）→ 记录降级
            if (isAuthorityKey(k)) exportMissing.push(k);
          }
        } catch (e) {} // 单键失败跳过，继续导出其余键
      }
    }
    // 大键仅在 localStorage、IndexedDB 里没有（或读取失败）时的最终兜底（如旧版遗留键）
    Object.keys(lsBig).forEach((k) => { add(k, lsBig[k]); });
    impShow('正在导出…', '正在打包数据文件', 72);
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    // v3.9.x：文件名用本地日期（原 toISOString 是 UTC，凌晨导出文件名会是前一天）
    const fname = 'mochi数据备份_' + localDateStr(new Date()) + '.json';
    // v3.27.x：体积友好显示——大备份自动换算 MB（原只显示 KB，上千 KB 不便读）
    const sizeStr = fmtSize(json.length);
    // v3.27.x：导出内容覆盖清单——本次导出的功能模块一目了然（导出=全局全部数据，
    // localStorage 小键 + IndexedDB 大键全量收集，用户反馈「看不到导出了哪些功能」）
    const coverLines = exportCoverage(data);
    let coverText = '导出内容（全局全部数据）：\n' + coverLines.join('\n') + '\n——';
    // v3.26.x：权威键降级提示——IDB 事务挂起/超时导致聊天记录/朋友圈只拿到 LS 有损
    // 快照（剥图/截断）或彻底丢失。明确告知用户备份可能不完整，切勿据此清空原设备数据。
    if (exportMissing.length) {
      const names = exportMissing.map(k => /:chat-msgs$/.test(k) ? '聊天记录(' + k.slice('xy-home-v2:'.length) + ')' : '朋友圈(' + k.slice('xy-home-v2:'.length) + ')');
      coverText += '\n⚠ 以下数据可能未完整导出（IDB 读取失败，仅拿到有损快照或丢失）：\n' + names.map(n => '· ' + n).join('\n') + '\n请勿清空原设备数据，建议重启浏览器后重新导出。';
    }
    // v3.6.x：记录最近一次成功导出时间——备份提醒条（pwa.js）据此判断是否该提醒
    try { localStorage.setItem('xy-home-v2:__last-backup', String(Date.now())); } catch (e) {}
    // v3.29.x：自动备份副本已下线——导出不再把整包 JSON 复制进 IndexedDB。
    //   旧实现有 ≤3MB 才写的阈值（为修 iOS Safari 导出闪退 / 小米 14U Edge 导出后本地存储被写坏而加），
    //   结果是真正需要备份的大数据量用户永远拿不到副本，副本只留存在旧版本里变成纯冗余占用
    //   （实测有 700MB+ 遗留快照），且任何读取方都要整包 JSON.parse 一次。备份能力统一交给下载文件。
    // v3.9.x：修复真我手机 Edge（Android Chromium）导出完全没反应……
    // 三级降级保存：① 系统分享面板 navigator.share ② 系统保存框 showSaveFilePicker
    // ③ 传统 a[download] 下载。前两者会弹系统原生界面由用户确认保存位置；
    // 第三种不再静默自动下载——统一改为先弹「备份已打包完成」确认框，用户点「确定」
    // 后才真正触发下载，避免"文件还没经用户同意就悄悄存好了"。
    impShow('正在导出…', '正在准备保存文件', 92);
    const saveRes = await saveBackupFile(blob, fname);
    impHide();
    if (saveRes === 'ok') { toast('数据已导出（' + sizeStr + '，全部数据完整）'); return; }
    // v3.9.x：'cancel' 不再直接放弃——华为/夸克等浏览器分享面板会立刻 AbortError
    //（分享面板不弹、直接返回「已取消保存」），数据其实已打包好，统一走「确定后下载」
    // 兜底，保证任何浏览器都能导出成功；用户仍可点「取消」放弃本次保存。
    // 原生分享/保存框不可用、被取消或未成功：数据已打包好，需要用户点「确定」才真正下载
    // v3.29.x：副本已下线——不再承诺「本机另有副本可恢复」，统一如实说明下载文件是唯一备份。
    if (window.openModal) {
      window.openModal('备份已打包完成（' + sizeStr + '）', '', () => {
        if (anchorDownload(blob, fname)) toast('数据已导出（' + sizeStr + '，全部数据完整）');
        else toast('仍未触发下载。请重新点击「导出数据」并确认保存下载文件——这份文件是你的唯一备份');
      }, { noInput: true, staticText: coverText + '\n数据已经打包好，还没开始保存。\n点「确定」开始下载保存到本机，点「取消」放弃本次保存。\n（请务必确认下载保存成功：本机不再另存副本，这个文件就是唯一备份）' });
    } else {
      toast('备份已打包（' + sizeStr + '），请重新点击「导出数据」触发下载并保存文件（唯一备份）');
    }
  }

  // v3.9.x：保存备份文件——返回 'ok'（已分享/已保存）/ 'cancel'（用户取消）/ 其他（被拦截或无法确认）。
  // 必须在用户手势（点击）触发链上调用：navigator.share / showSaveFilePicker 都要求用户激活，
  // async 数据收集超过激活窗口后第一次可能被拒，所以调用方失败后会给用户弹窗再点一次重试。
  async function saveBackupFile(blob, fname) {
    const file = new File([blob], fname, { type: 'application/json;charset=utf-8' });
    // ① 系统分享面板
    // v3.9.x：华为（Mate20 默认浏览器）与夸克对 navigator.share({files}) 支持不稳定——
    // canShare 返回 true 但实际调用立刻抛 AbortError（分享面板不弹、直接「已取消保存」），
    // 用户完全无法导出。检测到这些浏览器直接跳过分享面板，走「确定后下载」流程。
    const ua = (navigator.userAgent || '').toLowerCase();
    const brokenFileShare = /huaweibrowser|quark/.test(ua);
    if (!brokenFileShare && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'mochi 数据备份' });
        return 'ok';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancel';
        // NotAllowedError（无激活）/ SecurityError / 分享失败 → 继续降级
      }
    }
    // ② 系统保存框
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fname,
          types: [{ description: 'JSON 备份', accept: { 'application/json': ['.json'] } }]
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return 'ok';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancel';
      }
    }
    // ③ 传统 a[download] 下载：不再在本函数里静默触发——合成 a.click() 在部分浏览器
    // 会未经用户同意就悄悄下载。统一交给调用方在「备份已打包完成」确认弹窗点「确定」后
    // 调用 anchorDownload(blob, fname)（此时是有效用户手势，Android Chromium 也不再被拦截），
    // 返回 'blocked' 表示需要用户确认后才下载。
    return 'blocked';
  }

  // v3.xx：真正执行 <a download> 下载。只在用户点「确定」（有效用户手势）后调用，
  // 保证下载前一定有用户同意，同时解决此前"自动 a.click() 静默下载/被拦截"的问题。
  // v3.28.x：修复大备份「点了下载没反应/没下载完」——原实现在 1 秒后
  //   URL.revokeObjectURL + a.remove()：几十 MB 备份（音乐/头像/聊天全量，base64 后
  //   轻松上百 MB）下载刚由浏览器接管、blob 还没读完就被作废 → 无下载通知、无文件落盘
  //   （小米 14U Edge 实测：进度条走完、点确定，下载框一个都不弹）。改为长命 URL：
  //   ① blob URL 保留到页面关闭/离开（pagehide）才释放；② 5 分钟兜底释放防泄漏；
  //   ③ anchor 不再 1 秒就 remove（a.remove 后浏览器下载不受影响，但保留更稳妥）。
  //   a.download 在用户手势内触发，Android Chromium 不再拦截。
  function anchorDownload(blob, fname) {
    try {
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { if (a.parentNode) a.remove(); } catch (e) {} }, 5000);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 300000);
      window.addEventListener('pagehide', function h() {
        window.removeEventListener('pagehide', h);
        try { URL.revokeObjectURL(url); } catch (e) {}
      });
      return true;
    } catch (e) { return false; }
  }

  // v3.27.x：体积友好显示——<1MB 显示 KB，≥1MB 显示 MB（原导出只显示 KB，大备份上千 KB 不便读）
  function fmtSize(n) {
    if (!n) return '0 KB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return Math.round(n) + ' B';
  }

  // v3.27.x：导出内容覆盖清单——按键尾统计各功能模块本次导出了哪些数据，
  // 让用户确认「导出数据=全局全部数据」（用户反馈：导出弹窗不显示导出了哪些功能）。
  // 返回中文行数组，如「· 聊天记录：123 条」「· 信箱：✓（含图片）」。
  function exportCoverage(data) {
    const allKeys = Object.keys(data.ls || {}).concat(Object.keys(data.idb || {}));
    const valOf = (k) => (data.idb && data.idb[k]) !== undefined ? data.idb[k] : (data.ls && data.ls[k]);
    // [键尾正则, 功能名, 可选解析函数(arr)=>条数文本]
    const RULES = [
      [/:chat-msgs$/, '聊天记录', arr => arr.length + ' 条'],
      [/:group-chat-msgs$/, '群聊记录', arr => arr.length + ' 条'],
      [/mail-letters/, '信箱', arr => arr.length + ' 封'],
      [/feed-posts/, '朋友圈', arr => arr.length + ' 条'],
      [/cc-groups/, '字卡库', obj => Object.keys(obj).length + ' 组'],
      [/quote-cards/, '自定义字卡', arr => arr.length + ' 张'],
      [/fav-msgs/, '收藏', arr => arr.length + ' 条'],
      [/:avatar-user$|:avatar-partner$/, '头像', null],
      [/music-file:|music-favs/, '音乐', null],
      [/divine-history/, '占卜记录', arr => arr.length + ' 条'],
      [/cal-my-|records-/, '日历/纪念', null],
      [/memo-|myarc/, '备忘录/档案', null],
      [/gc-profiles/, '群聊资料', null],
      [/period-|cycle-/, '经期记录', null],
      [/accounting|expense/, '记账', null],
      [/garden-|room-data/, '花园/房间', null],
      [/drift-data/, '漂流瓶', null],
      [/desk-layout|hidden-icons/, '桌面布局', null]
    ];
    const matched = new Set();
    const lines = [];
    RULES.forEach(([re, name, parse]) => {
      const ks = allKeys.filter(k => re.test(k));
      const real = ks.filter(k => {
        let v = valOf(k);
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) {} }
        return v !== null && v !== undefined && v !== '';
      });
      if (!real.length) return;
      matched.add(name);
      let desc = '✓有';
      try {
        let v = valOf(real[0]);
        if (typeof v === 'string') v = JSON.parse(v);
        if (parse && (Array.isArray(v) || (v && typeof v === 'object'))) desc = parse(v);
      } catch (e) {}
      lines.push('· ' + name + '：' + desc);
    });
    return lines.length ? lines : ['· 检查到无数据（备份为空）'];
  }

  // v3.5.101：导入前预览备份摘要——显示导出时间/键数/聊天条数/头像/摸鱼累计，
  // 避免误导入旧备份或错文件（曾出现导入的文件不是最新备份、数据缺失的情况）
  function backupSummary(data) {
    const fmtMB = (n) => (n / 1048576).toFixed(1) + ' MB';
    const cnt = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0);
    const bytesOf = (v) => (v == null ? 0 : byteLen(typeof v === 'string' ? v : JSON.stringify(v)));
    let lsB = 0, idbB = 0;
    Object.keys(data.ls || {}).forEach(k => { lsB += bytesOf(data.ls[k]); });
    Object.keys(data.idb || {}).forEach(k => { idbB += bytesOf(data.idb[k]); });
    let chatN = '无';
    try {
      // v3.6.x：多桌面——备份里可能有多个联系人的 chat-msgs，全部统计
      const all = Object.keys(data.idb || {}).concat(Object.keys(data.ls || {}));
      const chats = all.filter(k => /:chat-msgs$/.test(k));
      let n = 0;
      chats.forEach(k => {
        const raw = (data.idb && data.idb[k]) || (data.ls && data.ls[k]);
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(arr)) n += arr.length;
      });
      if (n) chatN = n + ' 条';
    } catch (e) {}
    // v3.6.x：多桌面——头像/摸鱼值任一桌面存在即显示"有"
    const allKeys = Object.keys(data.ls || {}).concat(Object.keys(data.idb || {}));
    const avMe = !!allKeys.find(k => /:avatar-user$/.test(k));
    const avTa = !!allKeys.find(k => /:avatar-partner$/.test(k));
    let fish = null;
    const fishK = allKeys.find(k => /:fish-total$/.test(k));
    if (fishK) fish = (data.ls && data.ls[fishK]) !== undefined ? data.ls[fishK] : (data.idb && data.idb[fishK]);
    const lines = [];
    lines.push('备份内容（请确认是对的文件）：');
    lines.push('· 导出时间：' + fmtLocalTime(data.exportTime));
    lines.push('· 小存储 ' + cnt(data.ls) + ' 项（' + fmtMB(lsB) + '）+ 大文件 ' + cnt(data.idb) + ' 项（' + fmtMB(idbB) + '）');
    lines.push('· 聊天记录：' + chatN);
    lines.push('· 头像：我 ' + (avMe ? '✓有' : '✗无') + '，TA ' + (avTa ? '✓有' : '✗无'));
    lines.push('· 摸鱼累计：' + (fish !== null ? fish : '✗无'));
    lines.push('若这里显示「聊天记录：无/头像✗」等，说明不是最新完整备份，请勿导入。');
    return lines.join('\n');
  }

  // 导入
  async function doImport(file) {
    // 大备份读取/解析耗时较长，先亮进度遮罩
    impShow('正在读取数据文件…', '大备份（上百 MB）解析需要几秒，请稍候', null);
    let data;
    try {
      const text = await readFileText(file);
      data = JSON.parse(text || 'null');
    } catch (e) {
      impHide();
      toast('无效的数据文件');
      return;
    }
    impHide();
    if (!data || typeof data !== 'object' || !data.ls || typeof data.ls !== 'object') {
      toast('不是 mochi 导出的数据文件');
      return;
    }
    // v3.6.x：备份结构强校验——① app 标识不匹配直接拒绝（防误导其他应用的 json）；
    // ② 键前缀完全不匹配 mochi（xy-home-v2:）视为无效文件——原实现 {ls:{},idb:{}}
    // 空结构也能通过校验，配合先清空再写入，会把用户数据全清掉
    const MOCHI_PREFIX = 'xy-home-v2:';
    const lsLooksMochi =
      Object.keys(data.ls).some(k => k.indexOf(MOCHI_PREFIX) === 0) ||
      !!(data.idb && typeof data.idb === 'object' && Object.keys(data.idb).some(k => k.indexOf(MOCHI_PREFIX) === 0));
    // v3.9.x：app 标识不匹配但键前缀是 xy-home-v2:（mochi 独有前缀）时仍允许导入——
    // 覆盖 fork 版/手改 app 字段的 mochi 备份（数据本身是 mochi 结构）；只有 app 与键
    // 都不像 mochi 才拒绝（防别的应用 json 误导入）
    if (data.app && data.app !== 'mochi-zika' && !lsLooksMochi) {
      toast('不是 mochi 导出的数据文件');
      return;
    }
    const hasMochiKeys = lsLooksMochi;
    // v3.5.101：导入前先预览该备份的内容摘要，确认无误再覆盖（正常分支与兼容分支共用）
    function confirmAndImport(d) {
      if (!window.openModal) return;
      const summary = backupSummary(d);
      window.openModal('确定导入数据？将覆盖当前所有数据，且无法恢复。', '', () => {
        doImportGo(d);
      }, { noInput: true, staticText: summary });
    }
    if (!hasMochiKeys) {
      // 前缀兼容：文件通过 app 校验但键前缀不是 xy-home-v2:。探测文件里键的
      // 实际前缀，若键尾像 mochi 则提示重写前缀后导入；空备份/别的应用文件仍拒绝。
      // 原实现直接 toast 拒绝，导致前缀被改过的备份（手动编辑/旧版 fork）无法导入。
      const allKeys = Object.keys(data.ls || {}).concat(Object.keys(data.idb || {}));
      if (!allKeys.length) {
        toast('备份文件是空的（无任何数据键），没有可导入的数据');
        return;
      }
      const firstColon = allKeys[0].indexOf(':');
      if (firstColon < 0) {
        toast('备份文件键格式异常（无冒号分隔），无法导入');
        return;
      }
      const detectedPrefix = allKeys[0].slice(0, firstColon + 1);
      const allSamePrefix = allKeys.every(k => k.indexOf(detectedPrefix) === 0);
      if (!allSamePrefix) {
        toast('备份文件键前缀混乱（多种前缀），无法自动迁移。样例：' + allKeys.slice(0, 5).join('、'));
        return;
      }
      // v3.9.x：键尾识别列表扩充到 v3.6~v3.9 全部功能——旧列表只有 v3.6 初期的
      // 13 个键，群聊(gc-*)/占卜(divine-*)/每日小记(quote-history/memo-*)/摸鱼工作值
      // (day-fish-*/work-day-add)等新键缺位，真实 mochi 备份被改过前缀后仍会误拒。
      const mochiKeyTails = [
        // 强特征（mochi 独有，命中即视为 mochi）
        'chat-msgs', 'cc-groups', 'active-contact', 'contacts', 'fish-total',
        'avatar-user', 'avatar-partner', 'desk-image-src', 'music-file:',
        // v3.6 桌面/外观/设置
        'theme-mode', 'accent-color', 'reply-settings', 'chat-settings',
        'cs-', 'lbl-', 'avatar-', 'desk-', 'app-icon-', 'widget-',
        'phone-bg', 'page-bg-', 'card-bg-', 'hidden-icons', 'ico-radius',
        // v3.7 占卜/通话/记录
        'divine-history', 'divine-send-auto', 'call-mini-', 'records-',
        'fav-msgs', 'invite-ask-history',
        // v3.8 群聊/字卡/信箱/朋友圈/音乐
        'gc-profiles', 'gc-beauty', 'checkin-', 'my-emoji-groups', 'poke-',
        'reply-', 'feed-', 'music-', 'emoji-last', 'group-chat-enabled',
        // v3.9 每日小记/摸鱼工作值
        'quote-history', 'memo-', 'mood-history', 'today-mood-',
        'day-fish-', 'day-work-', 'fish-day-add', 'work-day-add',
        'work-total', 'love-start', 'avatar-lib', 'avatar-me-lib',
        'ck-', 'ckq-', 'rps-score', 'desk-countdowns', 'desk-texts',
        'desk-images', 'desk-layout', 'more-tab', 'cal-my-', 'mem-extras',
        'fish-log', 'fish-migrated', 'music-global', 'music-favs', 'music-float-pos',
        'phone-bg-preset', 'bg-blur', 'bg-mask-op', 'sf-', 'gc-'
      ];
      const tails = allKeys.map(k => k.slice(detectedPrefix.length));
      // v3.9.x：判定增强——① 键尾命中任一已知键尾；② 多桌面结构命中：键去掉前缀后
      // 第一个冒号段是 default 或 c<数字>（联系人桌面命名空间，mochi 独有结构），
      // 覆盖"备份里只有新功能键"（如 quote-history/memo-*）且前缀被改的情况。
      const tailHit = tails.filter(t => mochiKeyTails.some(p => t.indexOf(p) >= 0)).length;
      const deskHit = tails.filter(t => /^(default|c\d+):.+/.test(t)).length;
      const looksMochi = tailHit >= 1 || deskHit >= 1;
      if (!looksMochi) {
        toast('备份文件不像 mochi 数据（键尾不匹配）。前缀：' + detectedPrefix + '，样例：' + allKeys.slice(0, 5).join('、'));
        return;
      }
      if (!window.openModal) return;
      const sample = allKeys.slice(0, 3)
        .map(k => k + '  →  ' + MOCHI_PREFIX + k.slice(detectedPrefix.length)).join('\n');
      window.openModal(
        '检测到备份键前缀为「' + detectedPrefix + '」\n疑似 mochi 备份（键尾匹配），是否重写为「' + MOCHI_PREFIX + '」后导入？',
        '',
        () => {
          const rewrite = (obj) => {
            if (!obj || typeof obj !== 'object') return obj;
            const out = {};
            Object.keys(obj).forEach(k => {
              if (k.indexOf(detectedPrefix) === 0) out[MOCHI_PREFIX + k.slice(detectedPrefix.length)] = obj[k];
              else out[k] = obj[k];
            });
            return out;
          };
          data.ls = rewrite(data.ls);
          data.idb = rewrite(data.idb);
          confirmAndImport(data);
        },
        { noInput: true, staticText: '键映射样例：\n' + sample + '\n\n点确定重写前缀并导入，点取消放弃。' }
      );
      return;
    }
    confirmAndImport(data);
  }

  function doImportGo(data) {
    // v3.5.113：导入进度遮罩（读取已完成，这里开始逐条写入）
    impShow('正在导入…', '准备中', 2);

    // ---- 1. 备份当前 localStorage 的 xy-home-v2 键（导入失败可回滚） ----
    let backup = null;
    try {
      backup = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('xy-home-v2:') === 0) backup[k] = localStorage.getItem(k);
      }
    } catch (e) { backup = null; }

    // ---- 2. 原子恢复 IndexedDB（字卡 / 查岗 / 音乐文件等大件挪进 IDB，不占 localStorage 配额） ----
    // v3.6.x：改用 idbReplaceAll（单事务 clear + 批量 put）——旧实现先 idbClearAll 清空、
    // 再逐条 idbSet，清空与写入之间有几秒~几分钟无原子窗口，中途崩溃/杀进程会留下
    // 半空库，旧数据无法恢复。单事务失败自动回滚到事务前（旧数据完整保留），
    // 导入真正变成「要么全部替换、要么原样不动」。
    const idbRestored = new Promise((resolve) => {
      if (!data.idb || typeof data.idb !== 'object') { resolve(true); return; }
      const idbKeys = Object.keys(data.idb).filter(k => k.indexOf('xy-home-v2:') === 0 && k !== SNAPSHOT_KEY);
      if (!idbKeys.length) { resolve(true); return; }
      if (window.idbReplaceAll) {
        impShow('正在导入…', '正在原子写入大文件（字卡/聊天/音乐等）…', 8);
        const pairs = idbKeys.map(k => ({ k: k, v: data.idb[k] }));
        window.idbReplaceAll(pairs).then(ok => {
          if (ok) impShow('正在导入…', '大文件写入完成', 60);
          else { try { data.idb = {}; } catch (e) {} }
          resolve(ok);
        });
        return;
      }
      // 兜底：极端环境无 idbReplaceAll → 退回旧流程（先清空后逐条写，非原子）
      if (!window.idbSet) { resolve(true); return; }
      const clearFirst = (window.idbClearAll && window.idbClearAll()) || Promise.resolve(true);
      clearFirst.then((cleared) => {
        if (cleared !== true) { resolve(false); return; }
        let p = Promise.resolve();
        let failed = 0;
        let done = 0;
        const total = idbKeys.length;
        idbKeys.forEach(k => {
          p = p.then(() => window.idbSet(k, data.idb[k])).then(ok => {
            try { delete data.idb[k]; } catch (e) {}
            done++;
            if (!ok) failed++;
            impShow('正在恢复大文件（字卡/聊天/音乐等）…', done + ' / ' + total, 5 + Math.round(done / total * 55));
          });
        });
        p.then(() => resolve(failed === 0)).catch(() => resolve(false));
      });
    });

    // ---- 3. 清空旧数据（xy-home-v2 前缀） ----
    function clearLs() {
      try {
        Object.keys(localStorage)
          .filter(k => k.indexOf('xy-home-v2:') === 0)
          .forEach(k => localStorage.removeItem(k));
      } catch (e) {}
    }
    // 回滚：还原导入前的旧数据
    function rollback() {
      clearLs();
      if (backup) {
        try {
          Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k]));
        } catch (e) {}
      }
    }

    idbRestored.then((idbOk) => {
      // v3.6.x：IDB 原子替换失败 → 数据已由事务回滚保持原样，这里中止后续——
      // 不再继续写 localStorage，否则会出现「localStorage 新数据 + IndexedDB 旧数据」混合态
      if (!idbOk) {
        impHide();
        toast('导入失败：大文件写入未成功，原有数据已保留，请重试');
        return;
      }
      impShow('正在导入…', '正在写入设置与聊天记录', 62);
      // ---- 4. 写 localStorage 前先估算总字节；超配额时按体积从大到小丢弃大键 ----
      // 聊天记录双写（localStorage + IndexedDB）：导入时 IndexedDB 已恢复完整权威版
      // （含图片 dataURL），localStorage 无需再写超大聊天记录——启动时 loadMsgs 会
      // 自动从 IndexedDB 恢复。这样导入不再因聊天记录占几十 MB 而整体取消。
      const lsKeys = Object.keys(data.ls).filter(k => k.indexOf('xy-home-v2:') === 0 && k !== SNAPSHOT_KEY);
      let entries = lsKeys.map(k => ({ k: k, len: byteLen(data.ls[k]) + byteLen(k) }));
      let chatMoved = false;
      // v3.26.x：chat-msgs 不写 LS（chat.js 不回填 LS，从 IDB 读）。但仅当 data.idb 有该键
      // 权威值时才跳过；若 data.idb 无权威值（导出时 IDB 失败，只剩 LS 有损快照），把快照
      // 写进 IDB 兜底（有损但聊胜于无），否则 chat-msgs 彻底丢失（原实现无条件跳过 LS 写入
      // → data.idb 无权威时 chat-msgs 既不写 LS 也不进 IDB，跨浏览器导入后聊天记录消失）。
      const chatFallback = [];
      entries = entries.filter(e => {
        if (!/:chat-msgs$/.test(e.k)) return true;
        chatMoved = true;
        if (data.idb && data.idb[e.k] !== undefined) return false; // IDB 有权威，跳过 LS
        chatFallback.push({ k: e.k, v: data.ls[e.k] }); // IDB 无权威，快照写 IDB 兜底
        return false;
      });
      const total = entries.reduce((s, e) => s + e.len, 0);
      // 估算当前设备配额：探测能否写入 1MB 临时键（能 → 桌面 10MB 档；不能 → 手机 5MB 档）
      let quota = 5 * 1024 * 1024;
      try {
        const probe = 'x'.repeat(1024 * 1024);
        localStorage.setItem(window.activePrefix() + ':__quota_probe__', probe);
        localStorage.removeItem(window.activePrefix() + ':__quota_probe__');
        quota = 10 * 1024 * 1024;
      } catch (e) {}
      let budget = total;
      let dropped = [];
      const sorted = entries.slice().sort((a, b) => b.len - a.len);
      for (const e of sorted) {
        if (budget + LS_HEADROOM <= quota) break;
        // 聊天记录绝不丢（v3.5.90：IDB 无 chat-msgs 时 localStorage 兜底）
        if (/:chat-msgs$/.test(e.k)) continue;
        budget -= e.len;
        dropped.push(e);
      }
      // v3.5.91：不再整体取消——按配额丢弃超大图片类大键，其余数据全部写入。
      // 手机 5MB 配额装不下几十 MB 图片是物理限制；跳过的大键有明确提示，
      // 设置/昵称/聊天文字/字卡文字等小键保证完整恢复。
      const skipSet = {};
      dropped.forEach(e => { skipSet[e.k] = true; });

      clearLs();
      let writeFailed = [];
      // v3.5.93：被配额跳过的超大键与写入失败的键不再丢弃——
      // 改写入 IndexedDB（配额远大于 localStorage），启动时自动从 IDB 恢复，数据不丢
      // v3.5.94：写入成功的键若 >200KB，也与运行时策略一致移进 IDB（避免占满 5MB 配额）
      const idbFalls = [];
      // v3.26.x：chat-msgs 的 LS 有损快照兜底（data.idb 无权威值时）写进 IDB
      chatFallback.forEach(f => idbFalls.push(f));
      for (const e of entries) {
        if (skipSet[e.k]) { idbFalls.push({ k: e.k, v: data.ls[e.k] }); continue; }
        try {
          localStorage.setItem(e.k, data.ls[e.k]);
          if (e.len > 200 * 1024) {
            try { localStorage.removeItem(e.k); } catch (err2) {}
            idbFalls.push({ k: e.k, v: data.ls[e.k] });
          }
        } catch (err) {
          writeFailed.push(e.k);
          idbFalls.push({ k: e.k, v: data.ls[e.k] });
        }
      }
      // 等待 IDB 兜底写入全部完成后，再提示 + 刷新
      let fallsOk = 0;
      let p = Promise.resolve();
      idbFalls.forEach(f => {
        p = p.then(() => (window.idbSet ? window.idbSet(f.k, f.v) : Promise.resolve(false)))
          .then(ok => { if (ok) fallsOk++; });
      });
      p.then(async () => {
        impShow('正在导入…', '写入完成，正在核对数据', 95);
        const parts = [];
        if (idbOk) parts.push('音乐/字卡/查岗等大文件已恢复');
        else if (data.idb && Object.keys(data.idb).length) parts.push('⚠ IndexedDB 恢复失败，字卡/音乐/查岗等大文件可能缺失，建议重新导入');
        if (chatMoved) parts.push('聊天记录已存入 IndexedDB（不占浏览器小存储）');
        if (writeFailed.length) parts.push(writeFailed.length + ' 项写入失败（存储空间满）');
        if (idbFalls.length) {
          const mb = (idbFalls.reduce((s, f) => s + byteLen(f.v), 0) / 1048576).toFixed(1);
          parts.push('大文件 ' + idbFalls.length + ' 项（约 ' + mb + ' MB）已存入 IndexedDB，不占小存储');
        }
        if (!parts.length) parts.push('导入成功');
        // v3.5.101：导入后核对关键数据是否真的恢复（避免"提示成功但数据缺失"）
        let ok = [];
        try {
          // v3.6.x：多桌面——核对任一桌面的聊天/头像/摸鱼 + 联系人注册表
          let chatN = 0;
          // v3.26.x #90：chatSeen=看到几个聊天键，chatCheckOk=清单是否真的读到
          let chatSeen = 0, chatCheckOk = true;
          if (window.idbListKeys || window.idbGetAllKeys) {
            try {
              const keys = window.idbListKeys ? await window.idbListKeys() : await window.idbGetAllKeys();
              if (!Array.isArray(keys)) { chatCheckOk = false; }
              else {
                for (const k of keys) {
                  if (/:chat-msgs$/.test(k)) {
                    chatSeen++;
                    const cv = await window.idbGet(k);
                    const a = typeof cv === 'string' ? JSON.parse(cv) : cv;
                    if (Array.isArray(a)) chatN += a.length;
                    else if (cv === undefined || cv === null) chatCheckOk = false;
                  }
                }
              }
            } catch (e) { chatCheckOk = false; }
          }
          if (chatN) ok.push('聊天' + chatN + '条');
          // 清单没读到 / 有聊天键却一条都没取到：核对未成功，必须说出来（不当成"没有记录"）
          if (!chatN && !chatCheckOk) parts.push('⚠ 聊天记录未能核对（数据库繁忙），请打开聊天页确认记录在列后再清理原设备');
          else if (!chatN && chatSeen) parts.push('⚠ 聊天键存在但条数读取失败，请打开聊天页确认');
          const lsKeys = [];
          for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) lsKeys.push(k); }
          if (lsKeys.some(k => /:avatar-user$/.test(k))) ok.push('我的头像✓');
          const fishK = lsKeys.find(k => /:fish-total$/.test(k));
          if (fishK !== undefined) ok.push('摸鱼累计 ' + localStorage.getItem(fishK));
          if (localStorage.getItem('xy-home-v2:contacts')) ok.push('联系人✓');
        } catch (e) {}
        const msg = parts.join('；') + (ok.length ? '；已核对：' + ok.join('、') : '') + '，正在刷新…';
        // v3.5.114：核对失败时明确红字警告（数据确实没恢复时不要静默跳过）
        if (!ok.length) {
          impShow('⚠ 导入完成但未检测到关键数据', '聊天记录/头像/摸鱼未在存储中找到，刷新后仍缺失请重新导入完整备份', 100);
        } else {
          impShow('导入完成', msg, 100);
        }
        // v3.5.118：不再额外弹黑色 toast——结果已完整显示在白色进度面板里
        // （toast z-index 低于进度遮罩，同时弹出会被白板盖住，形成"黑色弹窗被遮挡"）
        // v3.5.117：完成页停留 3.5 秒（用户反馈缓冲时间不够、看不清结果）
        setTimeout(() => { impHide(); location.reload(); }, 3500);
      });
    });
  }

  // v3.29.x：清理历史遗留的自动备份副本。副本写入已下线（见 doExport 上方说明），旧版本留在
  // IndexedDB / localStorage 的那一份变成永远刷不了新的纯冗余占用（实测有 700MB+，约占用户存储一半），
  // 任何读取它的路径都要整包 JSON.parse，风险大于收益。启动时静默删掉即可回收空间。
  // 只删这一个键，业务数据一律不动；延迟执行避开 idbRestore 回填与首屏渲染的启动关键路径。
  function purgeLegacySnapshot() {
    try { localStorage.removeItem(SNAPSHOT_KEY); } catch (e) {}
    if (!window.idbDelete) return;
    // v3.26.x #90：删后要复核再收工——idbDelete 没有挂起超时，原实现连返回值都不看，
    // 实测该设备 173.8MB 遗留副本历经多次启动仍在（白占近一半可用空间）。用严格三态
    // 探测 idbHasKey 复核：false＝确认已删；true＝还在 → 再删一次（最多 3 次）；
    // null＝这次读不到，留给下次启动（不做重试风暴）。删不存在的键无副作用，重复调用安全。
    let tries = 0;
    const attempt = function () {
      tries++;
      try { Promise.resolve(window.idbDelete(SNAPSHOT_KEY)).catch(function () {}); } catch (e) {}
      if (!window.idbHasKey) return;
      setTimeout(function () {
        try {
          Promise.resolve(window.idbHasKey(SNAPSHOT_KEY)).then(function (has) {
            if (has === true && tries < 3) attempt();
          }).catch(function () {});
        } catch (e) {}
      }, 2500);
    };
    attempt();
  }
  // 幂等包装：事件路径与墙钟路径共用，保证 #90 的「删→复核→重试」链只起一套。
  let _purgeStarted = false;
  function purgeOnce() {
    if (_purgeStarted) return;
    _purgeStarted = true;
    purgeLegacySnapshot();
  }
  if (window.__mochiDataReady) { setTimeout(purgeOnce, 1500); }
  else {
    document.addEventListener('mochi-restore-done', function h() {
      document.removeEventListener('mochi-restore-done', h);
      setTimeout(purgeOnce, 1500);
    });
    // v3.29.x 兜底：#83 之后 12 秒保险丝不再设 __mochiDataReady（只派发 mochi-restore-slow），
    // 所以 IDB 整轮挂起的设备上 mochi-restore-done 永不到达 → 清理一次都不跑，几百 MB 副本原地
    // 留着；而 IDB 最慢、遗留副本最大的恰好是同一批机型。与 idb.js 里 wrjMergeFromIdb 的
    // 「restore 整体挂起时的兜底」同理补一条墙钟兜底：清理只碰副本键，restore 完成与否不影响安全性。
    setTimeout(purgeOnce, 20000);
  }

  // 入口绑定
  // v3.6.x：备份提醒条（pwa.js「去备份」）与设置页导出共用同一流程
  window.runBackupExport = function () {
    toast('正在导出，请稍候…');
    // v3.5.134：导出前强制落盘——聊天记录有 400ms 防抖，不刷的话备份缺最后几条消息
    // v3.9.x：chatFlushSave 抛错会中断 doExport（表现为点了导出没反应），必须兜住
    try { if (window.chatFlushSave) window.chatFlushSave(); } catch (e) {}
    doExport();
  };
  const exportRow = document.getElementById('row-export');
  if (exportRow) {
    exportRow.addEventListener('click', () => { window.runBackupExport(); });
  }
  const importRow = document.getElementById('row-import');
  if (importRow) {
    importRow.addEventListener('click', () => {
      // v3.9.x：修复真我手机 Edge 文件选择器不弹出——动态创建的 file input 必须
      // 先挂载到 DOM 再 click()（未挂载 / display:none 时部分 Android 浏览器会静默忽略
      // 合成点击，改 position:fixed 移出屏幕而非 display:none 最稳）；
      // 不设 accept 过滤——部分国产 ROM 文件选择器对 accept 过滤有兼容 bug，
      // 选错文件会在导入时被校验提示「不是 mochi 导出的数据文件」
      const input = document.createElement('input');
      input.type = 'file';
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      input.style.top = '0';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.onchange = () => {
        const f = input.files && input.files[0];
        try { input.remove(); } catch (e) {}
        if (f) doImport(f);
      };
      input.click();
      // 兜底：用户一直不选文件时清理隐藏 input（onchange 触发后已 remove，仅防泄漏）
      setTimeout(() => { try { if (input.parentNode) input.remove(); } catch (e) {} }, 120000);
    });
  }
})();
