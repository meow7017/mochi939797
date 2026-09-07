// ===== 功能：聊天统计页 / 小互动页 / 今日备忘·心情 =====
// 音乐：音乐库、播放列表、播放历史
// 聊天统计：相处天数、消息数、表情包/拍一拍/情绪统计
// 小互动：拍一拍 TA / 送一句情话
// v3.5.27：今日备忘/今天的心情历史双写 IndexedDB——导入备份覆盖 localStorage 后记录可从 IDB 回填
(function () {
  const uid = window.activePrefix();
  const store = window.activeStore();
  // 备忘/心情历史：localStorage + IndexedDB 双写；启动时从 IDB 回填缺失键（导入/清空后不丢记录）
  function pushHist(key, text) {
    try {
      const list = JSON.parse(store.get(key) || '[]');
      list.unshift({ text: text, ts: Date.now() });
      if (list.length > 200) list.length = 200;
      store.set(key, JSON.stringify(list));
      try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + key, JSON.stringify(list)); } catch (e) {}
    } catch (e) {}
  }
  function restoreHist(key) {
    try {
      if (window.idbGet && !store.get(key)) {
        const myPrefix = window.activePrefix();
        window.idbGet(myPrefix + ':' + key).then(v => {
          if (window.activePrefix() !== myPrefix) return;
          if (!v) return;
          try { store.set(key, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {}
        });
      }
    } catch (e) {}
  }
  restoreHist('memo-history');
  restoreHist('mood-history');
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // v3.7.x：本周日常点击其他日期查看当日内容用——按日期生成键
  function dayStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // 轻提示（全局唯一，与其它模块一致）
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cc-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2000);
  }

  // ================= 聊天统计页 =================
  const statsApp = document.querySelector('.app[data-app="stats"]');
  const statsPage = document.getElementById('page-stats');
  if (statsApp && statsPage) {
    statsApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      statsPage.hidden = false;
      renderStats();
    });
  }
  const statsBack = document.getElementById('stats-back');
  if (statsBack) {
    statsBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-phone');
      if (home) home.hidden = false;
    });
  }
  // ================= 聊天统计（完整版：相处记录 / 聊天记录 / 情绪表达） =================
  function statsInfoCard(icon, label, value) {
    return '<div class="stats-row"><span class="stats-label">' + icon + ' ' + label + '</span><span class="stats-num" style="font-size:15px">' + value + '</span></div>';
  }
  function fmtDTFull(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function calcStreak(dateSet) {
    const dates = Array.from(dateSet).sort();
    if (!dates.length) return 0;
    let max = 1, cur = 1;
    for (let i = 1; i < dates.length; i++) {
      const diff = (new Date(dates[i]) - new Date(dates[i - 1])) / 864e5;
      if (diff === 1) { cur++; max = Math.max(max, cur); } else cur = 1;
    }
      return max;
  }
  // v3.15.x：聊天记录 tab 新增「联系人发红包 / 申请心意币」流水区块（rows: {main, sub}）
  // 全量展示不截断——流水本身低频（红包≤5/日、申请≤2/日），按时间倒序最新在上
  function coinRecordSection(icon, title, unit, rows, emptyText) {
    let html = '<div class="stats-sec">' +
      '<div class="stats-sec-head"><span class="stats-sec-title">' + icon + title + '</span>' +
      '<span class="stats-sec-count">' + rows.length + ' 笔</span></div>';
    if (!rows.length) {
      html += '<div class="ta-empty">' + emptyText + '</div>';
    } else {
      html += '<div class="stats-list">';
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        html += '<div class="stats-item">' +
          '<span class="stats-item-name">' + r.main + '</span>' +
          '<span class="stats-item-num dt">' + r.sub + '</span></div>';
      }
      html += '</div>';
    }
    return html + '</div>';
  }
  function fmtMDHM(ts) {
    if (!ts) return '';
    const t = new Date(ts);
    return String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0') + ' ' +
      String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  }
  const escH = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function statsBarSection(icon, title, countMap, topLabel, emptyText) {
    const entries = [];
    for (const k in countMap) if (countMap.hasOwnProperty(k)) entries.push({ name: k, count: countMap[k] });
    entries.sort((a, b) => b.count - a.count);
    let html = '<div class="stats-sec">' +
      '<div class="stats-sec-head"><span class="stats-sec-title">' + icon + title + '</span>' +
      '<span class="stats-sec-count">' + entries.length + ' 种</span></div>';
    if (!entries.length) {
      html += '<div class="ta-empty">' + emptyText + '</div>';
    } else {
      const top = entries[0].name;
      const topCount = entries[0].count;
      html += '<div class="stats-top">' +
        '<div class="stats-top-tag">' + topLabel + '</div>' +
        '<div class="stats-top-name">「' + String(top).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '」</div>' +
        '<div class="stats-top-num">' + topCount + ' 次</div></div>';
      html += '<div class="stats-list">';
      entries.slice(0, 5).forEach(e => {
        html += '<div class="stats-item">' +
          '<span class="stats-item-name">' + String(e.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</span>' +
          '<span class="stats-item-num">' + e.count + '</span></div>';
      });
      html += '</div>';
    }
    return html + '</div>';
  }
  // v3.24.x：文字字卡统计——只统计自定义字卡（公用 + 专属）里的内容，按「我发 / TA发」分开。
  // 记录侧用「分类 + 分组 + 卡原文」识别（历史消息未存卡 id，只能按内容匹配）：
  // ① 取当前桌面的 公用字卡(cc-groups-public) + 专属字卡(cc-groups) 合并，只取 text 分类的文字卡；
  // ② 遍历聊天消息，只统计在字卡库里真实存在的卡（同一内容反复发也算多次）；
  // ③ 侧边按 side 分：out = 我发的，in = 联系人发的（含自动回复池抽取的自定义文字卡）。
  function ccCardSet() {
    const set = {};
    try {
      const rawOwn = (window.storeFor && window.storeFor(window.__activeCid || 'default') || store).get('cc-groups');
      const rawPub = (window.xyStore ? window.xyStore('xy-home-v2').get('cc-groups-public') : null);
      [rawOwn, rawPub].forEach(raw => {
        if (!raw) return;
        const g = JSON.parse(raw);
        if (!g || !g.text) return;
        (g.text || []).forEach(([gname, arr]) => (arr || []).forEach(c => {
          if (typeof c === 'string' && c.indexOf('|||') < 0 && c.indexOf('data:') !== 0) set[c] = 1;
        }));
      });
    } catch (e) {}
    return set;
  }
  function ccTextRankSection(icon, title, countMap, topLabel, emptyText, max, dataKey) {
    const entries = [];
    for (const k in countMap) if (countMap.hasOwnProperty(k)) entries.push({ name: k, count: countMap[k] });
    entries.sort((a, b) => b.count - a.count);
    let html = '<div class="stats-sec">' +
      '<div class="stats-sec-head"><span class="stats-sec-title">' + icon + title + '</span>' +
      '<span class="stats-sec-count">' + entries.length + ' 种</span></div>';
    if (!entries.length) {
      html += '<div class="ta-empty">' + emptyText + '</div>';
    } else {
      const top = entries[0].name;
      const topCount = entries[0].count;
      html += '<div class="stats-top">' +
        '<div class="stats-top-tag">' + topLabel + '</div>' +
        '<div class="stats-top-name">「' + String(top).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '」</div>' +
        '<div class="stats-top-num">' + topCount + ' 次</div></div>';
      html += '<div class="stats-list">';
      const shown = Math.min(max || 5, entries.length);
      for (let i = 0; i < shown; i++) {
        const e = entries[i];
        html += '<div class="stats-item">' +
          '<span class="stats-item-name">' + String(e.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '</span>' +
          '<span class="stats-item-num">' + e.count + ' 次</span></div>';
      }
      html += '</div>';
      if (entries.length > shown) {
        html += '<div class="stats-more" data-cc-more="' + title + '" data-cc-key="' + dataKey + '">查看更多 ' + entries.length + ' 种字卡 ▾</div>';
      }
    }
    return html + '</div>';
  }
  // v3.24.x：自定义字卡（公用+专属）文字卡 Top100 全量弹层——内容只来自合并字卡库，
  // 上榜的都是字卡库里存在的卡，点「查看更多」弹出完整排名（上限 100）。
  function openCcTopModal(title, entries, emptyText) {
    if (!entries || !entries.length) { toast(emptyText || '暂无使用记录'); return; }
    const sorted = entries.slice().sort((a, b) => b.count - a.count);
    const top = sorted.slice(0, 100);
    let txt = '共 ' + sorted.length + ' 张自定义字卡使用过，按次数从高到低\n\n';
    top.forEach((e, i) => {
      txt += (i + 1) + '. ' + String(e.name) + '  ×' + e.count + '\n';
    });
    if (sorted.length > 100) txt += '\n… 仅显示前 100 名';
    if (window.openModal) window.openModal(title, '', function () {}, { staticText: txt, noInput: true, okText: '知道了' });
  }
  // v3.24.x：渲染「文字字卡」tab——自定义字卡（公用+专属）使用统计，我发 / TA发 分开
  function renderCcStats() {
    const ccEl = document.getElementById('st-cc-content');
    if (!ccEl) return;
    let msgs2 = [];
    try { msgs2 = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
    if (!msgs2.length || !msgs2.some(m => m && m.side && m.text)) {
      ccEl.innerHTML = '<div class="ta-empty">暂无聊天记录</div>';
      return;
    }
    const cardSet = ccCardSet();
    const mineCount = {}, taCount = {};
    const name = store.get('lbl-partner') || 'TA';
    const myName = store.get('lbl-user') || '我';
    const EXPR_CORE_RE = /[^0-9A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g;
    msgs2.forEach(m => {
      if (!m || typeof m.text !== 'string' || !m.side) return;
      if (m.special || m.retracted) return;
      if (m.text.indexOf('data:') === 0 || m.text.indexOf('http') === 0) return;
      const core = m.text.replace(EXPR_CORE_RE, '');
      if (!core) return;
      if (!(m.text in cardSet)) return;
      if (m.side === 'out') mineCount[m.text] = (mineCount[m.text] || 0) + 1;
      else taCount[m.text] = (taCount[m.text] || 0) + 1;
    });
    const mineN = Object.keys(mineCount).length, taN = Object.keys(taCount).length;
    ccEl.innerHTML =
      '<div style="margin-bottom:16px"><div style="font-size:13px;font-weight:700;color:#555;margin-bottom:8px">自定义字卡（公用 + 专属）使用统计</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="font-size:12px;color:var(--muted);width:28px">' + escH(myName) + '</div>' +
      '<div style="flex:1;height:8px;background:rgba(0,0,0,.06);border-radius:4px;overflow:hidden"><div style="height:100%;background:var(--ink);width:' + ((mineN + taN) ? Math.round(mineN / (mineN + taN) * 100) : 0) + '%;border-radius:4px"></div></div>' +
      '<div style="font-size:12px;color:var(--ink);width:auto;text-align:right;white-space:nowrap">' + mineN + ' 种</div></div>' +
      '<div style="display:flex;align-items:center;gap:8px"><div style="font-size:12px;color:var(--muted);width:28px">' + escH(name) + '</div>' +
      '<div style="flex:1;height:8px;background:rgba(0,0,0,.06);border-radius:4px;overflow:hidden"><div style="height:100%;background:#999;width:' + ((mineN + taN) ? Math.round(taN / (mineN + taN) * 100) : 0) + '%;border-radius:4px"></div></div>' +
      '<div style="font-size:12px;color:var(--ink);width:auto;text-align:right;white-space:nowrap">' + taN + ' 种</div></div></div>' +
      ccTextRankSection('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>', escH(myName) + ' 发的文字字卡', mineCount, '常用文字', '你还用过自定义字卡里的文字卡', 5, 'mine') +
      ccTextRankSection('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>', escH(name) + ' 发的文字字卡', taCount, '常用文字', '联系人还没用过自定义字卡里的文字卡', 5, 'ta');
    // 供「查看更多」弹层读取完整数据
    ccEl.__ccMine = []; for (const k in mineCount) if (mineCount.hasOwnProperty(k)) ccEl.__ccMine.push({ name: k, count: mineCount[k] });
    ccEl.__ccTa = []; for (const k in taCount) if (taCount.hasOwnProperty(k)) ccEl.__ccTa.push({ name: k, count: taCount[k] });
  }
  function renderStats() {
    renderCcStats();
    let msgs = [];
    try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
    const real = msgs.filter(m => m && m.side && m.text);
    const firstTs = real.length ? (real[0].ts || Date.now()) : 0;
    const lastTs = real.length ? (real[real.length - 1].ts || firstTs) : 0;
    // v3.5.81：相处天数 = 恋爱纪念日（love-start）起算；未设置则用第一条聊天记录时间；
    //   聊天记录被清空/新装时不再显示 0（用纪念日兜底）
    let daysStart = firstTs;
    try {
      const loveStart = store.get('love-start');
      if (loveStart) {
        const ls = new Date(loveStart + 'T00:00:00').getTime();
        if (!isNaN(ls)) daysStart = ls;
      }
    } catch (e) {}
    const days = daysStart ? Math.max(0, Math.floor((Date.now() - daysStart) / 864e5)) : 0;
    // ---- 相处记录 ----
    const recordEl = document.getElementById('st-record-cards');
    if (recordEl) {
      let mine = 0, ta = 0, textChars = 0;
      real.forEach(m => {
        if (m.side === 'out') mine++; else ta++;
        if (typeof m.text === 'string' && m.text.indexOf('data:') !== 0) textChars += m.text.length;
      });
      let favsCount = 0;
      try { favsCount = (JSON.parse(store.get('fav-msgs') || '[]') || []).length; } catch (e) {}
      recordEl.innerHTML =
        statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>', '第一次聊天', fmtDTFull(firstTs) || '暂无记录') +
        statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M10 2h4"/></svg>', '最近聊天', fmtDTFull(lastTs) || '暂无记录') +
        statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>', '聊天消息', (mine + ta) + ' 条') +
        statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 13l2 2 4-4"/></svg>', '文字数量', textChars + ' 字') +
        statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 5 5.6.8-4 4 .9 5.6-4.9-2.6-4.9 2.6.9-5.6-4-4 5.6-.8z"/></svg>', '收藏记录', favsCount + ' 条');
    }
    // ---- 聊天记录 ----
    const chatEl = document.getElementById('st-chat-content');
    if (chatEl) {
      if (!real.length) { chatEl.innerHTML = '<div class="ta-empty">暂无聊天记录</div>'; }
      else {
        let userCount = 0, taCount = 0;
        const hourCount = {}, dayCount = {}, dateCount = {};
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
        real.forEach(m => {
          if (m.side === 'out') userCount++; else taCount++;
          const t = new Date(m.ts || Date.now());
          hourCount[t.getHours()] = (hourCount[t.getHours()] || 0) + 1;
          dayCount[t.getDay()] = (dayCount[t.getDay()] || 0) + 1;
          const ds = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
          dateCount[ds] = (dateCount[ds] || 0) + 1;
        });
        const total = userCount + taCount;
        const userPct = total ? Math.round(userCount / total * 100) : 0;
        const taPct = total ? Math.round(taCount / total * 100) : 0;
        let peakHour = 0, peakHourVal = 0;
        for (const h in hourCount) if (hourCount[h] > peakHourVal) { peakHourVal = hourCount[h]; peakHour = Number(h); }
        let peakDay = 0, peakDayVal = 0;
        for (const d in dayCount) if (dayCount[d] > peakDayVal) { peakDayVal = dayCount[d]; peakDay = Number(d); }
        const totalDays = Math.max(1, Math.floor((Date.now() - firstTs) / 864e5));
        let maxSingle = 0;
        for (const d in dateCount) maxSingle = Math.max(maxSingle, dateCount[d]);
        const name = store.get('lbl-partner') || 'TA';
        chatEl.innerHTML =
          '<div style="margin-bottom:16px"><div style="font-size:13px;font-weight:700;color:#555;margin-bottom:8px">消息比例</div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="font-size:12px;color:var(--muted);width:28px">我</div>' +
          '<div style="flex:1;height:8px;background:rgba(0,0,0,.06);border-radius:4px;overflow:hidden"><div style="height:100%;background:var(--ink);width:' + userPct + '%;border-radius:4px"></div></div>' +
          '<div style="font-size:12px;color:var(--ink);width:76px;text-align:right">' + userCount + ' 条 ' + userPct + '%</div></div>' +
          '<div style="display:flex;align-items:center;gap:8px"><div style="font-size:12px;color:var(--muted);width:28px">' + name + '</div>' +
          '<div style="flex:1;height:8px;background:rgba(0,0,0,.06);border-radius:4px;overflow:hidden"><div style="height:100%;background:#999;width:' + taPct + '%;border-radius:4px"></div></div>' +
          '<div style="font-size:12px;color:var(--ink);width:76px;text-align:right">' + taCount + ' 条 ' + taPct + '%</div></div></div>' +
          statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>', '最常聊天时间', peakHour + ':00 - ' + ((peakHour + 1) % 24) + ':00') +
          statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>', '最常聊天日期', '星期' + dayNames[peakDay]) +
          statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="18" y1="20" x2="18" y2="11"/></svg>', '平均每日消息', Math.round(total / totalDays) + ' 条') +
          statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3-3 4-3 7a3 3 0 006 0c0-1-.3-2-.8-3 1.8 1 3 3 3 5a6 6 0 11-12 0c0-4 3-6 4.5-8.5z"/></svg>', '最长连续聊天', calcStreak(Object.keys(dateCount)) + ' 天') +
          statsInfoCard('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>', '单日最高消息', maxSingle + ' 条') +
          // v3.16.x：红包记录——双向摘要（我发 + 联系人发，红包即心意币；累计金额 + 次数，明细已移至主页「心意币红包记录」）
          (function () {
            const myName = store.get('lbl-user') || '我';
            function rpSec(title, list, emptyTxt) {
              let sum = 0; list.forEach(m => { sum += Number(m.rpAmount || 0); });
              return '<div class="stats-sec"><div class="stats-sec-head"><span class="stats-sec-title">🧧 ' + title + '</span>' +
                '<span class="stats-sec-count">' + list.length + ' 笔</span></div>' +
                (list.length ? '<div class="stats-top"><div class="stats-top-tag">累计心意币</div><div class="stats-top-name">¥' + sum.toFixed(2) + '</div><div class="stats-top-num">共 ' + list.length + ' 次</div></div>'
                  : '<div class="ta-empty">' + emptyTxt + '</div>') +
                '</div>';
            }
            return rpSec(myName + ' 发红包', msgs.filter(m => m && m.special === 'redpacket' && m.side === 'out'), '我还没有发过红包（红包也是心意币，去发一个试试）') +
              rpSec(escH(name) + ' 发红包', msgs.filter(m => m && m.special === 'redpacket' && m.side === 'in'), '还没有 ' + escH(name) + ' 发的红包');
          })() +
          // v3.15.x：联系人申请心意币记录（askcoin 卡片）
          coinRecordSection('🪙', name + '申请心意币记录', '笔',
            msgs.filter(m => m && m.special === 'askcoin').map(m => ({
              main: '+¥' + (Number(m.askFen || 0) / 100).toFixed(2),
              sub: fmtMDHM(m.askTs || m.ts)
            })),
            escH(name) + ' 还没有向 Mochi 申请过') +
          // v3.16.x：小游戏记录（更多功能→小游戏 7 款对局 + 联系人主动邀请玩游戏，全部汇总）
          (function () {
            const GAME_SPECIAL = { brick: '双人打砖块', pong: '乒乓', snake: '贪吃蛇', memory: '记忆翻牌', rps: '猜拳', c4: '四子棋', ms: '合作扫雷' };
            const GAME_KIND = { rps: '猜拳', pong: 'Pong', snake: '双人贪吃蛇' };   // TA 主动邀请（cuddle 贴贴不算游戏）
            const GAME_NAME_RE = /^(四子棋|合作扫雷|记忆翻牌|双人打砖块|Pong)/;
            const rows = [];
            const push = (m, mainTxt, ico) => {
              if (!m) return;
              rows.push({ main: (ico || '🎮') + ' ' + escH(mainTxt), sub: fmtMDHM(m.ts || m.rpTs), ts: m.ts || m.rpTs || 0 });
            };
            msgs.forEach(m => {
              if (!m) return;
              if (m.special && GAME_SPECIAL[m.special]) push(m, GAME_SPECIAL[m.special] + ' · ' + (m.text || ''), '🎮');
              // 联系人主动邀请玩游戏（sendTaInvite 写入的 gInv 字段）
              else if (m.gInv && GAME_KIND[m.gInv]) push(m, name + ' 邀请玩 ' + GAME_KIND[m.gInv], '📩');
            });
            // 兜底：无 special 的老记录按文本前缀识别（四子棋/扫雷 v3.16.x 前未带标记）
            msgs.forEach(m => {
              if (!m || !m.text || !GAME_NAME_RE.test(m.text)) return;
              if (m.special && GAME_SPECIAL[m.special]) return;
              if (m.gInv) return;
              push(m, m.text, '🎮');
            });
            // 去重 + 时间倒序
            const seen = new Set();
            const uniq = rows.filter(r => { const k = r.main + '|' + r.sub; if (seen.has(k)) return false; seen.add(k); return true; });
            uniq.sort((a, b) => (b.ts || 0) - (a.ts || 0));
            let html = '<div class="stats-sec"><div class="stats-sec-head"><span class="stats-sec-title">🎮 小游戏记录</span>' +
              '<span class="stats-sec-count">' + uniq.length + ' 条</span></div>';
            if (!uniq.length) {
              html += '<div class="ta-empty">还没有小游戏记录（更多功能 → 小游戏，和 TA 玩一局试试）</div>';
            } else {
              html += '<div class="stats-list">';
              uniq.forEach(r => {
                html += '<div class="stats-item"><span class="stats-item-name">' + r.main + '</span>' +
                  '<span class="stats-item-num dt">' + r.sub + '</span></div>';
              });
              html += '</div>';
            }
            return html + '</div>';
          })();
        }
    }
    // ---- 情绪表达 ----
    const exprEl = document.getElementById('st-expr-content');
    if (exprEl) {
      if (!real.length) { exprEl.innerHTML = '<div class="ta-empty">暂无聊天记录</div>'; }
      else {
        const emotion = {}, heart = {}, intent = {};
        real.forEach(m => {
          (m.mood || []).forEach(md => {
            // v3.6.x：脏数据防御——mood 条目非对象（导入/损坏数据）时跳过，避免统计页中断
            if (!md || typeof md !== 'object') return;
            // v3.15.x：来源 chip 型 mood（tagNoDup）无正文 label，跳过避免统计出空名条目
            if (!md.label) return;
            if (md.tag === '交流意图') intent[md.label] = (intent[md.label] || 0) + 1;
            else if (md.tag === '心意') heart[md.label] = (heart[md.label] || 0) + 1;
            else emotion[md.label] = (emotion[md.label] || 0) + 1;
          });
        });
        exprEl.innerHTML =
          statsBarSection('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9.5l.01.01M15 9.5l.01.01"/></svg>', '情绪字卡', emotion, '常见情绪', '暂无使用记录') +
          statsBarSection('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S4.5 15.2 4.5 9.9A4.9 4.9 0 0112 7.1a4.9 4.9 0 017.5 2.8c0 5.3-7.5 10.6-7.5 10.6z"/><path d="M19 3.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z"/></svg>', '心意字卡', heart, '常传递心意', '暂无使用记录') +
          statsBarSection('<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8.5 8.5 0 01-12.6 7.4L4 21l1.5-4.4A8.5 8.5 0 1121 12z"/><path d="M8.5 10h7M8.5 13h4.5"/></svg>', '交流意图', intent, '常用交流', '暂无使用记录');
      }
    }
    const daysEl = document.getElementById('st-days');
    if (daysEl) daysEl.textContent = days;
  }
  // 统计 tab 切换
  document.querySelectorAll('#page-stats .fav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#page-stats .fav-tab').forEach(x => x.classList.toggle('sel', x === tab));
      const k = tab.dataset.stab;
      document.querySelectorAll('#page-stats .cal-card').forEach(c => {
        c.hidden = c.dataset.stpanel !== k;
      });
      // v3.24.x：文字字卡 tab 每次进入时重算（字卡库/聊天可能刚变）
      if (k === 'cc') renderCcStats();
    });
  });
  // v3.24.x：「查看更多」→ 弹出 Top100 完整排名
  document.addEventListener('click', function (e) {
    const more = e.target.closest('[data-cc-more]');
    if (!more) return;
    const title = more.getAttribute('data-cc-more');
    const key = more.getAttribute('data-cc-key');
    if (!title || !key) return;
    const ccEl = document.getElementById('st-cc-content');
    if (!ccEl) return;
    const prop = key === 'mine' ? '__ccMine' : '__ccTa';
    const entries = ccEl[prop] || [];
    if (entries.length) {
      openCcTopModal(title, entries, '暂无使用记录');
    }
  });

  // ================= 提问记录页（原小互动页） =================
  const interactApp = document.querySelector('.app[data-app="interact"]');
  const interactPage = document.getElementById('page-interact');
  if (interactApp && interactPage) {
    interactApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      if (window.renderAskRecords) window.renderAskRecords();
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      interactPage.hidden = false;
    });
  }
  const interactBack = document.getElementById('interact-back');
  if (interactBack) {
    interactBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-phone');
      if (home) home.hidden = false;
    });
  }

// ================= 寻踪（TA 的日常）=================
const DEF_PLACES = ['在家', '在公司', '在咖啡店', '在公园', '在图书馆', '在路上', '在朋友家', '在健身房', '在超市', '在电影院', '在便利店', '在书店', '在地铁上', '在阳台', '在河边', '在小区楼下', '在面包店', '在车站', '在自习室'];
const DEF_ACTIONS = ['刷手机', '看书', '发呆', '听歌', '写东西', '吃零食', '喝奶茶', '散步', '玩游戏', '想你', '看电影', '追剧', '刷视频', '等快递', '收拾房间', '洗衣服', '做饭', '泡茶', '吃水果', '拍照'];
const DEF_CHECK_MSGS = ['想你了', '记得按时吃饭', '今天也很喜欢你', '早点休息', '有空给我回消息', '别太累', '喝水了吗', '今天开心吗', '我今天有点累', '我今天很开心', '我今天有点想你', '我今天有点无聊', '今天过得怎么样', '记得多穿点', '路上注意安全', '晚安'];
// 寻踪日常字卡（可自定义，localStorage 持久化；空则用默认）
// v3.6.x：是否使用系统预设字卡（默认开启；关闭后寻踪只从用户添加的字卡里抽）
const CK_DEF_KEY = 'checkin-cards-default';
function getCkDefault() {
  const v = store.get(CK_DEF_KEY);
  return v === null ? true : v === '1';
}
function ckList(k, def) {
  try {
    const v = JSON.parse(store.get('checkin-cards-' + k) || 'null');
    if (Array.isArray(v) && v.length) return v;
  } catch (e) {}
  return def.slice();
}
  function ckSaveList(k, list) { store.set('checkin-cards-' + k, JSON.stringify(list)); }
  // v3.6.x：纯自定义库读取（不 fallback 到默认）——批量添加/我的添加列表用这个，
  //   避免原 ckList() 在无自定义时返回默认库导致系统预设被"转正"存进自定义库
  function ckCustomList(k) {
    try {
      const v = JSON.parse(store.get('checkin-cards-' + k) || 'null');
      if (Array.isArray(v)) return v;
    } catch (e) {}
    return [];
  }
  // v3.7.x：寻踪字卡统一返回对象数组 [{t, grp}]（旧字符串数据自动转对象）——管理页/批量添加用
  function ckItems(k) {
    try {
      const v = JSON.parse(store.get('checkin-cards-' + k) || 'null');
      if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? { t: x } : (x && typeof x === 'object' && x.t != null ? x : null)).filter(Boolean);
    } catch (e) {}
    return [];
  }
  // v3.7.x：寻踪字卡保存（统一对象数组）
  function ckSaveItems(k, items) { store.set('checkin-cards-' + k, JSON.stringify(items)); }
  // v3.7.x：寻踪自定义分组（按 地点/在做什么/说的话 分类各自独立）——只用于管理页整理，抽取不分组
  function ckGroups(k) {
    try {
      const v = JSON.parse(store.get('checkin-cards-groups-' + k) || 'null');
      if (Array.isArray(v)) return v;
    } catch (e) {}
    return [];
  }
  function ckSaveGroups(k, groups) { store.set('checkin-cards-groups-' + k, JSON.stringify(groups)); }
// v3.6.x：寻踪系统预设字卡单卡开关——逐张开启/关闭（关闭后寻踪不再抽取该条）
function isCkCardOff(k, x) { return store.get('ck-off-' + k + ':' + x) === '1'; }
function setCkCardOff(k, x, off) { store.set('ck-off-' + k + ':' + x, off ? '1' : '0'); }
function genCheckin() {
  const useDefault = getCkDefault();
  // v3.7.x：字卡可为 {t, grp} 对象——统一用 ckItems 取 .t
  let places = ckItems('place');
  let actions = ckItems('action');
  let msgs = ckItems('msg');
  // v3.7.x 修复：ckItems 只读自定义字卡（管理页要显示真实自定义，不 fallback），
  // 但 genCheckin 抽取时必须有字卡——自定义空时补系统预设（转 {t} 对象格式），
  // 否则 out.place/action/msg 全 undefined → 寻踪页空白/记录不显示/聊天不发消息
  if (!places.length) places = DEF_PLACES.map(t => ({ t }));
  if (!actions.length) actions = DEF_ACTIONS.map(t => ({ t }));
  if (!msgs.length) msgs = DEF_CHECK_MSGS.map(t => ({ t }));
  const out = {};
  // 关闭「使用系统预设」时：只从用户添加的字卡里抽；某分类没有用户自定义则跳过该字段
  // v3.6.x：单卡开关过滤——用户关闭的字卡（ck-off-*）不参与抽取
  let place = useDefault ? places.filter(p => !isCkCardOff('place', p.t)) : places.filter(p => DEF_PLACES.indexOf(p.t) < 0 && !isCkCardOff('place', p.t));
  let action = useDefault ? actions.filter(a => !isCkCardOff('action', a.t)) : actions.filter(a => DEF_ACTIONS.indexOf(a.t) < 0 && !isCkCardOff('action', a.t));
  let msg = useDefault ? msgs.filter(m => !isCkCardOff('msg', m.t)) : msgs.filter(m => DEF_CHECK_MSGS.indexOf(m.t) < 0 && !isCkCardOff('msg', m.t));
  // 兜底：关闭预设且完全没有用户自定义时回退使用系统预设（避免寻踪空白/undefined）
  if (!place.length && !action.length && !msg.length) {
    place = places; action = actions; msg = msgs;
  }
  if (place.length) out.place = place[Math.floor(Math.random() * place.length)].t;
  if (action.length) out.action = action[Math.floor(Math.random() * action.length)].t;
  if (msg.length) out.msg = msg[Math.floor(Math.random() * msg.length)].t;
  return out;
}
function renderCheckinHistory() {
  const histEl = document.getElementById('ck-history');
    if (!histEl) return;
    try {
      let h = [];
      try { h = JSON.parse(store.get('checkin-history') || '[]'); } catch (e) { h = []; }
      // 过滤无有效内容的记录（不渲染 "-- · -- · --" 占位），只显示实际存在的字段
      const valid = (Array.isArray(h) ? h : []).filter(x => x && (x.place || x.action));
      histEl.innerHTML = valid.length
        ? valid.slice().reverse().map(x => {
            const parts = [x.t, x.place, x.action].filter(Boolean);
            return '<div class="ck-location"><div class="ck-value" style="font-size:13px">' + parts.join(' · ') + '</div><div class="ck-label">' + (x.msg || '') + '</div></div>';
          }).join('')
        : '<div class="div-result-empty">暂无寻踪记录</div>';
    } catch (e) {}
  }
  // 初始化：从 IndexedDB 恢复全部寻踪记录
  (function () {
    if (window.idbGet) {
      const myPrefix = window.activePrefix();
      window.idbGet(myPrefix + ':checkin-history').then(v => {
        if (window.activePrefix() !== myPrefix) return;
        if (!v) return;
        try {
          const data = typeof v === 'string' ? JSON.parse(v) : v;
          if (Array.isArray(data) && data.length && !store.get('checkin-history')) {
            store.set('checkin-history', JSON.stringify(data));
          }
        } catch (e) {}
      });
    }
  })();
  const checkinApp = document.querySelector('.app[data-app="checkin"]');
  const checkinPage = document.getElementById('page-checkin');
  // ---- 星言顶部栏字卡/随机换头像同款刷新机制 ----
  // 上次/下次更新时间戳持久化：首次启动立即生成一条，之后每 1-8 小时更新一次；
  // 每 60 秒轮询检查，刷新页面周期不重置
  function ckLast() { const v = parseInt(store.get('checkin-last'), 10); return isNaN(v) ? 0 : v; }
  function ckNext() { const v = parseFloat(store.get('checkin-next')); return isNaN(v) ? 0 : v; }
  function renderCheckinUI(ck) {
    const place = document.getElementById('ck-place');
    const action = document.getElementById('ck-action');
    const msg = document.getElementById('ck-msg');
    const status = document.getElementById('ck-status');
    const name = store.get('lbl-partner') || 'TA';
    // v3.6.x：关闭系统预设且某分类无自定义字卡时该字段为空——显示空串而非字面量 "undefined"
    if (place) place.textContent = ck.place || '';
    if (action) action.textContent = ck.action || '';
    if (msg) msg.textContent = ck.msg || '';
    if (status) status.textContent = name + ' 的日常';
  }
  function recordCheckin(ck) {
    // v3.6.x：undefined 字段不写入记录（JSON.stringify 自动丢弃 undefined 键）
    const entry = { t: fmtTime(Date.now()), place: ck.place, action: ck.action, msg: ck.msg, ts: Date.now() };
    try {
      const h = JSON.parse(store.get('checkin-history') || '[]');
      h.push(entry);
      store.set('checkin-history', JSON.stringify(h));
      if (window.idbSet) window.idbSet(window.activePrefix() + ':checkin-history', JSON.stringify(h));
    } catch (e) {}
    renderCheckinHistory();
  }
  // 生成新日常：渲染 + 推聊天消息（更新提示 + 概率提醒）+ 记录 + 重置计时
  function doCheckin() {
    const ck = genCheckin();
    store.set('checkin-current', JSON.stringify(ck));
    renderCheckinUI(ck);
    const name = store.get('lbl-partner') || 'TA';
    // 更新提示系统消息：先发「联系人 更新了一条日常」（v3.7.x 调整顺序——
    // 原先是字卡文字消息先发、系统提示后发，与用户预期相反）
    if (window.chatAddSystem) {
      window.chatAddSystem(name + ' 更新了一条日常');
    }
    // 再发日常更新内容消息（普通气泡消息，持久化）
    // v3.6.x：只拼接存在的字段，避免 "在咖啡店 · undefined" 写进聊天记录
    if (window.chatAddIn) {
      const line = [ck.place, ck.action, ck.msg].filter(Boolean).join(' · ');
      if (line) window.chatAddIn(line);
    }
    // 概率触发「提醒你来寻踪」
    if (Math.random() * 100 < 30) {
      window.chatAddIn(name + ' 提醒你来寻踪.查岗');
    }
    recordCheckin(ck);
    store.set('checkin-last', String(Date.now()));
    store.set('checkin-next', String(1 + Math.random() * 7));
    // 同步聊天里打开的寻踪半框
    const p = document.getElementById('ck-p-place');
    const a = document.getElementById('ck-p-action');
    const m = document.getElementById('ck-p-msg');
    if (p) p.textContent = ck.place || '';
    if (a) a.textContent = ck.action || '';
    if (m) m.textContent = ck.msg || '';
  }
  // 供聊天页「点联系人头像打开寻踪半框」使用
  window.openCkPanel = function () {
    // 关闭其他底部半框（拍一拍/表情包/头像互动）
    const pc = document.getElementById('poke-card');
    if (pc) pc.hidden = true;
    const ep = document.getElementById('emoji-panel');
    if (ep) ep.hidden = true;
    if (window.closeAvlib) window.closeAvlib();
    const panel = document.getElementById('ck-panel');
    const nameEl = document.getElementById('ck-panel-name');
    const name = store.get('lbl-partner') || 'TA';
    if (nameEl) nameEl.textContent = name;
    // 显示当前日常；从未生成过则立即生成一条
    let cur = null;
    try { cur = JSON.parse(store.get('checkin-current') || 'null'); } catch (e) {}
    if (cur && cur.place) {
      const p = document.getElementById('ck-p-place');
      const a = document.getElementById('ck-p-action');
      const m = document.getElementById('ck-p-msg');
      if (p) p.textContent = cur.place || '';
      if (a) a.textContent = cur.action || '';
      if (m) m.textContent = cur.msg || '';
    } else {
      doCheckin();
    }
    // 更新时间：日常更新时记录的时间戳
    const upd = document.getElementById('ck-p-updated');
    if (upd) {
      const last = parseInt(store.get('checkin-last'), 10);
      upd.textContent = last ? '更新于 ' + fmtTime(last) : '';
    }
    if (panel) panel.hidden = false;
  };
  const ckPanelClose = document.getElementById('ck-panel-close');
  if (ckPanelClose) ckPanelClose.addEventListener('click', () => { document.getElementById('ck-panel').hidden = true; });
  // 自动轮询：启动立即 + 每 60 秒检查（首次 last=0 立即生成）
  // v3.5.118：首次检查延迟到 IndexedDB 回填完成后（mochi-restore-done）——
  // 否则启动瞬间 doCheckin→chatAddIn 会在聊天记录权威数据（导入后只在 IDB）
  // 读回前写入新消息，触发 saveMsgs 用 1 条覆盖 IDB 里的全部历史（导入后聊天记录丢失）
  let ckBootDone = false;
  // v3.5.128：回前台冷静期——后台切回时多个模块（发动态/来电/来信/询问/寻踪）
  // 会同时判定，错峰 90 秒避免连环弹窗+连发消息
  let ckWakeAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ckWakeAt = Date.now() + 90000;
  });
  function checkAutoCheckin() {
    if (document.hidden) return; // v3.5.127：后台不自动寻踪
    if (Date.now() < ckWakeAt) return; // 回前台冷静期
    if (!ckBootDone) return; // 首次：等数据就绪标志
    try {
      const now = Date.now();
      let last = ckLast(), next = ckNext();
      if (last > now || last < 0 || isNaN(last)) { last = 0; next = 0; }
      if ((now - last) / 36e5 < next) return;
      doCheckin();
    } catch (e) {}
  }
  function bootCheckin() {
    // v3.5.129：数据未就绪不启动——3s 兜底在慢设备（分批恢复 >3s）上会
    // 绕过门控提前生成日常，导致导入后首启多出一条"日常更新"且寻踪节奏被重置
    if (!window.__mochiDataReady) { setTimeout(bootCheckin, 500); return; }
    ckBootDone = true;
    checkAutoCheckin();
  }
  // 数据就绪（IDB 回填完成）后启动；无事件兜底 3 秒（空数据场景 idbRestore 也会派发）
  // 全屏打开寻踪页：渲染当前日常（或生成一条）+ 记录；供桌面/聊天「更多功能」共用
  window.openCheckinPage = function () {
    if (!checkinPage) return;
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    checkinPage.hidden = false;
    // 显示当前日常；从未生成过则立即生成一条
    let cur = null;
    try { cur = JSON.parse(store.get('checkin-current') || 'null'); } catch (e) {}
    if (cur && cur.place) renderCheckinUI(cur);
    else doCheckin();
    renderCheckinHistory();
  };
  if (checkinApp && checkinPage) {
    checkinApp.addEventListener('click', () => {
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      // 桌面进入：返回时回桌面（避免残留聊天来源）
      window.__ckFrom = '';
      window.openCheckinPage();
    });
  }
  const checkinBack = document.getElementById('checkin-back');
  if (checkinBack) {
    checkinBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      // 聊天「更多功能」进入则返回聊天，否则返回桌面
      if (window.__ckFrom === 'chat') {
        const chatPage = document.getElementById('page-chat');
        if (chatPage) chatPage.hidden = false;
      } else {
        const home = document.getElementById('page-phone');
        if (home) home.hidden = false;
      }
      window.__ckFrom = '';
    });
  }
const ckRefresh = document.getElementById('ck-refresh');
if (ckRefresh) {
  // v3.5.132：5 秒最小间隔——连点会在聊天里刷出多条"更新日常"消息
  let ckLastRefresh = 0;
  ckRefresh.addEventListener('click', () => {
    const now = Date.now();
    if (now - ckLastRefresh < 5000) { toast('刷新太频繁，稍后再试'); return; }
    ckLastRefresh = now;
    doCheckin();
  });
}

  // ================= 寻踪日常字卡（管理页 + 字卡库入口） =================
  const CK_DEFS = [
    ['place', DEF_PLACES],
    ['action', DEF_ACTIONS],
    ['msg', DEF_CHECK_MSGS]
  ];
  const CK_LABEL = { place: '地点', action: '在做什么', msg: '说的话' };
  // v3.15.x：存量清洗——更早版本的管理页在删除/编辑时会把「默认地点/在做什么/说的话」
  // 整库回写进自定义键（ckList 空 fallback 的"转正"问题，v3.6.x 已堵住新产生但没清存量），
  // 导致【查岗日常·我的添加】里错误显示系统预设字卡、库入口计数虚高。
  // 按文本匹配一次性剔除（幂等标记防重跑；ckSaveItems→store.set 三写
  // memoryCache/LS/IDB，idbRestore 的 memoryCache 守卫保证回填不会复活已清洗的旧值）。
  // 按桌面各清一次（标记存联系人命名空间）；与全站「按文本认预设」的模型一致。
  (function cleanLegacyPresetInCk() {
    try {
      const MK = 'ck-mine-clean-v1';
      if (store.get(MK) === '1') return;
      const defMap = { place: DEF_PLACES, action: DEF_ACTIONS, msg: DEF_CHECK_MSGS };
      Object.keys(defMap).forEach(k => {
        let raw = null;
        try { raw = JSON.parse(store.get('checkin-cards-' + k) || 'null'); } catch (e) { raw = null; }
        if (!Array.isArray(raw)) return;
        const cleaned = raw.filter(x => {
          const t = x && typeof x === 'object' ? x.t : x;
          return !(t != null && defMap[k].indexOf(String(t)) >= 0);
        });
        if (cleaned.length !== raw.length) ckSaveItems(k, cleaned);
      });
      store.set(MK, '1');
    } catch (e) {}
  })();
  let ckTab = 'place';
  // v3.6.x：是否有用户自定义的寻踪列表（有则默认项按内容匹配标【系统】；无则整库为系统预设）
  function ckHasCustom(k) {
    try {
      const v = JSON.parse(store.get('checkin-cards-' + k) || 'null');
      return Array.isArray(v) && v.length > 0;
    } catch (e) { return false; }
  }
  let ckTab2 = 'sys';
  function escCk(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function renderCkSysList() {
    const listEl = document.getElementById('cck-sys-list');
    const titleEl = document.getElementById('cck-sys-title');
    if (titleEl) titleEl.textContent = CK_LABEL[ckTab] || '';
    if (!listEl) return;
    const useDefault = getCkDefault();
    const def = { place: DEF_PLACES, action: DEF_ACTIONS, msg: DEF_CHECK_MSGS }[ckTab];
    listEl.innerHTML = '';
    if (!useDefault) {
      const tip = document.createElement('div');
      tip.className = 'ta-empty';
      tip.textContent = '系统预设字卡已关闭（寻踪只从「我的添加」里抽取）。开启上方开关即可恢复使用。';
      listEl.appendChild(tip);
      return;
    }
    def.forEach(x => {
      const off = isCkCardOff(ckTab, x);
      const row = document.createElement('div');
      row.className = 'tc-qrow' + (off ? ' off' : '');
      row.innerHTML = '<div class="tc-qmain"><div class="tc-qtext">' + escCk(x) + ' <span class="tc-known">系统</span></div></div>';
      const lab = document.createElement('label');
      lab.className = 'toggle ccard-toggle';
      lab.innerHTML = '<input type="checkbox"' + (off ? '' : ' checked') + '><span class="tk"></span>';
      lab.querySelector('input').addEventListener('change', () => {
        const nowOff = !lab.querySelector('input').checked;
        setCkCardOff(ckTab, x, nowOff);
        renderCkSysList();
        updateCkCount();
        toast((nowOff ? '已关闭：' : '已开启：') + (x.length > 18 ? x.slice(0, 18) + '…' : x));
      });
      row.appendChild(lab);
      listEl.appendChild(row);
    });
  }
  function renderCkMineList() {
    const listEl = document.getElementById('cck-mine-list');
    const titleEl = document.getElementById('cck-mine-title');
    if (titleEl) titleEl.textContent = CK_LABEL[ckTab] || '';
    if (!listEl) return;
    const custom = ckItems(ckTab);
    const groups = ckGroups(ckTab);
    let html = '';
    html += '<div class="mg-grp-row"><button class="cc-tool mg-grp-add"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>新建分组</button></div>';
    if (!custom.length && !groups.length) {
      listEl.innerHTML = html + '<div class="ta-empty">暂未添加自定义字卡，可在上方批量输入（每行一个）。</div>';
      bindCkGroupOps();
      return;
    }
    // 自定义分组区块（置顶，与系统预设隔开）
    groups.forEach(g => {
      const arr = custom.filter(x => x.grp === g.id);
      html += '<div class="cal-card glass mg-block" data-gid="' + escCk(g.id) + '">' +
        '<div class="cal-card-title mg-title"><button class="mg-handle" data-gid="' + escCk(g.id) + '" title="拖动排序"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></button>' +
        '<span class="mg-name">' + escCk(g.name) + '</span><span class="mg-cnt">(' + arr.length + ')</span>' +
        '<span class="mg-ops"><button class="mg-op" data-g="' + escCk(g.id) + '" data-op="rn" title="重命名">✎</button><button class="mg-op" data-g="' + escCk(g.id) + '" data-op="rm" title="删除分组">✕</button></span></div>' +
        (arr.length ? arr.map(x => ckMineItemHtml(x, custom.indexOf(x))).join('') : '<div class="ta-empty">这个分组还没有内容</div>') +
        '</div>';
    });
    const ungrouped = custom.filter(x => !x.grp);
    html += '<div class="cal-card glass mg-block mg-ungrouped"><div class="cal-card-title mg-title"><span class="mg-name">未分组</span><span class="mg-cnt">(' + ungrouped.length + ')</span></div>';
    if (!ungrouped.length) html += '<div class="ta-empty">暂无未分组字卡，可在上方批量输入</div>';
    html += ungrouped.map(x => ckMineItemHtml(x, custom.indexOf(x))).join('');
    html += '</div>';
    listEl.innerHTML = html;
    listEl.querySelectorAll('.ta-del').forEach(b => {
      b.addEventListener('click', () => {
        const l = ckItems(ckTab);
        l.splice(Number(b.dataset.idx), 1);
        ckSaveItems(ckTab, l);
        renderCkMineList();
        updateCkCount();
        toast('已删除');
      });
    });
    // v3.7.x：点击字卡内容编辑
    listEl.querySelectorAll('.tc-qtext[data-edit]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.edit);
        const l = ckItems(ckTab);
        const item = l[idx];
        if (!item || !window.openModal) return;
        window.openModal('编辑字卡', item.t, (v) => {
          const val = String(v == null ? '' : v).trim();
          if (!val) { toast('内容不能为空'); return; }
          if (val === item.t) return;
          if (l.some((x, xi) => xi !== idx && x.t === val)) { toast('已有相同内容'); return; }
          l[idx].t = val;
          ckSaveItems(ckTab, l);
          renderCkMineList();
          toast('已更新');
        });
      });
    });
    // v3.7.x：移动字卡到其他分组
    listEl.querySelectorAll('.ta-mv').forEach(b => {
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.idx);
        const l = ckItems(ckTab);
        const item = l[idx];
        if (!item || !window.openModal) return;
        const groups = ckGroups(ckTab);
        const opts = [{ label: '未分组', value: '' }].concat(groups.map(g => ({ label: g.name, value: g.id })));
        window.openModal('移动到分组', '', (v) => {
          if (v == null) return;
          l[idx].grp = v || '';
          ckSaveItems(ckTab, l);
          renderCkMineList();
          const tgt = v ? (groups.find(g => g.id === v) || {}).name : '未分组';
          toast('已移动到「' + tgt + '」');
        }, { pills: opts, pill: item.grp || '', noInput: true });
      });
    });
    bindCkGroupOps();
  }
  function ckMineItemHtml(x, idx) {
    return '<div class="tc-qrow"><div class="tc-qmain"><div class="tc-qtext" data-edit="' + idx + '">' + escCk(x.t) + '</div></div>' +
      '<button class="ta-mv" data-idx="' + idx + '" title="移动分组"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M3 7h13a4 4 0 014 4v0a4 4 0 01-4 4H7"/><path d="M7 11l-4 4 4 4"/></svg></button>' +
      '<button class="ta-del" data-idx="' + idx + '">✕</button></div>';
  }
  // 寻踪 分组管理事件（新建 / 重命名 / 删除，按当前分类独立）
  function bindCkGroupOps() {
    const wrap = document.getElementById('cck-mine-list');
    if (!wrap) return;
    wrap.querySelectorAll('.mg-grp-add').forEach(b => {
      if (b.__bound) return;
      b.__bound = true;
      b.addEventListener('click', () => {
        const groups = ckGroups(ckTab);
        window.cardGroups.addFlow(groups, g => {
          if (!g) return;
          ckSaveGroups(ckTab, groups);
          refreshCkGrpSelect();
          renderCkMineList();
          toast('已新建分组「' + g.name + '」');
        });
      });
    });
    wrap.querySelectorAll('.mg-op').forEach(b => {
      if (b.__bound) return;
      b.__bound = true;
      b.addEventListener('click', () => {
        const groups = ckGroups(ckTab);
        const gid = b.dataset.g;
        const g = groups.find(x => x.id === gid);
        if (!g) return;
        if (b.dataset.op === 'rn') {
          window.cardGroups.renameFlow(g, groups, name => {
            if (!name) return;
            ckSaveGroups(ckTab, groups);
            refreshCkGrpSelect();
            renderCkMineList();
            toast('分组已重命名');
          });
        } else if (b.dataset.op === 'rm') {
          window.cardGroups.removeFlow(g.name, ok => {
            if (!ok) return;
            const l = ckItems(ckTab);
            l.forEach(x => { if (x.grp === gid) x.grp = ''; });
            ckSaveItems(ckTab, l);
            ckSaveGroups(ckTab, groups.filter(x => x.id !== gid));
            refreshCkGrpSelect();
            renderCkMineList();
            toast('已删除分组「' + g.name + '」');
          });
        }
      });
    });
    // v3.7.x：分组拖动排序（手柄 ≡ 触发，克隆标题行跟随手指 + 蓝色指示线）
    wrap.querySelectorAll('.mg-handle').forEach(b => {
      if (b.__bound) return;
      b.__bound = true;
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const gid = b.dataset.gid;
        const blocks0 = Array.from(wrap.querySelectorAll('.mg-block:not(.mg-ungrouped)'));
        const block = blocks0.find(bl => bl.dataset.gid === gid);
        if (!block) return;
        const title = block.querySelector('.mg-title');
        const rect = title.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const clone = title.cloneNode(true);
        clone.classList.add('mg-drag-clone');
        clone.style.position = 'fixed';
        clone.style.left = rect.left + 'px';
        clone.style.top = rect.top + 'px';
        clone.style.width = rect.width + 'px';
        clone.style.margin = '0';
        clone.style.zIndex = '1000';
        clone.style.pointerEvents = 'none';
        document.body.appendChild(clone);
        block.classList.add('mg-dragging');
        let dropIdx = blocks0.indexOf(block);
        const onMove = (ev) => {
          ev.preventDefault();
          clone.style.top = (ev.clientY - offsetY) + 'px';
          const blocks2 = Array.from(wrap.querySelectorAll('.mg-block:not(.mg-ungrouped)'));
          dropIdx = blocks2.length;
          for (let i = 0; i < blocks2.length; i++) {
            if (blocks2[i] === block) continue;
            const r = blocks2[i].getBoundingClientRect();
            if (ev.clientY < r.top + r.height / 2) { dropIdx = i; break; }
          }
          wrap.querySelectorAll('.mg-drop-line').forEach(el => el.remove());
          const line = document.createElement('div');
          line.className = 'mg-drop-line';
          if (dropIdx >= blocks2.length) {
            const last = blocks2[blocks2.length - 1];
            if (last && last.nextSibling) wrap.insertBefore(line, last.nextSibling);
            else wrap.appendChild(line);
          } else {
            wrap.insertBefore(line, blocks2[dropIdx]);
          }
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
          clone.remove();
          block.classList.remove('mg-dragging');
          wrap.querySelectorAll('.mg-drop-line').forEach(el => el.remove());
          const blocks2 = Array.from(wrap.querySelectorAll('.mg-block:not(.mg-ungrouped)'));
          const curIdx = blocks2.findIndex(bl => bl.dataset.gid === gid);
          if (curIdx < 0 || dropIdx === curIdx || dropIdx === curIdx + 1) return;
          const groups = ckGroups(ckTab);
          let target = dropIdx < curIdx ? dropIdx : dropIdx - 1;
          if (target < 0) target = 0;
          if (target > groups.length - 1) target = groups.length - 1;
          if (target === curIdx) return;
          const [moved] = groups.splice(curIdx, 1);
          groups.splice(target, 0, moved);
          ckSaveGroups(ckTab, groups);
          renderCkMineList();
          toast('分组已移动');
        };
        document.addEventListener('pointermove', onMove, { passive: false });
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        e.preventDefault();
      });
    });
  }
  // 刷新批量输入的分组下拉（按当前分类）
  function refreshCkGrpSelect() {
    const grpSel = document.getElementById('cck-batch-grp');
    if (!grpSel) return;
    const groups = ckGroups(ckTab);
    grpSel.innerHTML = window.cardGroups.grpOnlyOptsHtml(groups, grpSel.value);
    window.cardGroups.bindNewGrp(grpSel, groups, function () { ckSaveGroups(ckTab, groups); });
  }
  function updateCkCount() {
    const useDefault = getCkDefault();
    let sysTotal = 0, mineTotal = 0;
    CK_DEFS.forEach(([k, def]) => {
      mineTotal += ckCustomList(k).length;
      if (useDefault) sysTotal += def.filter(x => !isCkCardOff(k, x)).length;
    });
    const cnt = document.getElementById('cc-checkin-count');
    if (cnt) cnt.textContent = sysTotal;
    const cntM = document.getElementById('cc-checkin-count-mine');
    if (cntM) cntM.textContent = mineTotal;
  }
  function switchCkTab2(tab) {
    ckTab2 = tab;
    const tabsWrap = document.getElementById('ck-tabs');
    if (tabsWrap) tabsWrap.querySelectorAll('.cc-tab').forEach(t => t.classList.toggle('sel', t.dataset.tab === tab));
    const sysPanel = document.getElementById('ck-sys-panel');
    const minePanel = document.getElementById('ck-mine-panel');
    if (sysPanel) sysPanel.hidden = tab !== 'sys';
    if (minePanel) minePanel.hidden = tab !== 'mine';
    if (tab === 'sys') renderCkSysList(); else renderCkMineList();
  }
  function renderCheckinCards() {
    // 顶部分类 tab
    document.querySelectorAll('#page-checkin-cards .fav-tab').forEach(tab => {
      tab.classList.toggle('sel', tab.dataset.cktab === ckTab);
    });
    const useDefault = getCkDefault();
    const defEl = document.getElementById('ck-default');
    if (defEl) defEl.checked = useDefault;
    refreshCkGrpSelect(); // v3.7.x：切换分类时刷新该分类的分组下拉
    switchCkTab2(ckTab2);
    updateCkCount();
  }
  // v3.6.x：使用系统预设字卡开关（默认开启；关闭后寻踪只从用户添加的字卡里抽）
  const ckDefaultEl = document.getElementById('ck-default');
  if (ckDefaultEl) {
    ckDefaultEl.addEventListener('change', () => {
      store.set(CK_DEF_KEY, ckDefaultEl.checked ? '1' : '0');
      renderCheckinCards();
      toast(ckDefaultEl.checked ? '系统预设字卡已开启' : '系统预设字卡已关闭（仅用你添加的字卡）');
    });
  }
  // 分类 tab 切换
  document.querySelectorAll('#page-checkin-cards .fav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      ckTab = tab.dataset.cktab;
      renderCheckinCards();
    });
  });
  // 系统预设/我的添加 双 tab 切换
  const ckTabsWrap = document.getElementById('ck-tabs');
  if (ckTabsWrap) {
    ckTabsWrap.querySelectorAll('.cc-tab').forEach(tab => {
      tab.addEventListener('click', () => { ckTab2 = tab.dataset.tab; switchCkTab2(ckTab2); });
    });
  }
  // 批量输入：每行一个，添加到当前分类（只追加到用户自定义库，不污染系统预设；v3.7.x 可选归入自定义分组）
  const batchAdd = document.getElementById('cck-batch-add');
  if (batchAdd) {
    refreshCkGrpSelect();
    batchAdd.addEventListener('click', () => {
      const ta = document.getElementById('cck-batch');
      const raw = ta ? ta.value : '';
      const items = raw.split('\n').map(s => s.trim()).filter(Boolean);
      if (!items.length) { toast('请输入内容，每行一个'); return; }
      const grpSel = document.getElementById('cck-batch-grp');
      const parsed = window.cardGroups.parseCatVal(grpSel ? grpSel.value : '');
      if (!parsed) { toast('请先选择分组'); return; }
      const list = ckItems(ckTab);
      items.forEach(it => {
        const x = { t: it };
        if (parsed.grp) x.grp = parsed.grp;
        list.push(x);
      });
      ckSaveItems(ckTab, list);
      if (ta) ta.value = '';
      renderCkMineList();
      updateCkCount();
      toast('已添加 ' + items.length + ' 条到「' + (CK_LABEL[ckTab] || ckTab) + '」');
    });
  }
  // v3.7.x：「＋分组」按钮（批量输入卡片标题行）
  const ckNewGrp = document.getElementById('ck-new-grp');
  if (ckNewGrp) {
    ckNewGrp.addEventListener('click', () => {
      const groups = ckGroups(ckTab);
      window.cardGroups.addFlow(groups, g => {
        if (!g) return;
        ckSaveGroups(ckTab, groups);
        refreshCkGrpSelect();
        if (ckTab2 === 'mine') renderCkMineList();
        toast('已新建分组「' + g.name + '」');
      });
    });
  }
  // 入口：字卡库「寻踪日常字卡」→ 管理页
  const liCK = document.getElementById('li-checkin-cards');
  const ckCardsPage = document.getElementById('page-checkin-cards');
  if (liCK && ckCardsPage) {
    liCK.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      ckCardsPage.hidden = false;
      ckTab2 = 'sys';
      const tw = document.getElementById('ck-tabs'); if (tw) tw.style.display = 'none';
      renderCheckinCards();
    });
  }
  // v3.9.x：「寻踪日常·我的添加」入口——只看自定义
  const liCKMine = document.getElementById('li-checkin-cards-mine');
  if (liCKMine && ckCardsPage) {
    liCKMine.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      ckCardsPage.hidden = false;
      ckTab2 = 'mine';
      const tw = document.getElementById('ck-tabs'); if (tw) tw.style.display = 'none';
      renderCheckinCards();
    });
  }
  const ckCardsBack = document.getElementById('checkin-cards-back');
  if (ckCardsBack) {
    ckCardsBack.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => p.hidden = true);
      const home = document.getElementById('page-chatcard');
      if (home) home.hidden = false;
    });
  }
  renderCheckinCards();
  // v3.9.x：注册寻踪日常字卡跨分类搜索
  window.__cardSearchFns = window.__cardSearchFns || [];
  window.__cardSearchFns.push({ name: '寻踪日常字卡', fn: function (kw) {
    const out = [];
    try {
      CK_DEFS.forEach(function (pair) {
        const k = pair[0]; const def = pair[1]; const label = CK_LABEL[k] || k;
        (def || []).forEach(function (x) { if (x && String(x).toLowerCase().indexOf(kw) >= 0) out.push({ t: String(x), cat: label + '·系统' }); });
        (ckCustomList(k) || []).forEach(function (item) { const txt = item && item.t ? item.t : ''; if (txt && txt.toLowerCase().indexOf(kw) >= 0) out.push({ t: txt, cat: label + '·我的' }); });
      });
    } catch (e) {}
    return out;
  } });

  // ================= 桌面第二页补充：今日备忘 / 今天的心情 / 本周日常 =================
  // 备忘/心情保存时写入历史（主页展示全部记录）
  // v3.7.x：备忘/心情按「天」显示——读当日快照（memo-YYYY-MM-DD / today-mood-YYYY-MM-DD），
  // 当天没写过就显示占位，第二天自动重新开始（前一天内容留在历史里，可点本周日常查看）。
  // 兼容：老版本只存固定键 memo/today-mood，无当日快照时视为「今天还没写」，不再把旧内容
  // 一直挂在桌面上（这正是"备忘/心情不每天刷新"的根因）。
  function todayMemoText() { return store.get('memo-' + dayStr(new Date())) || legacyToday('memo', 'memo-history'); }
  function todayMoodText() { return store.get('today-mood-' + dayStr(new Date())) || legacyToday('today-mood', 'mood-history'); }
  // v3.7.x 兼容升级：老版本把备忘/心情存在固定键（无日期）。当天历史第一条记录是今天写的
  // → 把固定键内容迁移成今日快照（老内容留在桌面、不丢），否则视为「今天还没写」。
  // 只迁移一次（迁移后已有快照，直接返回），无副作用。
  function legacyToday(curKey, histKey) {
    try {
      const list = JSON.parse(store.get(histKey) || '[]');
      if (list.length && list[0].ts &&
          new Date(list[0].ts).toDateString() === new Date().toDateString()) {
        const legacy = store.get(curKey);
        if (legacy) {
          const ds = dayStr(new Date());
          store.set(curKey + '-' + ds, legacy);
          try { if (window.idbSet) window.idbSet(window.activePrefix() + ':' + curKey + '-' + ds, legacy); } catch (e) {}
          return legacy;
        }
      }
    } catch (e) {}
    return '';
  }
  const memoEl = document.getElementById('memo-text');
  if (memoEl) {
    memoEl.textContent = todayMemoText() || '点这里记一句话';
    memoEl.addEventListener('click', () => {
      if (window.openModal) {
        window.openModal('今日备忘', memoEl.textContent === '点这里记一句话' ? '' : memoEl.textContent, (v) => {
          const val = (v || '').trim();
          if (val) {
            memoEl.textContent = val; store.set('memo', val); pushHist('memo-history', val);
            try { if (window.idbSet) window.idbSet(window.activePrefix() + ':memo', val); } catch (e) {}
            // v3.7.x：补写按日期快照，供本周日常点击其他日期查看当日备忘（桌面显示也读它）
            const ds = dayStr(new Date());
            store.set('memo-' + ds, val);
            try { if (window.idbSet) window.idbSet(window.activePrefix() + ':memo-' + ds, val); } catch (e) {}
          }
        });
      }
    });
  }
  const moodEl = document.getElementById('today-mood-text');
  if (moodEl) {
    moodEl.textContent = todayMoodText() || '点一下选心情';
    moodEl.addEventListener('click', () => {
      if (window.openModal) {
        const moods = ['开心', '平静', '想你', '忙碌', '困', '充实', '温柔'];
        window.openModal('今天的心情', '', (v) => {
          const val = (v || '').trim();
          if (val) {
            moodEl.textContent = val; store.set('today-mood', val); pushHist('mood-history', val);
            try { if (window.idbSet) window.idbSet(window.activePrefix() + ':today-mood', val); } catch (e) {}
            // v3.7.x：补写按日期快照，供本周日常点击其他日期查看当日心情（桌面显示也读它）
            const ds = dayStr(new Date());
            store.set('today-mood-' + ds, val);
            try { if (window.idbSet) window.idbSet(window.activePrefix() + ':today-mood-' + ds, val); } catch (e) {}
          }
        }, { pills: moods.map(m => ({ label: m, value: m })), pill: todayMoodText() || '' });
      }
    });
  }
  const weekEl = document.getElementById('week-days');
  if (weekEl) {
    // v3.5.37：统一布局——第一行周（日一二三四五六，今天显示「今」），第二行本周对应日期数字
    const names = ['日', '一', '二', '三', '四', '五', '六'];
    const now = new Date();
    const todayIdx = now.getDay();
    // 本周起始 = 本周日（getDay() 0 即周日，周一~周六往前推）
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - todayIdx);
    weekEl.innerHTML = names.map((n, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const ds = dayStr(d);
      return '<div class="week-day' + (i === todayIdx ? ' today' : '') + '" data-date="' + ds + '"' + (i === todayIdx ? '' : ' role="button"') + '><b>' + (i === todayIdx ? '今' : n) + '</b>' + d.getDate() + '</div>';
    }).join('');
    // v3.7.x：点击其他日期查看当日备忘与我们的心情（今天保持原状，数据已在桌面展示；
    // TA 的当日内容/留言归日历页查看，本周日常只保留属于我们自己的备忘与心情）
    weekEl.addEventListener('click', (ev) => {
      const cell = ev.target.closest('.week-day');
      if (!cell || cell.classList.contains('today')) return;
      // 装修模式下不触发查看（避免与卡片拖拽/编辑冲突）
      const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
      if (editing) return;
      const ds = cell.getAttribute('data-date');
      if (!ds || !window.openModal) return;
      const parts = ds.split('-');
      const dd = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      const wdNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const dateLabel = (+parts[1]) + ' 月 ' + (+parts[2]) + ' 日（' + wdNames[dd.getDay()] + '）';
      // v3.7.x bugfix：未来日期不生成不读取内容，只显示空态提示，避免"超前显示"
      const n2 = new Date();
      const isFuture = dd > new Date(n2.getFullYear(), n2.getMonth(), n2.getDate());
      // 备忘/心情：按日快照缺失时回退查当天历史（v3.7.x 之前老版本只存历史列表，
      // 没有 memo-YYYY-MM-DD / today-mood-YYYY-MM-DD 快照，直接读会显示"没有记录"）
      const histOnDay = function (histKey) {
        try {
          const list = JSON.parse(store.get(histKey) || '[]');
          const t = dd.toDateString();
          return list.filter(x => x && x.ts && new Date(x.ts).toDateString() === t)
            .map(x => x.text).filter(Boolean);
        } catch (e) { return []; }
      };
      const memo = isFuture ? '' : (store.get('memo-' + ds) || histOnDay('memo-history').join('；'));
      const mood = isFuture ? '' : (store.get('today-mood-' + ds) || histOnDay('mood-history').join('；'));
      const lines = [];
      lines.push(dateLabel);
      lines.push('');
      if (isFuture) {
        lines.push('（未来的日子还没有内容，等到了那一天再来看吧）');
      } else {
        lines.push('【今日备忘】');
        lines.push(memo || '（这一天没有备忘）');
        lines.push('');
        lines.push('【今天的心情】');
        lines.push(mood || '（这一天没有记录心情）');
      }
      window.openModal(ds + ' 当日备忘与心情', '', () => {}, { noInput: true, staticText: lines.join('\n') });
    });
  }

  // v3.6.x：多桌面——切换联系人后刷新桌面第二页常驻组件（备忘/心情按新桌面的值回显）。
  // store 动态绑定当前联系人，直接重读即可。
  document.addEventListener('contact-switched', function () {
    try {
      const memoEl2 = document.getElementById('memo-text');
      if (memoEl2) {
        memoEl2.textContent = todayMemoText() || '点这里记一句话';
      }
      const moodEl2 = document.getElementById('today-mood-text');
      if (moodEl2) {
        moodEl2.textContent = todayMoodText() || '点一下选心情';
      }
      // v3.7.x：关闭寻踪半框——否则切换后仍浮在新桌面显示旧桌面日常（数据串桌面）
      const ckPanel = document.getElementById('ck-panel');
      if (ckPanel) ckPanel.hidden = true;
    } catch (e) {}
  });
  // v3.7.x：跨天自动刷新——页面一直开着跨过午夜时，备忘/心情应显示新一天的空状态
  //（桌面其余按日内容（本周日常/倒计时）本身随日期重渲染，备忘/心情是持久化文本需手动刷）
  (function () {
    let lastDay = dayStr(new Date());
    setInterval(function () {
      if (document.hidden) return;
      try {
        const now = dayStr(new Date());
        if (now === lastDay) return;
        lastDay = now;
        const m = document.getElementById('memo-text');
        if (m) m.textContent = todayMemoText() || '点这里记一句话';
        const md = document.getElementById('today-mood-text');
        if (md) md.textContent = todayMoodText() || '点一下选心情';
      } catch (e) {}
    }, 30000);
  })();
})();

// ===== 功能：TA在身边·位置（寻踪半框内入口，位置面板独立词库） =====
// 位置卡 = 普通聊天消息（TA 发的 side=in），位置面板单独维护当前位置/时间线
// 收到位置卡时屏幕光点动效

// ===== 方位感知（v3.13.x）：TA在身边 → 不是GPS，是模糊的感知 =====
// 方向（8方向+身边/无法判断）+ 距离感 + 感知强度 三个模糊维度，随时间漂移；
// 字卡来自字卡库「TA在身边位置卡」新增的 direct/rangef/power/touch 四组（loc-lib.js 管理）。
// 感知状态存当前联系人（activeStore 的 loc-sense 键），随联系人隔离。

// ===== v3.x：世界观·他偶发出现（统一频率 + 浮层 + 打卡字卡） =====
// 梦角是灵体，常在身边但看不见；字卡表达有限，偶尔出得不准——不准配温柔解读。
// 供喝水/番茄钟/摸鱼/打卡复用，避免各功能各自造浮层刷屏。
(function () {
  function store() { try { return window.activeStore(); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function dayKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  // 他此刻近不近（基于位置卡 loc-current）
  window.taIsNear = function () {
    const s = store(); if (!s) return false;
    let cur = null; try { cur = JSON.parse(s.get('loc-current') || 'null'); } catch (e) {}
    if (!cur) return false;
    const t = cur.text || '';
    return /能摸到|没走远|身边|心里|感觉到|隐约|陪你|跟着|马上到/.test(t);
  };
  window.taSenseDesc = function () {
    const s = store(); if (!s) return '还没感觉到 TA…';
    let cur = null; try { cur = JSON.parse(s.get('loc-current') || 'null'); } catch (e) {}
    if (!cur) return '还没感觉到 TA…';
    const t = cur.text || '';
    if (t.indexOf('隔着世界') >= 0) return window.taFit ? window.taFit('TA 隔着世界，隐约在你身旁') : 'TA 隔着世界，隐约在你身旁';
    if (t.indexOf('感觉到') >= 0) return window.taFit ? window.taFit('你感觉到了 TA，就在附近') : '你感觉到了 TA，就在附近';
    if (t.indexOf('能摸到') >= 0) return window.taFit ? window.taFit('你能摸到 TA，很近很安心') : '你能摸到 TA，很近很安心';
    if (t.indexOf('没走远') >= 0) return window.taFit ? window.taFit('TA 一直没走远，就在身边') : 'TA 一直没走远，就在身边';
    if (t.indexOf('隐约') >= 0) return window.taFit ? window.taFit('TA 隐约在你身旁，感觉到了吗') : 'TA 隐约在你身旁，感觉到了吗';
    if (t.indexOf('身边') >= 0) return window.taFit ? window.taFit('TA 就在你身边，很安心') : 'TA 就在你身边，很安心';
    return window.taFit ? window.taFit('你感觉到 TA 在附近') : '你感觉到 TA 在附近';
  };

  // 统一频率：冷却 + 每日上限（localStorage 记录）
  window.taChimeAllow = function (key, opts) {
    opts = opts || {};
    const s = store(); if (!s) return false;
    const now = Date.now();
    if (opts.cooldown) { let last = 0; try { last = parseInt(s.get('ta-chime:' + key + ':last') || '0', 10) || 0; } catch (e) {} if (now - last < opts.cooldown) return false; }
    if (opts.dailyMax) { let rec = null; try { rec = JSON.parse(s.get('ta-chime:' + key + ':day') || 'null'); } catch (e) {} if (rec && rec.date === dayKey() && rec.n >= opts.dailyMax) return false; }
    return true;
  };
  window.taChimeUse = function (key) {
    const s = store(); if (!s) return;
    try { s.set('ta-chime:' + key + ':last', '' + Date.now()); } catch (e) {}
    let rec = null; try { rec = JSON.parse(s.get('ta-chime:' + key + ':day') || 'null'); } catch (e) {}
    if (!rec || rec.date !== dayKey()) rec = { date: dayKey(), n: 0 };
    rec.n++; try { s.set('ta-chime:' + key + ':day', JSON.stringify(rec)); } catch (e) {}
  };

  // 他偶发浮层（fixed 底部偏上，淡入淡出，4s 自隐）
  // v3.x.x：称呼跟随——所有桌面浮字统一在此按当前联系人性别替换 TA/他（显示层）
  // v3.13.x：opts.onClick——限时可点击浮字（摸鱼「抓包 TA」用）：展示期间 pointer-events
  //   开启并加 .grab 态，点中立即回调并提前收起；超时未点自然隐去（不回调）。
  let el = null, timer = null, clickFn = null;
  window.taChimeShow = function (text, opts) {
    opts = opts || {};
    if (window.taFit) text = window.taFit(text);
    if (!el) { el = document.createElement('div'); el.className = 'ta-chime-note'; document.body.appendChild(el); }
    const miss = opts.miss ? '<span class="ta-chime-miss">' + esc(window.taFit ? window.taFit(opts.miss) : opts.miss) + '</span>' : '';
    const grabTip = opts.onClick ? '<span class="ta-chime-grab-tip">点我抓包</span>' : '';
    el.innerHTML = '<span class="ta-chime-dot"></span><span class="ta-chime-text">' + esc(text) + '</span>' + miss + grabTip;
    clickFn = opts.onClick || null;
    el.classList.toggle('grab', !!clickFn);
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => { el.classList.remove('show', 'grab'); clickFn = null; }, opts.dur || 4200);
  };
  // 浮字点击代理（委托到常驻节点，抓包判定走 clickFn）
  document.addEventListener('click', (ev) => {
    if (!el || !el.classList.contains('grab') || !el.contains(ev.target)) return;
    const fn = clickFn; clickFn = null;
    el.classList.remove('show', 'grab');
    clearTimeout(timer);
    try { if (navigator.vibrate) navigator.vibrate([60, 40, 120]); } catch (e) {}
    if (fn) fn();
  }, true);

  // 打卡字卡：他递来一张；低概率"没控制住"配温柔解读。cb(card|null)，card={text, miss?}
  const CHECKIN_TA_CARDS = ['你今天也努力了', '我一直看着你呢', '又一起过了一天', '辛苦啦，过来抱抱', '嗯，今天也好好过来了', '你在，我就安心'];
  const CHECKIN_TA_MISS = ['（字卡有限，他想说的比这张多）', '（这张好像不是他想说的，别在意）', '（他没控制住，意思不全是这个）'];
  window.checkinTaCard = function (cb) {
    if (!window.taChimeAllow('checkin-ta', { cooldown: 24 * 3600 * 1000, dailyMax: 1 })) { if (cb) cb(null); return; }
    window.taChimeUse('checkin-ta');
    const miss = Math.random() < 0.22;
    const text = CHECKIN_TA_CARDS[Math.floor(Math.random() * CHECKIN_TA_CARDS.length)];
    const card = miss ? { text: text, miss: CHECKIN_TA_MISS[Math.floor(Math.random() * CHECKIN_TA_MISS.length)] } : { text: text };
    if (cb && window.taFit) { card.text = window.taFit(card.text); if (card.miss) card.miss = window.taFit(card.miss); }
    if (cb) cb(card);
  };
})();

// ===== v3.x：同频 / 伸手（桌面第三页图标，纯动态注入；不依赖 template.html / tabs.js 白名单） =====
// 世界观：梦角是灵体，常在身边但看不见，偶尔能感觉到、能摸到有体感；字卡表达有限。
// 同频：TA 此刻状态（字卡拼）+ 敲三下暗号（跨世界弱连接，甜蜜安稳，不往危机写）。
// 伸手：长按伸手，有概率摸到（震动+暖光+悄悄话字卡），有概率什么都没有——贴合"偶尔能感觉到"。

// ===== v3.x：世界观·TA 摸鱼值自动涨时桌面偶尔飘一行小字 =====
// TA 摸鱼值由 personalize.js 每 60s 60% 概率自动涨（"他在那边也偷了个懒"的来源）。
// 这里只做监听：值变化且通过频率控制（冷却 45 分钟 + 每日最多 12 次 + 35% 随机，
// 让"他一整天都可能摸鱼被看见"，又不至于刷屏）时，桌面浮一行小字。
// v3.13.x：浮字 6 秒内可点——「抓包成功」：这次涨值翻倍（TA 补一份 + 我得同额），
//   并触发一条害羞回应进聊天；不点就只是看着 TA 涨（原行为不变）。
(function () {
  let lastTa = null;
  // v3.13.x：浮字/抓包回应改走系统预设字卡池（DEFAULT_CARD_DATA.fish，字卡库「摸鱼浮字」
  // tab 同源可查看/逐张开关）；过滤用户已关闭的卡片，池缺失时回退内置兜底
  const FISH_NOTE_FALLBACK = ['ta在那边也偷了个懒'];
  const CATCH_REPLIES = [
    '呀…被你看到了',
    '才、才没有偷懒…好吧，被抓到了',
    '被你抓包了……脸有点烫',
    '哼，下次偷偷的，不让你发现',
    '抓到就抓到……要抱一下才肯继续摸',
    '……罚我陪你十分钟行不行'
  ];
  function fishPool(name, fallback) {
    let arr = (window.getFishPool ? window.getFishPool(name, fallback) : fallback).slice();
    if (window.isDefaultCardOff) arr = arr.filter(c => !window.isDefaultCardOff('fish', c));
    return arr.length ? arr : fallback.slice();
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function chk() {
    if (document.hidden) return;
    const s = window.activeStore && window.activeStore(); if (!s) return;
    let cur = 0; try { cur = parseInt(s.get('fish-total-ta') || '0', 10) || 0; } catch (e) {}
    if (lastTa === null) { lastTa = cur; return; }
    const delta = cur - lastTa;
    if (delta > 0 && window.taChimeAllow && window.taChimeAllow('fish-ta-note', { cooldown: 45 * 60 * 1000, dailyMax: 12 }) && Math.random() < 0.35) {
      window.taChimeUse('fish-ta-note');
      if (window.taChimeShow) {
        const note = pick(fishPool('摸鱼浮字', FISH_NOTE_FALLBACK));
        window.taChimeShow(note, {
          dur: 6000,
          onClick: function () {
            try {
              // 抓包奖励：本次涨值翻倍——TA 再补一份，我得同额
              const bonus = Math.max(1, delta);
              if (window.addFishPts) window.addFishPts(bonus, bonus);
              let rec = null;
              try { rec = JSON.parse(s.get('fish-catch-day') || 'null'); } catch (e) {}
              const dk = (function () { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
              if (!rec || rec.date !== dk) rec = { date: dk, n: 0 };
              rec.n++; s.set('fish-catch-day', JSON.stringify(rec));
              // v3.15.x：抓包事件写入主页「摸鱼抓包」记录（双向之一：我抓到 TA）
              if (window.addFishCatchRecord) {
                try { window.addFishCatchRecord('me', '抓包成功！双方摸鱼值 +' + bonus); } catch (e) {}
              }
              if (window.toast) window.toast(window.taFit ? window.taFit('抓包成功！双方摸鱼值 +' + bonus) : ('抓包成功！双方摸鱼值 +' + bonus));
              if (window.chatAddIn) {
                const r = pick(fishPool('抓包回应', CATCH_REPLIES));
                // v3.14.x：带「摸鱼抓包」标签 chip（addIn opts.tag），用户能看出这是抓包后的回应
                // v3.15.x：正文已在气泡里，chip 不再重复一遍 label——mood 自定义空 label，只留「摸鱼抓包」标签
                setTimeout(() => { try { window.chatAddIn(window.taFit ? window.taFit(r) : r, { mood: [{ tag: '摸鱼抓包', label: '' }] }); } catch (e) {} }, 900);
              }
            } catch (e) {}
          }
        });
      }
    }
    lastTa = cur;
  }
  setInterval(chk, 60 * 1000);
  setTimeout(chk, 5000);
  document.addEventListener('contact-switched', () => { lastTa = null; });
})();
