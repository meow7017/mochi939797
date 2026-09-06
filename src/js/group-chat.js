// ===== 功能：群聊页（所有桌面成员在一个窗口里聊天） =====
// 桌面点「群聊」进入；成员来自 window.getContacts()（所有联系人/桌面成员）；
// 用户发消息后随机 1-2 个成员回复，@昵称则被@的成员回复；
// 消息全局存储（xy-home-v2:group-chat-msgs），不随联系人切换变。
// 依赖：contacts.js（getContacts/storeFor/activeStore）、idb.js（idbGet/idbSet）、sfx.js（playSfx）
(function () {
  const body = document.getElementById('gc-body');
  if (!body) return;
  const G = 'xy-home-v2';
  const MSG_KEY = G + ':group-chat-msgs';
  const page = document.getElementById('page-group-chat');
  const input = document.getElementById('gc-input');
  const sendBtn = document.getElementById('gc-send');
  const backBtn = document.getElementById('gc-back');
  const nameEl = document.getElementById('gc-name');
  const typingEl = document.getElementById('gc-typing');
  const membersBtn = document.getElementById('gc-members-btn');
  const membersPanel = document.getElementById('gc-members-panel');
  const membersClose = document.getElementById('gc-mp-close');
  const membersBody = document.getElementById('gc-mp-body');
  const atPanel = document.getElementById('gc-at-panel');
  const atBody = document.getElementById('gc-at-body');
  // v3.11.x：输入栏与普通聊天页统一——更多功能/表情包/插入图片按钮 + 待发送图片草稿条
  // v3.16.x：群聊「更多功能」直接打开共享面板 #chat-more-panel（与聊天页同一套分类+功能按钮），
  // @群成员 收进共享面板分类 tabs 行最右（仅群聊打开时显示）
  const gcMoreBtn = document.getElementById('gc-input-more-btn');
  const gcMorePanel = document.getElementById('chat-more-panel');   // 共享浮层（.phone 级，聊天页也用它）
  const gcMoreAt = document.getElementById('gc-more-at');
  const gcEmojiBtn = document.getElementById('gc-emoji-btn');
  const gcImgBtn = document.getElementById('gc-img-btn');
  // v3.16.x：输入栏与聊天页对齐——语音「麦克风」/「继续说」/「批量发送」三个按钮
  // （显隐跟随当前桌面的聊天设置，与聊天页 cs-voice-send/cs-trigger-bar/cs-batch-send 一致）
  const gcMicBtn = document.getElementById('gc-mic-btn');
  const gcContinueBtn = document.getElementById('gc-continue-btn');
  const gcBatchBtn = document.getElementById('gc-batch-btn');
  const gcDraftBar = document.getElementById('gc-draft');
  const gcDraftItems = document.getElementById('gc-draft-items');

  const FALLBACK_REPLIES = ['好的～', '嗯嗯', '收到', '哈哈', '在的', '我知道啦', '是吗', '然后呢', '有意思', '同意', '哈哈哈', '对的', '没错', '我也觉得', '确实', '哇'];

  let msgs = [];
  const RENDER_MAX = 200;

  // ---- 群聊形象设置（v3.9.x，全局 xy-home-v2:gc-profiles，不随桌面隔离） ----
  // { me: {name, avatar}, <cid>: {name, avatar} }——设置了群聊昵称/头像的成员/我，
  // 在群聊页统一显示群聊形象；未设的字段回退该联系人桌面昵称/头像（lbl-*/avatar-*）。
  // 群聊是全局功能（消息/回复设置均全局），成员形象也全局存储，切换桌面不丢。
  const gcProfiles = {};
  function gcProfileStore() { try { return window.xyStore(G); } catch (e) { return null; } }
  function gcProfileLoad() {
    try {
      const v = gcProfileStore().get('gc-profiles');
      if (v) {
        const o = JSON.parse(v);
        if (o && typeof o === 'object') Object.keys(o).forEach(k => { gcProfiles[k] = o[k]; });
      }
    } catch (e) {}
  }
  function gcProfileSave() {
    try { gcProfileStore().set('gc-profiles', JSON.stringify(gcProfiles)); } catch (e) {}
  }
  function gcProfileGet(key) { return gcProfiles[key] || {}; }
  // 群聊名称（可自定义；留空 = 默认「群聊」；存全局，不随桌面切换）
  function gcGroupNameGet() {
    try { return (gcProfileStore().get('gc-group-name') || '').trim(); } catch (e) { return ''; }
  }
  function gcGroupNameSet(name) {
    try {
      if (name) gcProfileStore().set('gc-group-name', name);
      else gcProfileStore().remove('gc-group-name');
    } catch (e) {}
  }
  // name/avatar 传空串或 undefined = 清除该字段；两个都空则删除整条记录
  function gcProfileSet(key, name, avatar) {
    const p = gcProfiles[key] || (gcProfiles[key] = {});
    if (name === undefined) delete p.name; else if (name) p.name = name; else delete p.name;
    if (avatar === undefined) delete p.avatar; else if (avatar) p.avatar = avatar; else delete p.avatar;
    if (!p.name && !p.avatar) delete gcProfiles[key];
    gcProfileSave();
    refreshGroupViews();
  }
  // 群聊形象/成员变动后统一刷新（消息、成员面板、@面板、设置面板、标题）
  function refreshGroupViews() {
    try { renderAll(); } catch (e) {}
    try { if (membersPanel && !membersPanel.hidden) renderMembersPanel(); } catch (e) {}
    try { if (atPanel && !atPanel.hidden) renderAtPanel(); } catch (e) {}
    try { if (settingsPanel && !settingsPanel.hidden) renderSettingsPanel(); } catch (e) {}
    try { updateGroupName(); } catch (e) {}
  }
  gcProfileLoad();

  // ---- 群聊美化设置（v3.9.x，全局 xy-home-v2:gc-beauty，独立于聊天美化） ----
  // 只作用于群聊页 #page-group-chat：CSS 变量在 page 元素上局部覆盖（不串到聊天页，
  // 聊天页读的是 documentElement 上的同名变量）；壁纸/字体/自定义 CSS 也作用域到
  // 群聊页。存储只写非默认值；键名与聊天设置 cs-* 一一对应。
  const GC_BEAUTY_DEFAULTS = {
    'out-bg': '#111111', 'out-ink': '#ffffff', 'in-bg': '#ffffff', 'in-ink': '#111111',
    'send-bg': '#111111', 'send-ink': '#ffffff', 'send-show': 'show',
    'font-size': '14px', 'bubble-size': '9px 12px',
    'av-shape': 'circle', 'time-style': 'under-av',
    'bg': '', 'font': '', 'css': '',
    // v3.16.x：成员群聊昵称显示开关（on = 成员消息头像上方显示昵称，默认不显示）
    'show-name': 'off'
  };
  const GC_BEAUTY_STYLES = [
    { label: '头像下方', value: 'under-av' },
    { label: '气泡下方', value: 'under-bubble' },
    { label: '时间气泡', value: 'bubble' },
    { label: '气泡外侧悬浮', value: 'float' },
    { label: '消息上方居中', value: 'center' },
    { label: '隐藏', value: 'hidden' }
  ];
  const GC_FONT_SIZES = [
    { label: '小', value: '13px' },
    { label: '标准', value: '14px' },
    { label: '大', value: '16px' },
    { label: '特大', value: '18px' }
  ];
  const GC_BUBBLE_SIZES = [
    { label: '紧凑', value: '8px 10px' },
    { label: '标准', value: '11px 14px' },
    { label: '宽松', value: '14px 18px' }
  ];
  // 色板与聊天设置一致（气泡底色 / 文字色 / 发送按钮底）
  const GC_BUBBLE_BG = [
    { color: '#111111', label: '默认黑' }, { color: '#ffffff', label: '白色' }, { color: '#3a3a3a', label: '炭灰' },
    { color: '#ffd6e0', label: '樱花粉' }, { color: '#d6e4ff', label: '雾霭蓝' }, { color: '#d8f5e0', label: '薄荷绿' },
    { color: '#fff3d6', label: '奶油黄' }, { color: '#e8dcff', label: '淡紫' }, { color: '#ffdcc0', label: '暖橘' },
    { color: '#95ec69', label: '微信绿' }, { color: '#28b561', label: '深色绿' },
  ];
  const GC_INK_COLORS = [
    { color: '#111111', label: '默认黑' }, { color: '#ffffff', label: '白色' }, { color: '#444444', label: '深灰' },
    { color: '#d6336c', label: '玫红' }, { color: '#1a56db', label: '蓝' }, { color: '#1e8e5a', label: '绿' },
    { color: '#9a6b00', label: '黄褐' }, { color: '#7048e8', label: '紫' }, { color: '#b3540a', label: '橘' }
  ];
  const GC_SEND_BG = [
    { color: '#111111', label: '默认黑' }, { color: '#07c160', label: '微信绿' }, { color: '#fa5151', label: '红包红' },
    { color: '#3a8ee6', label: '天空蓝' }, { color: '#ff9500', label: '活力橙' }, { color: '#9254de', label: '优雅紫' },
    { color: '#ffffff', label: '白色' }, { color: '#3a3a3a', label: '炭灰' }
  ];
  const gcBeautyStored = {};
  // v3.11.x：深色模式下未自定义配色键的默认值（浅色默认白气泡/黑字在内联变量上
  // 压过 dark.css 覆盖，是深色模式群聊白块+黑字的根源）；用户自定义过仍优先
  const GC_DARK_DEFAULTS = { 'out-bg': '#3a3a3a', 'in-bg': '#2a2a2a', 'in-ink': '#f0f0f0', 'send-bg': '#f0f0f0', 'send-ink': '#111111' };
  function gcBeautyStore() { return gcProfileStore(); }
  function gcBeautyLoad() {
    try {
      const v = gcBeautyStore().get('gc-beauty');
      if (v) { const o = JSON.parse(v); if (o && typeof o === 'object') Object.keys(o).forEach(k => { gcBeautyStored[k] = o[k]; }); }
    } catch (e) {}
  }
  function gcBeautyGet(k) {
    if (gcBeautyStored[k] !== undefined) return gcBeautyStored[k];
    if (document.documentElement.getAttribute('data-theme') === 'dark' && GC_DARK_DEFAULTS[k] !== undefined) return GC_DARK_DEFAULTS[k];
    return GC_BEAUTY_DEFAULTS[k];
  }
  function gcBeautySave() { try { gcBeautyStore().set('gc-beauty', JSON.stringify(gcBeautyStored)); } catch (e) {} }
  // 设置（空值/默认值 → 删除键）；应用 + 刷新设置面板回显
  function gcBeautySet(k, v) {
    const def = GC_BEAUTY_DEFAULTS[k];
    if (v === undefined || v === null || v === '' || (def !== undefined && v === def)) delete gcBeautyStored[k];
    else gcBeautyStored[k] = v;
    gcBeautySave();
    applyGcBeauty();
    // v3.16.x：昵称显示开关变化需整页重渲（昵称在 renderMsg 里按开关生成）
    if (k === 'show-name') { try { renderAll(); } catch (e) {} }
    try { if (settingsPanel && !settingsPanel.hidden) renderSettingsPanel(); } catch (e) {}
  }
  // ---- 颜色对比度保护（v3.9.x 修复：黑底黑字消息看不见） ----
  // 用户在美化里把文字颜色设成与气泡同色（色板第一个「默认黑」很易误选）时，
  // 消息会完全不可见。这里按 WCAG 亮度算对比度：应用后 < 阈值则回滚并提示；
  // 设置面板里对存量低对比度组合显示警告行。
  const GC_MIN_CONTRAST = 2.2;
  const GC_COLOR_PAIRS = {
    'out-ink': ['out-bg', 'out-ink'],
    'out-bg': ['out-bg', 'out-ink'],
    'in-ink': ['in-bg', 'in-ink'],
    'in-bg': ['in-bg', 'in-ink']
  };
  function gcColorLum(hex) {
    const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function gcContrast(a, b) {
    const la = gcColorLum(a), lb = gcColorLum(b);
    if (la === null || lb === null) return null;
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  // key（四个颜色键之一）当前组合对比度是否过低的布尔
  function gcColorPairBad(key) {
  return false;
}
  // 设置面板里警告行文案（供 renderBeautyView 用）
  function gcColorWarnText(key) {
    const names = { 'out-bg': '我的气泡', 'in-bg': '联系人气泡' };
    const n = names[key] || '';
    return n + '：文字与气泡颜色太接近，消息可能看不清，建议改深/改浅';
  }
  // 群聊页局部字体（不污染全局 body/html）
  function applyGcFont() {
    const page = document.getElementById('page-group-chat');
    const old = document.getElementById('gc-font-style');
    if (old) old.remove();
    if (page) page.style.fontFamily = '';
    const v = gcBeautyGet('font');
    if (!v) return;
    if (v.indexOf('data:') === 0) {
      const st = document.createElement('style');
      st.id = 'gc-font-style';
      st.textContent = '@font-face{font-family:"gc-custom-font";src:url("' + String(v).replace(/<\/style/gi, '') + '");font-display:swap;}' +
        '#page-group-chat{font-family:"gc-custom-font",sans-serif !important;}';
      document.head.appendChild(st);
    } else {
      page.style.fontFamily = '"' + v.replace(/"/g, "'") + '",sans-serif';
    }
  }
  // 群聊页局部自定义气泡 CSS（选择器自动加 #page-group-chat 作用域）
  function applyGcCss() {
    const old = document.getElementById('gc-bubble-style');
    if (old) old.remove();
    const css = gcBeautyGet('css');
    if (!css) return;
    let out = css;
    if (css.indexOf('{') < 0) {
      out = '#page-group-chat .msg-out .msg-bubble{' + css + '!important;}' +
            '#page-group-chat .msg-in .msg-bubble{' + css + '!important;}';
    } else {
      out = css
        .replace(/\.msg-out\b/g, '#page-group-chat .msg-out')
        .replace(/\.msg-in\b/g, '#page-group-chat .msg-in')
        .replace(/\.message-sent\b/g, '#page-group-chat .msg-out .msg-bubble')
        .replace(/\.message-received\b/g, '#page-group-chat .msg-in .msg-bubble')
        .replace(/\.mb\.self\b/g, '#page-group-chat .msg-out .msg-bubble')
        .replace(/\.mb\.other\b/g, '#page-group-chat .msg-in .msg-bubble')
        .replace(/\.bubble-self\b/g, '#page-group-chat .msg-out .msg-bubble')
        .replace(/\.bubble-other\b/g, '#page-group-chat .msg-in .msg-bubble');
    }
    const st = document.createElement('style');
    st.id = 'gc-bubble-style';
    st.textContent = out;
    document.head.appendChild(st);
  }
  // 应用群聊美化（CSS 变量在 #page-group-chat 上局部覆盖；默认值与聊天页默认一致）
  function applyGcBeauty() {
    const page = document.getElementById('page-group-chat');
    if (!page) return;
    const g = gcBeautyGet;
    page.style.setProperty('--msg-in-bg', g('in-bg'));
    page.style.setProperty('--msg-in-ink', g('in-ink'));
    page.style.setProperty('--msg-out-bg', g('out-bg'));
    page.style.setProperty('--msg-out-ink', g('out-ink'));
    page.style.setProperty('--chat-font-size', g('font-size'));
    page.style.setProperty('--chat-bubble-pad', g('bubble-size'));
    page.style.setProperty('--chat-bubble-radius', '4px');
    page.style.setProperty('--send-bg', g('send-bg'));
    page.style.setProperty('--send-ink', g('send-ink'));
    page.style.setProperty('--msg-av-radius', g('av-shape') === 'square' ? '4px' : '50%');
    const sendBtn = document.getElementById('gc-send');
    if (sendBtn) sendBtn.style.display = g('send-show') === 'hide' ? 'none' : '';
    // 时间轴样式：page 级类（始终挂类，含默认 under-av 的还原规则，隔离聊天页 body 级类）
    GC_BEAUTY_STYLES.forEach(s => page.classList.remove('cs-time-' + s.value));
    page.classList.add('cs-time-' + g('time-style'));
    // 壁纸（>6MB 异常存量清掉回默认，同聊天页防护）
    let bg = g('bg');
    if (bg && typeof bg === 'string' && bg.length > 6 * 1024 * 1024) {
      try { gcBeautySet('bg', ''); } catch (e) {}
      bg = '';
    }
    const want = bg ? 'url("' + bg + '")' : '';
    if (page.style.backgroundImage !== want) {
      page.style.backgroundImage = want;
      if (bg) { page.style.backgroundSize = 'cover'; page.style.backgroundPosition = 'center'; }
    }
    applyGcFont();
    applyGcCss();
  }
  gcBeautyLoad();
  applyGcBeauty();
  // v3.14.x：IDB 回填完成后重载+重应用——gc-beauty 若只存于 IndexedDB（LS 写失败/被清理），
  // boot 时 load 读空走默认 → 重进后退回默认美化（与 chat-settings 气泡 CSS 同款兜底）
  document.addEventListener('mochi-restore-done', function () {
    try { gcBeautyLoad(); } catch (e) {}
    try { applyGcBeauty(); } catch (e) {}
  });
  // v3.11.x：深色/浅色切换时重算默认配色（html data-theme 属性变化即重写 page 级内联变量）
  try {
    new MutationObserver(() => { try { applyGcBeauty(); } catch (e) {} })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) {}

  // ---- 成员信息 ----
  function getMembers() {
    try { return window.getContacts() || [{ id: 'default', name: '默认' }]; } catch (e) { return [{ id: 'default', name: '默认' }]; }
  }
  function memberName(cid) {
    // v3.9.x：群聊昵称覆盖优先，未设置回退该联系人桌面昵称（lbl-partner）
    try { const p = gcProfileGet(cid); if (p.name) return p.name; } catch (e) {}
    try { const lbl = window.storeFor(cid).get('lbl-partner'); if (lbl) return lbl; } catch (e) {}
    const m = getMembers().find(x => x.id === cid);
    return m ? m.name : '成员';
  }
  function memberAvatar(cid) {
    try { const p = gcProfileGet(cid); if (p.avatar) return p.avatar; } catch (e) {}
    // v3.12.x：与聊天页一致——联系人换聊天头像只写聊天专用键 cs-avatar-partner（桌面独立），
    // 未设回退该联系人桌面 avatar-partner
    try { const cs = window.storeFor(cid).get('cs-avatar-partner'); if (cs) return cs; } catch (e) {}
    try { return window.storeFor(cid).get('avatar-partner') || ''; } catch (e) { return ''; }
  }
  function myName() {
    // v3.9.x：我的群聊昵称覆盖优先（群聊里"我"不再随切换桌面变化），未设置回退当前桌面
    try { const p = gcProfileGet('me'); if (p.name) return p.name; } catch (e) {}
    try { const v = window.activeStore().get('lbl-user'); if (v) return v; } catch (e) {}
    return '我';
  }
  function myAvatar() {
    try { const p = gcProfileGet('me'); if (p.avatar) return p.avatar; } catch (e) {}
    // v3.10.x：与聊天页一致——TA 换我头像只写聊天专用键 cs-avatar-user，未设回退桌面 avatar-user
    try { const cs = window.activeStore().get('cs-avatar-user'); if (cs) return cs; } catch (e) {}
    try { return window.activeStore().get('avatar-user') || ''; } catch (e) { return ''; }
  }
  // 桌面原本昵称（设置面板里"原昵称"区分用；我的取当前桌面）
  function deskPartnerName(cid) {
    try { const lbl = window.storeFor(cid).get('lbl-partner'); if (lbl) return lbl; } catch (e) {}
    const m = getMembers().find(x => x.id === cid);
    return m ? m.name : '';
  }
  function deskMeName() {
    try { return window.activeStore().get('lbl-user') || ''; } catch (e) { return ''; }
  }

  // ---- 头像渲染 ----
  function fillAv(el, dataUrl) {
    if (!el) return;
    el.innerHTML = '';
    if (dataUrl && dataUrl.length > 10 && dataUrl.length < 500 * 1024) {
      const img = document.createElement('img');
      img.src = dataUrl; img.alt = '';
      el.appendChild(img);
    } else {
      el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>';
    }
  }

  // ---- 消息存储（v3.26.x 止血：合并+低频+空闲落盘，避免大群聊每次消息同步全量写卡主线程） ----
  const G_PERSIST_MIN_GAP = 2500;   // 两次实际落盘最小间隔（ms）
  let gLastPersistAt = 0;           // 上次实际落盘（performance.now()）
  let gPersistTimer = null;         // 排队中标记（rIdle/timeout）
  let gPersistRun = null;           // 待执行落盘闭包（tail 只保留最新一次）
  function gRunPersist() {
    gPersistTimer = null;
    const run = gPersistRun;
    gPersistRun = null;
    if (!run) return;
    const wait = G_PERSIST_MIN_GAP - (performance.now() - gLastPersistAt);
    if (wait > 0) { gPersistTimer = setTimeout(gRunPersist, wait); return; }
    try { run(); gLastPersistAt = performance.now(); } catch (e) {}
  }
  function gSchedulePersist(writer) {
    gPersistRun = writer;
    if (gPersistTimer) return;
    if (window.requestIdleCallback) gPersistTimer = window.requestIdleCallback(gRunPersist, { timeout: 4000 });
    else gPersistTimer = setTimeout(gRunPersist, 2500);
  }
  function gFlushPersistNow() {
    const run = gPersistRun;
    gPersistRun = null;
    gPersistTimer = null;
    if (run) { try { run(); gLastPersistAt = performance.now(); } catch (e) {} }
  }
  function gcWriteMsgs() {
    const data = JSON.stringify(msgs);
    try { localStorage.setItem(MSG_KEY, data); } catch (e) {}
    try { if (window.idbSet) window.idbSet(MSG_KEY, data); } catch (e) {}
  }
  function saveMsgs() {
    gSchedulePersist(gcWriteMsgs);
  }
  function saveNow() {
    gFlushPersistNow();
    gcWriteMsgs();
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') gFlushPersistNow(); });
  window.addEventListener('beforeunload', () => gFlushPersistNow());
  function loadMsgs() {
    try { msgs = JSON.parse(localStorage.getItem(MSG_KEY) || '[]'); } catch (e) { msgs = []; }
    if (!Array.isArray(msgs)) msgs = [];
    try {
      if (window.idbGet) {
        window.idbGet(MSG_KEY).then(v => {
          if (v === undefined || v === null) return;
          try { const a = JSON.parse(v); if (Array.isArray(a) && a.length >= msgs.length) { msgs = a; renderAll(); } } catch (e) {}
        }).catch(() => {});
      }
    } catch (e) {}
  }

  // ---- 渲染 ----
  function fmtTime(ts) {
    const d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // v3.8.x：与 chat.js 的 escTxt/escTxtBr 对齐——全量转义 + 换行转 <br>。
  // 群聊气泡渲染与普通聊天页完全一致（此前用 textContent 设纯文本，多行消息不换行、
  // 且与普通聊天页的 span 包裹方式有差异）。
  function escTxt(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escTxtBr(s) { return escTxt(s).replace(/\n/g, '<br>'); }
  function attrEsc(s) { return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // 引用块（复用聊天页 .msg-quote 样式；图片/表情包引用只显示缩略图）
  // v3.16.x：支持 { t, imgs } 对象格式（气泡点「引用」后发送的组合引用，与聊天页 quoteValue 同构）
  // v3.26.x：与聊天页 quoteTextSafe 对齐的清理——历史/导入数据里语音引用存的是原始
  //   「名称|||data:audio;base64…」字符串（群聊早期版本成员回复引用直接存 userText 原文），
  //   直出会整串 base64 铺满屏幕。渲染前统一还原成可读标签，新数据本已是标签、原样通过。
  function gcQuoteTextSafe(s) {
    let str = String(s == null ? '' : s);
    const bar = str.indexOf('|||');
    if (bar >= 0) str = bar > 0 ? '[语音] ' + str.slice(0, bar) : '';
    const di = str.indexOf('data:');
    if (di > 0 && str.length - di > 120) str = str.slice(0, di).trim();
    return str;
  }
  function gcQuoteHtml(q) {
    if (q && typeof q === 'object' && Array.isArray(q.imgs) && q.imgs.length) {
      const tRaw = gcQuoteTextSafe(q.t);
      const tOk = typeof tRaw === 'string' && tRaw && tRaw.indexOf('data:') !== 0;
      return '<div class="msg-quote"><span class="msg-quote-imgs">' +
        q.imgs.map(s => '<img class="msg-quote-img" src="' + attrEsc(s) + '" alt="图片">').join('') +
        '</span>' + (tOk ? '<span class="msg-quote-text">' + escTxtBr(tRaw) + '</span>' : '') + '</div>';
    }
    if (q && typeof q === 'string') {
      const qs = gcQuoteTextSafe(q);
      if (qs.indexOf('data:') === 0) {
        return '<div class="msg-quote"><img class="msg-quote-img" src="' + attrEsc(qs) + '" alt="图片"></div>';
      }
      return '<div class="msg-quote"><span class="msg-quote-text">' + escTxtBr(qs) + '</span></div>';
    }
    return '';
  }
  // 群聊语音播放（聊天页 playVoiceInChat 在 chat.js 闭包内不暴露，群聊独立一份）
  let gcVoiceAudio = null;
  let gcVoiceBtn = null;
  function gcPlayVoice(btn, src) {
    if (!src) return;
    if (gcVoiceBtn === btn) { try { gcVoiceAudio.pause(); } catch (e) {} gcVoiceAudio = null; if (gcVoiceBtn) gcVoiceBtn.classList.remove('playing'); gcVoiceBtn = null; return; }
    if (gcVoiceBtn) { try { gcVoiceAudio.pause(); } catch (e) {} gcVoiceBtn.classList.remove('playing'); }
    const a = new Audio(src);
    gcVoiceAudio = a; gcVoiceBtn = btn;
    btn.classList.add('playing');
    // v3.12.x：播完/出错即卸掉 src——data: 音频的解码缓冲随元素存活，显式释放
    // 不等 GC（长时间群聊里每条语音一个 Audio，软滞留会在低内存安卓上累积）
    const stop = () => {
      try { a.removeAttribute('src'); a.load(); } catch (e) {}
      if (gcVoiceBtn) gcVoiceBtn.classList.remove('playing');
      gcVoiceBtn = null; gcVoiceAudio = null;
    };
    a.addEventListener('ended', stop);
    a.addEventListener('error', stop);
    a.play().catch(stop);
  }
  function renderMsg(rec, idx) {
    const m = document.createElement('div');
    m.className = 'msg ' + (rec.side === 'out' ? 'msg-out' : 'msg-in');
    if (idx === undefined) idx = msgs.length - 1;
    m.dataset.gcIdx = idx;
    const timeHtml = rec.ts ? '<span class="msg-time">' + fmtTime(rec.ts) + '</span>' : '';
    if (rec.side === 'out') {
      m.innerHTML = '<div class="msg-bubble"></div><div class="msg-side"><div class="msg-av"></div>' + timeHtml + '</div>';
    } else {
      // v3.16.x：可选显示成员群聊昵称（群聊设置→成员昵称显示，默认关）——
      // 昵称插在 .msg-side 首位（列向布局天然在头像上方），与聊天页无名字的旧表现兼容
      const nmHtml = gcBeautyGet('show-name') === 'on'
        ? '<span class="gc-from-name">' + escapeHtml(memberName(rec.cid)) + '</span>'
        : '';
      m.innerHTML = '<div class="msg-side">' + nmHtml + '<div class="msg-av"></div>' + timeHtml + '</div><div class="msg-bubble"></div>';
    }
    const av = m.querySelector('.msg-av');
    const b = m.querySelector('.msg-bubble');
    if (rec.side === 'out') fillAv(av, myAvatar());
    else fillAv(av, memberAvatar(rec.cid));
    // 拍一拍：居中系统样式
    if (rec.special === 'poke') {
      m.className = 'msg-poke';
      m.innerHTML = '<span>' + escTxt(rec.text || '') + '</span>';
      body.appendChild(m);
      pruneGcDom();
      return m;
    }
    const quoteStr = rec.quote ? gcQuoteHtml(rec.quote) : '';
    // v3.9.x：按消息类型渲染（与聊天页 renderMsg 对齐：表情包小图/图片大图/语音可播放）
    if (rec.retracted) {
      // v3.10.x：补齐点击查看原消息（与聊天页 bindToggle 一致）——原仅显示提示文本，
      // 无 cursor:pointer 且未绑 onclick，用户反馈"群聊无法点击查看撤回的消息"。
      b.dataset.orig = rec.orig || rec.text;
      const who = rec.side === 'out' ? '我' : memberName(rec.cid);
      b.innerHTML = '<span style="opacity:.6;font-size:12px;cursor:pointer">' + who + '撤回了一条消息</span>';
      b.style.cursor = 'pointer';
      b.onclick = function () {
        if (b.dataset.showing === '1') {
          b.innerHTML = '<span style="opacity:.6;font-size:12px;cursor:pointer">' + who + '撤回了一条消息</span>';
          b.dataset.showing = '0';
        } else {
          b.innerHTML = b.dataset.orig;
          b.dataset.showing = '1';
        }
      };
    } else if (rec.type === 'sticker' || rec.type === 'image') {
      b.classList.add('msg-media');
      b.style.padding = '6px';
      b.style.background = '';
      b.style.border = '';
      b.style.boxShadow = '';
      b.innerHTML = quoteStr + (rec.type === 'image'
        ? '<img class="msg-img msg-img-big" src="' + attrEsc(rec.text) + '" alt="图片" loading="lazy" decoding="async">'
        : '<img class="msg-img msg-img-sm" src="' + attrEsc(rec.text) + '" alt="表情" loading="lazy" decoding="async">');
    } else if (rec.type === 'voice') {
      b.style.padding = '8px 10px';
      b.style.background = '';
      b.style.border = '';
      b.style.boxShadow = '';
      const vparts = String(rec.text || '').split('|||');
      const vname = (vparts[0] || '语音消息').replace(/\.[^.]+$/, '');
      const vsrc = vparts[1] || '';
      b.innerHTML = quoteStr + '<div class="msg-voice" data-src="' + attrEsc(vsrc) + '">' +
        '<button class="msg-voice-play" title="播放">' +
        // 播放/暂停双图标：playing 时 CSS 切换显示（与 chat.js 聊天页语音气泡同款互动态）
        '<svg class="voice-ico-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
        '<svg class="voice-ico-pause" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>' +
        '</button>' +
        '<div class="msg-voice-wave"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<span class="msg-voice-name">' + escTxt(vname) + '</span>' +
        '</div>';
      b.querySelector('.msg-voice-play').addEventListener('click', function (e) {
        e.stopPropagation();
        gcPlayVoice(this, vsrc);
      });
    } else if (rec.parts && rec.parts.length) {
      const imgs = rec.parts.filter(p => p.k === 'img');
      const textPart = rec.parts.filter(p => p.k === 'text').map(p => p.v).join(' ');
      // 纯图片消息：去掉气泡色块/尖角（与表情包一致）；带文字的图片消息保留气泡
      if (imgs.length && !textPart) {
        b.classList.add('gc-media');
        b.style.padding = '0';
        b.style.background = 'transparent';
        b.style.border = 'none';
        b.style.boxShadow = 'none';
      }
      let inner = '';
      if (imgs.length) {
        inner += '<div class="msg-parts-imgs' + (imgs.length > 1 ? ' multi' : '') + '">' +
          imgs.map(p => {
            const isSticker = p.sub === 'sticker';
            return '<img class="msg-img' + (isSticker ? ' msg-img-sm' : ' msg-img-big') + '" src="' + attrEsc(p.v) + '" alt="' + (isSticker ? '表情' : '图片') + '" loading="lazy" decoding="async">';
          }).join('') + '</div>';
      }
      if (textPart) inner += '<span style="opacity:.85;word-break:break-word">' + escTxtBr(textPart) + '</span>';
      b.innerHTML = quoteStr + inner;
    } else {
      // v3.8.x：与 chat.js 一致——span 包裹 + 全量转义 + 换行转 <br>
      b.innerHTML = quoteStr + '<span style="opacity:.85">' + escTxtBr(rec.text || '') + '</span>';
    }
    // v3.16.x：心意字卡（情绪/心意/交流意图）渲染——与聊天页 renderMsg 同构，
    // label 与气泡正文完全相同时只留标签胶囊（与聊天页 dupBody 去重规则一致）
    if (rec.mood && rec.mood.length) {
      let mm = b.querySelector('.msg-moods');
      if (!mm) {
        mm = document.createElement('div');
        mm.className = 'msg-moods';
        b.appendChild(mm);
      }
      rec.mood.forEach(md => {
        if (!md) return;
        const tag = md.tag || '情绪';
        const label = md.label == null ? '' : String(md.label);
        mm.innerHTML += '<div class="msg-mood' + (md.tag === '交流意图' ? ' msg-intent' : '') + '"><span class="msg-mood-tag">' + escTxt(tag) + '</span>' +
          (label && label !== (rec.text || '') ? '<span>' + escTxt(label) + '</span>' : '') + '</div>';
      });
    }
    body.appendChild(m);
    pruneGcDom();
    return m;
  }
  function renderAll() {
    body.innerHTML = '';
    const n = msgs.length;
    const start = Math.max(0, n - RENDER_MAX);
    for (let i = start; i < n; i++) renderMsg(msgs[i], i);
    scrollToBottom();
  }
  function scrollToBottom() { try { body.scrollTop = body.scrollHeight; } catch (e) {} }
  // v3.16.x：新消息自动跟底——收发消息后调用；用户正回看历史（离底 >150px）时不打扰，
  // 贴底状态下始终跟随（此前只有 renderAll 进页时滚一次，停留页内收发都要手动下滑）
  function nearGcBottom() {
    try { return body.scrollHeight - body.scrollTop - body.clientHeight < 150; } catch (e) { return true; }
  }
  function followGcBottom(force) {
    try { if (force || nearGcBottom()) scrollToBottom(); } catch (e) {}
  }
  // v3.12.x：停留页内实时追加的 DOM 窗口上限——renderAll 只在进页时收窄到 RENDER_MAX，
  // 之后每条收发都走 renderMsg 直接 append，长时间泡在群里 DOM（含每条一个 dataURL 头像
  // img 的位图）无界增长 → 安卓 Chrome 渲染进程 OOM「网页崩溃」。超过窗口硬上限时从最早端
  // 裁剪：仅当用户贴近底部（正在看最新消息）才执行——回看历史时不动视口；贴底状态下浏览器
  // 会把 scrollTop 钳制到新的最大值，视觉仍停在最新一条。重新进群聊页 renderAll 会重渲。
  const GC_DOM_WINDOW = 400, GC_DOM_CUT = 320;
  function pruneGcDom() {
    try {
      if (body.children.length <= GC_DOM_WINDOW) return;
      if (body.scrollHeight - body.scrollTop - body.clientHeight > 400) return; // 远离底部：在看历史
      let excess = body.children.length - GC_DOM_CUT;
      while (excess-- > 0 && body.firstElementChild) body.firstElementChild.remove();
    } catch (e) {}
  }

  // ---- 发送 ----
  // v3.11.x：待发送图片（插入图片按钮多选 → 压缩 → 草稿条预览，随文字合并为一条组合消息）
  let gcDraftImgs = [];
  // v3.16.x：待引用内容（点气泡→引用 后暂存，随下一条发出的消息带上；{ text, imgs, idx }）
  let gcLastQuote = null;
  // 引用预览条（与聊天页 #chat-draft-quote 同款交互，元素在 template 的输入栏上方）
  function renderGcQuoteBar() {
    const qEl = document.getElementById('gc-quote-bar');
    if (!qEl) return;
    qEl.innerHTML = '';
    if (!gcLastQuote) { qEl.hidden = true; return; }
    qEl.hidden = false;
    const bar = document.createElement('div');
    bar.className = 'chat-draft-quote-bar';
    const thumb = (gcLastQuote.imgs && gcLastQuote.imgs.length) ? gcLastQuote.imgs[0] : null;
    if (thumb) {
      const img = document.createElement('img');
      img.className = 'chat-draft-quote-img';
      img.src = thumb;
      img.alt = '';
      bar.appendChild(img);
    }
    const t = document.createElement('span');
    t.className = 'chat-draft-quote-text';
    const raw = String(gcLastQuote.text || '');
    t.textContent = (thumb && raw.indexOf('data:') === 0) ? '' : (raw || '图片');
    bar.appendChild(t);
    const xBtn = document.createElement('button');
    xBtn.className = 'chat-draft-x chat-draft-quote-x';
    xBtn.textContent = '✕';
    xBtn.addEventListener('click', () => { gcLastQuote = null; renderGcDraft(); });
    bar.appendChild(xBtn);
    qEl.appendChild(bar);
  }
  function renderGcDraft() {
    if (!gcDraftBar || !gcDraftItems) return;
    renderGcQuoteBar();
    gcDraftItems.innerHTML = '';
    if (!gcDraftImgs.length && !gcLastQuote) { gcDraftBar.hidden = true; return; }
    gcDraftImgs.forEach((src, i) => {
      const it = document.createElement('div');
      it.className = 'chat-draft-item';
      const img = document.createElement('img');
      img.src = src; img.alt = '';
      const x = document.createElement('button');
      x.className = 'chat-draft-x';
      x.textContent = '✕';
      x.addEventListener('click', () => { gcDraftImgs.splice(i, 1); renderGcDraft(); });
      it.appendChild(img);
      it.appendChild(x);
      gcDraftItems.appendChild(it);
    });
    gcDraftBar.hidden = false;
  }
  // 组合消息：文字 + 插入图片（与聊天页 buildParts 同构；renderMsg 已支持 parts 渲染）
  function buildGcParts(t) {
    const parts = [];
    if (t) parts.push({ k: 'text', v: t });
    gcDraftImgs.forEach(src => parts.push({ k: 'img', v: src, sub: 'image' }));
    return parts;
  }
  // 取走待引用内容（与聊天页 quoteValue 同构：带图 → {t,imgs} 对象，纯文本 → 字符串）
  function gcTakeQuoteValue() {
    if (!gcLastQuote) return null;
    const q = (gcLastQuote.imgs && gcLastQuote.imgs.length)
      ? { t: gcLastQuote.text, imgs: gcLastQuote.imgs }
      : (gcLastQuote.text || null);
    gcLastQuote = null;
    return q;
  }
  function addMsg(text) {
    const t = (text || '').trim();
    const parts = buildGcParts(t);
    if (!parts.length) return;
    const rec = { side: 'out', text: t, ts: Date.now() };
    if (gcDraftImgs.length) rec.parts = parts;
    const qv = gcTakeQuoteValue();
    if (qv) rec.quote = qv;
    msgs.push(rec);
    saveMsgs();
    renderMsg(rec);
    followGcBottom(true);
    if (window.playSfx) window.playSfx('out');
    if (input) input.textContent = '';
    gcDraftImgs = [];
    renderGcDraft();
    scheduleReply(t);
  }
  // 表情包直接发送（复用聊天页表情包面板的插入模式回调，见下方 gc-emoji-btn）
  function sendGcSticker(src) {
    if (!src) return;
    const rec = { side: 'out', type: 'sticker', text: src, ts: Date.now() };
    const qv = gcTakeQuoteValue();
    if (qv) rec.quote = qv;
    msgs.push(rec);
    saveMsgs();
    renderMsg(rec);
    followGcBottom(true);
    if (window.playSfx) window.playSfx('out');
    // 表情不带文字，无 @提及，成员按概率随机回复
    scheduleReply('');
  }

  // ---- 回复内容生成（从该成员字卡池随机选，兜底数组） ----
  // v3.9.x：群聊回复全部走群聊回复设置（reply-settings.js 的 gc-* 键，全局生效）：
  // 每个联系人回复概率/回复速度/条数/拍一拍/表情包/emoji/图片/语音/颜文字/引用/撤回/多字卡
  function gcCfg() {
    const d = {
      'gc-prob': 60, 'gc-rs-min': 1, 'gc-rs-max': 40,
      'gc-reply-min': 1, 'gc-reply-max': 2,
      'gc-touch-prob': 5, 'gc-sticker-prob': 10, 'gc-emoji-prob': 5, 'gc-image-prob': 5, 'gc-voice-prob': 10,
      'gc-kaomoji-prob': 5, 'gc-quote-prob': 30, 'gc-rc-prob': 25, 'gc-rc-refix': 35,
      'gc-py-en': 1, 'gc-py-prob': 50, 'gc-py-min': 2, 'gc-py-max': 5
    };
    try {
      const c = (window.groupChatCfg && window.groupChatCfg()) || {};
      Object.keys(d).forEach(k => { if (c[k] === undefined) c[k] = d[k]; });
      return c;
    } catch (e) { return d; }
  }
  function hit(p) { return Math.random() * 100 < p; }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : ''; }
  function pickN(arr, n) {
    const copy = arr.slice();
    const out = [];
    while (copy.length && out.length < n) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    return out;
  }
  // v3.28.x：群聊成员回复前取回其字卡池的防卡死封装——hydrateLibForCid 内部串行
  // 取回 公用键 + 该成员专属键，最坏各 14s（idbHydrateKey 6s+8s）共 28s；慢 IDB
  // 手机上群回复被拖住十几秒像卡死。这里最多等 2.5s：取回完成就继续，超时也放行
  //（gcPool 的 For 系列 getter 下次回复仍会再触发取回，配合后台自愈最终用上自定义字卡）。
  function gcHydrateWait(cid) {
    try {
      if (!window.hydrateLibForCid) return Promise.resolve();
      return Promise.race([
        new Promise(function (res) { window.hydrateLibForCid(cid, res); }),
        new Promise(function (res) { setTimeout(res, 2500); })
      ]);
    } catch (e) { return Promise.resolve(); }
  }
  // 该成员的字卡池（按分类）：公用字卡 + 该成员桌面专属字卡 + 默认字卡兜底
  function gcPool(cid) {
    const text = [], kaomoji = [], emoji = [], sticker = [], image = [], voice = [];
    try {
      // 媒体字卡（表情包/图片/语音）——getMediaCardsFor 已合并 公用+该成员桌面专属
      const mediaSticker = (window.getMediaCardsFor && window.getMediaCardsFor(cid, 'sticker')) || [];
      const mediaImage = (window.getMediaCardsFor && window.getMediaCardsFor(cid, 'image')) || [];
      const mediaVoice = (window.getMediaCardsFor && window.getMediaCardsFor(cid, 'voice')) || [];
      sticker.push.apply(sticker, mediaSticker);
      image.push.apply(image, mediaImage);
      voice.push.apply(voice, mediaVoice);
      // v3.12.x：文字/emoji/颜文字改走 For 系列合并视图（公用+专属）。旧实现按
      // {key:{cards:[{type,text}]}} 解析 cc-groups，与实际存储 {类型:[[分组,[卡]]]}
      // 结构不符——专属文字/emoji/颜文字从未真正进过群聊回复池（静默失效）
      const pokeSet = (function () {
        const pk = (window.getPokeCardsFor && window.getPokeCardsFor(cid)) || [];
        return pk.length ? new Set(pk) : null;
      })();
      const cards = (window.getCustomCardsFor && window.getCustomCardsFor(cid)) || [];
      cards.forEach(c => {
        if (typeof c !== 'string' || !c) return;
        if (pokeSet && pokeSet.has(c)) return; // 拍一拍字卡只走拍一拍模式，不进普通回复池
        if (c.indexOf('data:') === 0) return; // 图片已按媒体分类取
        if (c.indexOf('|||') >= 0) return; // 语音已按媒体分类取
        if (/[\uD800-\uDBFF]/.test(c) || /^[😀-🙏🌀-🫿]/u.test(c)) emoji.push(c);
        else if (/[\(（｡◕(◕)(づ｡(¬)]/.test(c) && /[\)）】)]/.test(c)) kaomoji.push(c);
        else text.push(c);
      });
    } catch (e) {}
    // 默认字卡兜底——v3.12.x：开关全部按【该成员所在桌面】读（defaultCardApiFor）：
    // 该成员桌面关闭【聊天使用】/总开关/某分类 → 聊天和群聊里这个成员都不用默认字卡；
    // main 混入门对齐聊天页 getPool（开启即始终混入，颜文字/emoji 分类为空才补）
    try {
      const a = (window.defaultCardApiFor && window.storeFor) ? window.defaultCardApiFor(window.storeFor(cid)) : null;
      const dcfg = a ? a.cfg() : (window.defaultCardCfg && window.defaultCardCfg()) || {};
      const useChat = a ? a.use('chat') : (window.defaultCardUse ? window.defaultCardUse('chat') : true);
      const isOff = a ? a.isOff : (window.isDefaultCardOff || null);
      const catOn = a ? a.cat : (window.defaultCardCat || (() => true));
      if (dcfg.enabled !== false && useChat) {
        if (catOn('main')) {
          const defGrps = (window.getDefaultCardGroups && window.getDefaultCardGroups('main')) || [];
          defGrps.forEach(g => {
            (g[1] || []).forEach(card => {
              if (isOff && isOff('main', card)) return;
              if (typeof card !== 'string' || !card) return;
              if (/[\uD800-\uDBFF]/.test(card)) emoji.push(card);
              else if (/[\(（｡◕(◕)(づ｡(¬)]/.test(card) && /[\)）】)]/.test(card)) kaomoji.push(card);
              else text.push(card);
            });
          });
        }
        if (catOn('kaomoji') && !kaomoji.length) {
          const kg = (window.getDefaultCardGroups && window.getDefaultCardGroups('kaomoji')) || [];
          kg.forEach(g => (g[1] || []).forEach(card => { if (isOff && isOff('kaomoji', card)) return; if (typeof card === 'string' && card) kaomoji.push(card); }));
        }
        if (catOn('emoji') && !emoji.length) {
          const eg = (window.getDefaultCardGroups && window.getDefaultCardGroups('emoji')) || [];
          eg.forEach(g => (g[1] || []).forEach(card => { if (isOff && isOff('emoji', card)) return; if (typeof card === 'string' && card) emoji.push(card); }));
        }
      }
    } catch (e) {}
    return { text, kaomoji, emoji, sticker, image, voice };
  }
  // 生成一条成员回复（多字卡/表情包/emoji/图片/语音/颜文字，同聊天页 genOneReply 语义）
  function gcGenReply(cid, c) {
    const pool = gcPool(cid);
    let t, type = 'text';
    if (c['gc-py-en'] === 1 && hit(c['gc-py-prob']) && pool.text.length) {
      const n = randInt(c['gc-py-min'], c['gc-py-max']);
      t = pickN(pool.text, n).join(' ');
    } else {
      if (pool.sticker.length && hit(c['gc-sticker-prob'])) {
        t = pick(pool.sticker); type = 'sticker';
      } else if (pool.emoji.length && hit(c['gc-emoji-prob'])) {
        t = pick(pool.emoji);
      } else if (pool.image.length && hit(c['gc-image-prob'])) {
        t = pick(pool.image); type = 'image';
      } else if (pool.voice.length && hit(c['gc-voice-prob'])) {
        t = pick(pool.voice); type = 'voice';
      } else {
        t = pick(pool.text) || FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];
      }
    }
    if (type === 'text' && pool.kaomoji.length && hit(c['gc-kaomoji-prob'])) {
      t += ' ' + pick(pool.kaomoji);
    }
    // 组合消息：文字 + 表情包/图片 附加到同一条（同聊天页 genOneReply）
    let parts = null;
    if (type === 'text') {
      if (hit(c['gc-sticker-prob'] || 0) && pool.sticker.length) {
        parts = [{ k: 'text', v: t }, { k: 'img', v: pick(pool.sticker), sub: 'sticker' }];
      } else if (hit(c['gc-image-prob'] || 0) && pool.image.length) {
        parts = [{ k: 'text', v: t }, { k: 'img', v: pick(pool.image), sub: 'image' }];
      }
    }
    return { text: t, type: type, parts: parts };
  }
  // 成员拍一拍文本（该成员视角：成员名 + 字卡，含"你/我"按聊天页规则替换成我的称呼）
  function gcPokeText(cid) {
    const name = memberName(cid);
    let action = '';
    // v3.12.x：默认字卡按【该成员所在桌面】抽（含 聊天使用/总开关/拍一拍分类/单卡开关
    // 与整体概率 roll）——成员桌面关闭聊天使用 → 群聊里这个成员不用默认拍一拍
    try {
      const st = window.storeFor ? window.storeFor(cid) : null;
      const d = (st && window.getDefaultCardsFor) ? window.getDefaultCardsFor(st) : ((window.getDefaultCards && window.getDefaultCards()) || null);
      if (d && d.type === 'poke') action = d.text;
    } catch (e) {}
    if (!action) {
      // 自定义拍一拍：公用 + 该成员桌面专属 合并视图（getPokeCardsFor）
      const poke = (window.getPokeCardsFor && window.getPokeCardsFor(cid)) || [];
      action = poke.length ? pick(poke) : '拍了拍我';
    }
    let text;
    if (action.indexOf('你') >= 0) {
      if (action.charAt(0) === '你' || action.charAt(0) === '我') {
        text = name + ' ' + action.slice(1).replace(/你(?![们])/g, myName());
      } else {
        text = name + ' ' + action.replace(/你(?![们])/g, myName());
      }
    } else if (action.charAt(0) === '我') {
      text = name + ' ' + action.slice(1);
    } else {
      text = name + ' ' + action;
    }
    return text;
  }
  function showTyping(name) { if (typingEl) { typingEl.textContent = (name || '成员') + ' 正在输入…'; typingEl.hidden = false; } }
  function hideTyping() { if (typingEl) typingEl.hidden = true; }
  // v3.9.x：单条成员消息撤回（标记 + 局部重渲染）
  function retractGcMsg(idx) {
    if (idx < 0 || idx >= msgs.length) return;
    const rec = msgs[idx];
    if (!rec || rec.retracted) return;
    rec.retracted = true;
    saveMsgs();
    const target = body.querySelector('.msg[data-gc-idx="' + idx + '"]');
    if (target && target.parentNode) {
      const m = renderMsg(rec, idx);
      target.parentNode.replaceChild(m, target);
    }
  }
  // v3.9.x：成员回复——按群聊回复设置：回复速度/条数/拍一拍/表情包/emoji/图片/语音/
  // 颜文字/引用/撤回（含撤回补发），与聊天页被动回复语义一致
  function memberReply(cid, quoteText) {
    const c = gcCfg();
    const name = memberName(cid);
    const rsMin = Math.max(1, Number(c['gc-rs-min']) || 1);
    const rsMax = Math.max(rsMin, Number(c['gc-rs-max']) || rsMin);
    const delay = (rsMin + Math.random() * Math.max(1, rsMax - rsMin)) * 1000;
    showTyping(name);
    setTimeout(() => {
      hideTyping();
      // 拍一拍分支（同聊天页：命中则不回文字，直接拍）
      if (hit(c['gc-touch-prob'])) {
        const rec = { side: 'in', cid: cid, name: name, text: gcPokeText(cid), special: 'poke', ts: Date.now() };
        msgs.push(rec);
        saveMsgs();
        renderMsg(rec, msgs.length - 1);
        followGcBottom();
        if (window.playSfx) window.playSfx('in');
        return;
      }
      // 回复条数（min/max 调反时兜底至少 1 条）
      const rpMin = Math.max(1, Number(c['gc-reply-min']) || 1);
      const rpMax = Math.max(rpMin, Number(c['gc-reply-max']) || 2);
      const count = randInt(rpMin, rpMax);
      // 本轮整体掷一次引用（只给第一条带引用，防多条连续引用同一句）
      const wantQuote = hit(c['gc-quote-prob']) && !!quoteText;
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          hideTyping();
          (async () => {
          // v3.27.x：生成前先确保该成员字卡池就绪——成员桌面大键可能被启动回填
          // 挂起，同步读池是空库会让成员一直发 FALLBACK_REPLIES 兜底（上限 2.5s）
          try { await gcHydrateWait(cid); } catch (e) {}
          const rep = gcGenReply(cid, c);
          const q = (wantQuote && i === 0) ? quoteText : null;
          const rec = { side: 'in', cid: cid, name: name, text: rep.text, type: rep.type, parts: rep.parts, ts: Date.now() };
          if (q) rec.quote = q;
          // v3.16.x：心意字卡链（情绪→心意→交流意图）——与聊天页 replyOnce 同源同链
          //（triggerEmotionChain 内部自带总开关/单卡开关/概率与冷却），文本/表情/图片消息可挂
          if (rep.type === 'text' || rep.type === 'sticker' || rep.type === 'image') {
            try {
              const chain = (window.triggerEmotionChain && window.triggerEmotionChain()) || null;
              if (chain && chain.length) {
                const typeName = { mood: '情绪', heart: '心意', intent: '交流意图' };
                rec.mood = chain.map(it => ({ tag: typeName[it.type] || '情绪', label: it.content }));
              }
              if (window.addChatCount) window.addChatCount();
            } catch (e) {}
          }
          msgs.push(rec);
          saveMsgs();
          renderMsg(rec, msgs.length - 1);
          followGcBottom();
          if (window.playSfx) window.playSfx('in');
          if (i < count - 1) showTyping(name);
          const myIdx = msgs.length - 1;
          // 撤回 + 撤回补发
          if (hit(c['gc-rc-prob'])) {
            setTimeout(() => {
              retractGcMsg(myIdx);
              if (hit(c['gc-rc-refix'])) {
                showTyping(name);
                setTimeout(() => {
                  hideTyping();
                  (async () => {
                  try { await gcHydrateWait(cid); } catch (e) {}
                  const rep2 = gcGenReply(cid, c);
                  const rec2 = { side: 'in', cid: cid, name: name, text: rep2.text, type: rep2.type, parts: rep2.parts, ts: Date.now() };
                  if (rep2.type === 'text' || rep2.type === 'sticker' || rep2.type === 'image') {
                    try {
                      const chain2 = (window.triggerEmotionChain && window.triggerEmotionChain()) || null;
                      if (chain2 && chain2.length) {
                        const typeName2 = { mood: '情绪', heart: '心意', intent: '交流意图' };
                        rec2.mood = chain2.map(it => ({ tag: typeName2[it.type] || '情绪', label: it.content }));
                      }
                    } catch (e) {}
                  }
                  msgs.push(rec2);
                  saveMsgs();
                  renderMsg(rec2, msgs.length - 1);
                  followGcBottom();
                  if (window.playSfx) window.playSfx('in');
                  })();
                }, 700);
              }
            }, 900);
          }
          })();
        }, i * randInt(1200, 2800));
      }
    }, delay);
  }
  // v3.9.x：@ 的成员必定回复；其余成员按「每个联系人回复概率」独立掷骰，命中才回
  function scheduleReply(userText) {
    const members = getMembers();
    if (!members.length) return;
    const c = gcCfg();
    // 检测 @提及
    const mentioned = [];
    members.forEach(m => {
      const n = memberName(m.id);
      if (userText.indexOf('@' + n) >= 0) mentioned.push(m.id);
    });
    let targets;
    if (mentioned.length) {
      targets = mentioned.slice();
    } else {
      targets = members.filter(() => hit(c['gc-prob'])).map(m => m.id);
    }
    if (!targets.length) return;
    // 各成员独立排期回复（成员间错开更自然）
    targets.forEach((cid, i) => {
      setTimeout(() => memberReply(cid, userText), i * (1200 + Math.random() * 1600));
    });
  }

  // ---- 进入/退出 ----
  function updateGroupName() {
    // 人数 = 联系人个数 + 1（把自己算进去）
    const n = getMembers().length + 1;
    const nm = gcGroupNameGet() || '群聊';
    if (nameEl) nameEl.textContent = nm + '(' + n + ')';
  }
  function enterGroupChat() {
    const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
    if (editing) return;
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    if (page) page.hidden = false;
    updateGroupName();
    loadMsgs();
    renderAll();
    syncGcInputBtns(); // 进入群聊时按当前桌面设置刷新语音/继续说/批量按钮显隐
  }
  if (backBtn) backBtn.addEventListener('click', () => {
    saveNow();
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const home = document.getElementById('page-phone'); if (home) home.hidden = false;
  });

  // ---- 群聊按钮点击 ----
  const gcApp = document.querySelector('.app[data-app="group-chat"]');
  if (gcApp) gcApp.addEventListener('click', enterGroupChat);

  // ---- 发送按钮 ----
  if (sendBtn) sendBtn.addEventListener('click', () => addMsg(input.innerText));
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      addMsg(input.innerText);
    }
  });

  // ---- 成员列表面板 ----
  function renderMembersPanel() {
    if (!membersBody) return;
    membersBody.innerHTML = '';
    const meRow = document.createElement('div');
    meRow.className = 'gc-mp-item';
    // v3.9.x：显示群聊昵称（主）+ 桌面原昵称（副，区分用）
    const meDesk = deskMeName();
    meRow.innerHTML = '<div class="gc-mp-av"></div><span class="gc-mp-name">' + escapeHtml(myName()) +
      '<span class="gc-mp-sub">' + (meDesk ? '桌面昵称：' + escapeHtml(meDesk) : '') + '</span></span><span class="gc-mp-tag">我</span>';
    fillAv(meRow.querySelector('.gc-mp-av'), myAvatar());
    membersBody.appendChild(meRow);
    getMembers().forEach(m => {
      const row = document.createElement('div');
      row.className = 'gc-mp-item';
      const desk = deskPartnerName(m.id);
      row.innerHTML = '<div class="gc-mp-av"></div><span class="gc-mp-name">' + escapeHtml(memberName(m.id)) +
        '<span class="gc-mp-sub">' + (desk ? '桌面昵称：' + escapeHtml(desk) : '') + '</span></span>';
      fillAv(row.querySelector('.gc-mp-av'), memberAvatar(m.id));
      membersBody.appendChild(row);
    });
  }
  // 点击群名标题 → 打开成员面板（右上角三点菜单里也有「群成员」入口）
  if (nameEl) nameEl.addEventListener('click', () => { renderMembersPanel(); if (membersPanel) membersPanel.hidden = false; });
  if (membersClose) membersClose.addEventListener('click', () => { if (membersPanel) membersPanel.hidden = true; });

  // ---- 右上角三点菜单（v3.9.x：群成员 + 群聊设置） ----
  const moreBtn = document.getElementById('gc-more-btn');
  const moreMenu = document.getElementById('gc-more-menu');
  function showMoreMenu(v) { if (moreMenu) moreMenu.hidden = !v; }
  if (moreBtn) moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showMoreMenu(moreMenu.hidden);
  });
  document.addEventListener('click', () => showMoreMenu(false));
  const moreMembers = document.getElementById('gc-more-members');
  if (moreMembers) moreMembers.addEventListener('click', () => {
    showMoreMenu(false);
    renderMembersPanel();
    if (membersPanel) membersPanel.hidden = false;
  });
  const moreSettings = document.getElementById('gc-more-settings');
  if (moreSettings) moreSettings.addEventListener('click', () => {
    showMoreMenu(false);
    renderSettingsPanel();
    if (settingsPanel) settingsPanel.hidden = false;
  });

  // ---- 群聊设置面板（v3.9.x：我的群聊形象 + 成员群聊形象） ----
  const settingsPanel = document.getElementById('gc-settings-panel');
  const settingsBody = document.getElementById('gc-set-body');
  const settingsClose = document.getElementById('gc-set-close');
  // 轻提示（与全站一致）
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
  // 头像压缩（与聊天设置一致：最长边 256、JPEG 0.85）
  function compressHead(dataUrl, maxSide) {
    return new Promise((resolve) => {
      try {
        if (typeof dataUrl !== 'string' || !dataUrl || dataUrl.length > 8 * 1024 * 1024) { resolve(null); return; }
        const img = new Image();
        img.onload = () => {
          try {
            if (img.width * img.height > 26000000) { resolve(null); return; }
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', 0.85));
          } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      } catch (e) { resolve(null); }
    });
  }
  function pickAvatarFile(cb) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        compressHead(reader.result, 256).then(data => {
          if (!data) { toast('图片过大或格式不支持，请换一张小图'); return; }
          cb(data);
        });
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }
  // 渲染设置面板：主视图（我的群聊 + 成员群聊形象 + 美化入口） / 美化视图（同聊天设置的美化行）
  let gcBeautyView = false;
  function setPanelTitle(t) {
    try {
      const h = settingsPanel && settingsPanel.querySelector('.gc-set-head span');
      if (h) h.textContent = t || '群聊设置';
    } catch (e) {}
  }
  function renderSettingsPanel() {
    if (!settingsBody) return;
    settingsBody.innerHTML = '';
    if (gcBeautyView) { setPanelTitle('美化聊天'); renderBeautyView(); return; }
    setPanelTitle('群聊设置');
    renderMainSettingsView();
  }
  function renderMainSettingsView() {
    const esc = escapeHtml;
    const item = (key, curName, curAv, deskName) => {
      const row = document.createElement('div');
      row.className = 'gc-set-item';
      const hasOverride = !!(curName || curAv);
      row.innerHTML =
        '<div class="gc-set-av"></div>' +
        '<div class="gc-set-info">' +
          '<div class="gc-set-name">' + esc(curName || '跟随桌面') + (key === 'me' ? '<span class="gc-set-tag">我</span>' : '') + '</div>' +
          '<div class="gc-set-desk">' + (deskName ? '桌面昵称：' + esc(deskName) : '') + '</div>' +
        '</div>' +
        '<div class="gc-set-ops">' +
          '<button class="gc-set-btn" data-op="av">' + (curAv ? '换头像' : '设头像') + '</button>' +
          '<button class="gc-set-btn" data-op="name">' + (curName ? '改昵称' : '设昵称') + '</button>' +
          (hasOverride ? '<button class="gc-set-btn ghost" data-op="reset">重置</button>' : '') +
        '</div>';
      // 预览：群聊当前生效头像（覆盖优先，回退桌面头像）
      let effAv = curAv;
      if (!effAv) { try { effAv = key === 'me' ? myAvatar() : memberAvatar(key); } catch (e) {} }
      fillAv(row.querySelector('.gc-set-av'), effAv || '');
      row.querySelector('[data-op="av"]').addEventListener('click', () => {
        pickAvatarFile(data => gcProfileSet(key, undefined, data));
      });
      row.querySelector('[data-op="name"]').addEventListener('click', () => {
        if (!window.openModal) return;
        window.openModal(key === 'me' ? '我的群聊昵称' : '成员群聊昵称', curName, (v) => {
          gcProfileSet(key, (v || '').trim(), undefined);
        }, { maxlength: 30 });
      });
      if (hasOverride) {
        row.querySelector('[data-op="reset"]').addEventListener('click', () => {
          gcProfileSet(key, '', '');
        });
      }
      return row;
    };
    // —— 群聊名称（可自定义，显示在标题 + 人数前） ——
    const gNameRow = document.createElement('div');
    gNameRow.className = 'gc-set-item gc-set-link';
    gNameRow.innerHTML =
      '<div class="gc-set-av">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/></svg>' +
      '</div>' +
      '<div class="gc-set-info">' +
        '<div class="gc-set-name">群聊名称</div>' +
        '<div class="gc-set-desk">' + (gcGroupNameGet() || '群聊') + '</div>' +
      '</div>' +
      '<span class="gc-set-chev">›</span>';
    gNameRow.addEventListener('click', () => {
      if (!window.openModal) return;
      window.openModal('群聊名称', gcGroupNameGet(), (v) => {
        gcGroupNameSet((v || '').trim());
        renderSettingsPanel();
        updateGroupName();
      }, { maxlength: 30 });
    });
    settingsBody.appendChild(gNameRow);
    // —— 我的群聊 ——
    const t1 = document.createElement('div');
    t1.className = 'gc-set-title';
    t1.textContent = '我的群聊';
    settingsBody.appendChild(t1);
    const meP = gcProfileGet('me');
    settingsBody.appendChild(item('me', meP.name || '', meP.avatar || '', deskMeName()));
    // —— 成员群聊形象 ——
    const t2 = document.createElement('div');
    t2.className = 'gc-set-title';
    t2.textContent = '成员群聊形象';
    settingsBody.appendChild(t2);
    getMembers().forEach(m => {
      const p = gcProfileGet(m.id);
      settingsBody.appendChild(item(m.id, p.name || '', p.avatar || '', deskPartnerName(m.id)));
    });
    // —— 成员昵称显示（v3.16.x：是否在消息头像上方显示群聊昵称） ——
    const nmRow = beautyRow('成员昵称显示', gcBeautyGet('show-name') === 'on' ? '头像上方显示' : '不显示', () => {
      pickGcPills('show-name', '成员昵称显示', [
        { label: '头像上方显示', value: 'on' }, { label: '不显示', value: 'off' }
      ], 'off');
    });
    settingsBody.appendChild(nmRow);
    // —— 美化聊天入口（v3.9.x） ——
    const bRow = document.createElement('div');
    bRow.className = 'gc-set-item gc-set-link';
    bRow.innerHTML =
      '<div class="gc-set-av">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/></svg>' +
      '</div>' +
      '<div class="gc-set-info">' +
        '<div class="gc-set-name">美化聊天</div>' +
        '<div class="gc-set-desk">气泡颜色、壁纸、字体、时间轴样式等</div>' +
      '</div>' +
      '<span class="gc-set-chev">›</span>';
    bRow.addEventListener('click', () => { gcBeautyView = true; renderSettingsPanel(); });
    settingsBody.appendChild(bRow);
    // —— 底部说明 ——
    const note = document.createElement('div');
    note.className = 'gc-set-note';
    note.textContent = '成员回复内容来自：公用字卡 + 该成员桌面专属字卡 + 系统默认字卡；某成员桌面关闭【聊天使用】，聊天和群聊里这个成员都不再使用系统默认字卡。';
    settingsBody.appendChild(note);
  }

  // ================= 美化视图（与聊天设置同款行） =================
  function beautyRow(label, val, fn) {
    const row = document.createElement('div');
    row.className = 'gc-set-row';
    row.innerHTML = '<span class="txt">' + escapeHtml(label) + '</span><span class="val">' + escapeHtml(val) + '</span><span class="chev">›</span>';
    row.addEventListener('click', fn);
    return row;
  }
  // 文字颜色色板里「默认黑」易被误认为默认选项（文字色默认其实是白色），
  // 在群聊美化里把第一格改标「黑色」，避免用户选成黑字黑底看不见
  function gcInkSwatches() {
    return GC_INK_COLORS.map(s => s.color === '#111111' ? { color: '#111111', label: '黑色' } : s);
  }
  function pickGcColor(key, title, swatches) {
    if (!window.openModal) return;
    const cur = gcBeautyGet(key);
    window.openModal(title, '', (v) => {
      const color = (typeof v === 'number' && swatches[v]) ? swatches[v].color : v;
      if (!color) return;
      const prev = gcBeautyGet(key);
      gcBeautySet(key, color);
      // 对比度保护：文字/气泡同色系 → 回滚并提示（防黑底黑字）
      if (gcColorPairBad(key)) {
        gcBeautySet(key, prev);
        toast('已恢复：该颜色与气泡太接近，消息会看不清');
      }
    }, { colorPicker: true, color: cur, swatches: swatches });
  }
  function pickGcPills(key, title, pills, def) {
    if (!window.openModal) return;
    window.openModal(title, '', (v) => { if (v) gcBeautySet(key, v); }, {
      pills: pills, pill: gcBeautyGet(key) || def, noInput: true
    });
  }
  // 群聊壁纸上传（同聊天设置：按物理像素上限压缩）
  function pickGcWallpaper() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            const screenH = (window.screen && window.screen.height) || 1920;
            const maxSide = Math.min(4096, Math.max(2160, Math.round(screenH * dpr)));
            const c = document.createElement('canvas');
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            c.width = Math.max(1, Math.round(img.width * scale));
            c.height = Math.max(1, Math.round(img.height * scale));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            gcBeautySet('bg', c.toDataURL('image/jpeg', 0.85));
            toast('群聊壁纸已应用');
          } catch (e) { toast('壁纸处理失败，请换一张'); }
        };
        img.onerror = () => { toast('图片读取失败，请换一张'); };
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }
  // 气泡框大小（openTCPanel 预设 + 自定义，同聊天设置）
  function pickGcBubbleSize() {
    if (!window.openTCPanel) return;
    const cur = gcBeautyGet('bubble-size');
    window.openTCPanel('聊天气泡框大小', '' +
      '<div class="sm-fld"><label>预设大小</label><select class="tc-input" id="gc-pad-preset">' +
      '<option value="">自定义</option>' +
      GC_BUBBLE_SIZES.map(p => '<option value="' + p.value + '"' + (p.value === cur ? ' selected' : '') + '>' + p.label + '</option>').join('') +
      '</select></div>' +
      '<div class="sm-fld"><label>自定义（格式：上下 左右，如 <code>8px 10px</code>）</label>' +
      '<input class="tc-input" id="gc-pad-input" value="' + String(cur).replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"></div>' +
      '<div class="sm-set-hint">示例：紧凑 8px 10px · 标准 11px 14px · 宽松 14px 18px</div>' +
      '<div class="mail-actions"><button class="cc-tool" id="gc-pad-cancel">取消</button><button class="cc-tool" id="gc-pad-ok">应用</button></div>');
    document.getElementById('gc-pad-cancel').addEventListener('click', () => { document.getElementById('tc-mask').hidden = true; });
    document.getElementById('gc-pad-preset').addEventListener('change', () => {
      const v = document.getElementById('gc-pad-preset').value;
      if (v) document.getElementById('gc-pad-input').value = v;
    });
    document.getElementById('gc-pad-ok').addEventListener('click', () => {
      let v = (document.getElementById('gc-pad-input').value || '').trim();
      if (!v) { toast('请输入气泡框大小'); return; }
      // 规范化：数字+px 或 纯数字（默认px），已带 px 的 token 不动
      v = String(v).split(/[,\s]+/).filter(Boolean).map(function (tok) {
        return /^-?\d+(?:\.\d+)?px$/.test(tok) ? tok : tok.replace(/^(-?\d+(?:\.\d+)?)$/, '$1px');
      }).join(' ');
      gcBeautySet('bubble-size', v);
      document.getElementById('tc-mask').hidden = true;
      toast('气泡框大小已应用');
    });
  }
  // 群聊字体（上传 / 名字，作用域仅群聊页）
  function pickGcFont() {
    if (!window.openTCPanel) return;
    const cur = gcBeautyGet('font');
    window.openTCPanel('群聊字体', '' +
      '<div class="sm-fld"><label>上传本地字体（ttf / otf / woff / woff2），只对群聊页生效</label>' +
      '<input class="tc-input" id="gc-font-name" placeholder="也可直接输入字体名，如 Microsoft YaHei"' + (cur && cur.indexOf('data:') !== 0 && cur.indexOf('http') !== 0 ? ' value="' + String(cur).replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"' : '') + '></div>' +
      '<div class="mail-actions"><button class="cc-tool" id="gc-font-upload">上传字体</button><button class="cc-tool" id="gc-font-clear">恢复默认</button><button class="cc-tool" id="gc-font-ok">应用</button></div>');
    document.getElementById('gc-font-upload').addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.ttf,.otf,.woff,.woff2';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        toast('正在读取字体文件…');
        const reader = new FileReader();
        reader.onload = () => {
          gcBeautySet('font', reader.result);
          document.getElementById('tc-mask').hidden = true;
          toast('字体已应用（群聊页）');
        };
        reader.onerror = () => { toast('字体文件读取失败，请重试'); };
        reader.readAsDataURL(f);
      };
      inp.click();
    });
    document.getElementById('gc-font-clear').addEventListener('click', () => {
      gcBeautySet('font', '');
      document.getElementById('tc-mask').hidden = true;
      toast('已恢复默认字体');
    });
    document.getElementById('gc-font-ok').addEventListener('click', () => {
      const name = (document.getElementById('gc-font-name').value || '').trim();
      if (!name) { toast('请输入字体名'); return; }
      gcBeautySet('font', name);
      document.getElementById('tc-mask').hidden = true;
      toast('字体已应用（群聊页）');
    });
  }
  // 气泡 CSS（openTCPanel 文本框，作用域自动加 #page-group-chat）
  function pickGcCss() {
    if (!window.openTCPanel) return;
    window.openTCPanel('气泡 CSS', '' +
      '<div class="sm-fld-hint" style="margin-bottom:8px">输入自定义样式，只对群聊页生效，支持两种写法：<br>· 直接写声明，如 <code>border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.1)</code>（自动应用到双方气泡）<br>· 或写选择器，如 <code>.msg-out .msg-bubble{...}</code></div>' +
      '<textarea id="gc-css-input" class="tc-input" rows="6" placeholder="border-radius: 20px;' + '&#10;box-shadow: 0 2px 8px rgba(0,0,0,.12);"></textarea>' +
      '<div class="mail-actions"><button class="cc-tool" id="gc-css-clear">清空</button><button class="cc-tool" id="gc-css-ok">应用</button></div>');
    const ta = document.getElementById('gc-css-input');
    if (ta) ta.value = gcBeautyGet('css');
    document.getElementById('gc-css-clear').addEventListener('click', () => {
      gcBeautySet('css', '');
      document.getElementById('tc-mask').hidden = true;
      toast('已清空气泡样式');
    });
    document.getElementById('gc-css-ok').addEventListener('click', () => {
      // v3.14.x：安卓 ce-box 读空兜底（同 chat-settings cssReadVal，防存空串丢样式）
      const el = document.getElementById('gc-css-input');
      let v = '';
      try { v = el ? (el.value || '') : ''; } catch (e) {}
      if (!String(v).trim() && el) {
        try {
          const box = el.__ceBox || (el.parentNode && el.parentNode.querySelector('.ce-box[data-for="' + (el.id || '') + '"]'));
          const t = box ? (box.innerText || box.textContent || '') : '';
          if (String(t).trim()) v = String(t);
        } catch (e) {}
      }
      gcBeautySet('css', String(v).trim());
      document.getElementById('tc-mask').hidden = true;
      toast('气泡样式已应用');
    });
  }
  function renderBeautyView() {
    const g = gcBeautyGet;
    // 返回主设置
    const back = document.createElement('div');
    back.className = 'gc-set-back';
    back.innerHTML = '<span class="arr">‹</span> 返回群聊设置';
    back.addEventListener('click', () => { gcBeautyView = false; renderSettingsPanel(); });
    settingsBody.appendChild(back);
    const gtitle = (t) => { const d = document.createElement('div'); d.className = 'gc-set-title'; d.textContent = t; settingsBody.appendChild(d); };
    const add = (label, val, fn) => settingsBody.appendChild(beautyRow(label, val, fn));
    const bgLabel = (v, def) => v === def ? '默认 ' + def : v;
    // —— 壁纸 ——
    gtitle('壁纸');
    add('聊天壁纸', g('bg') ? '已设置' : '未设置', () => pickGcWallpaper());
    if (g('bg')) add('清空群聊壁纸', '', () => { gcBeautySet('bg', ''); toast('已恢复默认壁纸'); });
    // —— 气泡与文字 ——
    gtitle('气泡与文字');
    add('我的气泡颜色', bgLabel(g('out-bg'), '#111111'), () => pickGcColor('out-bg', '我的气泡颜色', GC_BUBBLE_BG));
    add('我的消息文字颜色', bgLabel(g('out-ink'), '#ffffff'), () => pickGcColor('out-ink', '我的消息文字颜色', gcInkSwatches()));
    add('联系人气泡颜色', bgLabel(g('in-bg'), '#ffffff'), () => pickGcColor('in-bg', '联系人气泡颜色', GC_BUBBLE_BG));
    add('联系人消息文字颜色', bgLabel(g('in-ink'), '#111111'), () => pickGcColor('in-ink', '联系人消息文字颜色', gcInkSwatches()));
    // 存量低对比度警告（我的/联系人气泡与文字同色系时提示）
    const warnRow = (key) => {
      if (!gcColorPairBad(key)) return;
      const w = document.createElement('div');
      w.className = 'gc-set-warn';
      w.textContent = '⚠️ ' + gcColorWarnText(key);
      settingsBody.appendChild(w);
    };
    warnRow('out-bg');
    warnRow('in-bg');
    // —— 发送按钮 ——
    gtitle('发送按钮');
    add('发送按钮显示/隐藏', g('send-show') === 'hide' ? '隐藏' : '显示', () => pickGcPills('send-show', '显示发送按钮', [
      { label: '显示', value: 'show' }, { label: '隐藏', value: 'hide' }
    ], 'show'));
    add('发送按钮颜色', bgLabel(g('send-bg'), '#111111'), () => pickGcColor('send-bg', '发送按钮颜色', GC_SEND_BG));
    add('发送文字颜色', bgLabel(g('send-ink'), '#ffffff'), () => pickGcColor('send-ink', '发送文字颜色', GC_INK_COLORS));
    // —— 气泡外观 ——
    gtitle('气泡外观');
    add('聊天气泡字体大小', (GC_FONT_SIZES.find(p => p.value === g('font-size')) || {}).label || g('font-size'), () => pickGcPills('font-size', '聊天气泡字体大小', GC_FONT_SIZES, '14px'));
    add('聊天气泡框大小', (GC_BUBBLE_SIZES.find(p => p.value === g('bubble-size')) || { label: '自定义' }).label, () => pickGcBubbleSize());
    add('聊天头像形状', g('av-shape') === 'square' ? '方形' : '圆形', () => pickGcPills('av-shape', '聊天头像形状', [
      { label: '圆形', value: 'circle' }, { label: '方形', value: 'square' }
    ], 'circle'));
    add('时间轴样式', (GC_BEAUTY_STYLES.find(s => s.value === g('time-style')) || {}).label || '头像下方', () => pickGcPills('time-style', '时间轴样式', GC_BEAUTY_STYLES, 'under-av'));
    // —— 字体与样式 ——
    gtitle('字体与样式');
    add('群聊字体', g('font') ? (g('font').indexOf('data:') === 0 ? '已上传' : g('font')) : '默认', () => pickGcFont());
    add('气泡 CSS', g('css') ? '已设置' : '默认', () => pickGcCss());
  }
  if (settingsClose) settingsClose.addEventListener('click', () => { if (settingsPanel) settingsPanel.hidden = true; });
  if (settingsPanel) settingsPanel.addEventListener('click', (e) => { if (e.target === settingsPanel) settingsPanel.hidden = true; });

  // ---- @提及面板 ----
  function renderAtPanel() {
    if (!atBody) return;
    atBody.innerHTML = '';
    getMembers().forEach(m => {
      const row = document.createElement('div');
      row.className = 'gc-at-item';
      const n = memberName(m.id);
      row.innerHTML = '<div class="gc-at-av"></div><span>' + escapeHtml(n) + '</span>';
      fillAv(row.querySelector('.gc-at-av'), memberAvatar(m.id));
      row.addEventListener('click', () => {
        if (input) {
          const cur = input.innerText;
          input.innerText = cur + (cur && !cur.endsWith(' ') ? ' ' : '') + '@' + n + ' ';
          input.focus();
          try { const r = document.createRange(); r.selectNodeContents(input); r.collapse(false); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
        }
        if (atPanel) atPanel.hidden = true;
      });
      atBody.appendChild(row);
    });
  }

  // ---- v3.16.x：输入栏与聊天页对齐的左侧/右侧功能按钮 ----
  // 显隐跟随当前桌面聊天设置（与聊天页 syncMicBtn/syncBatchBtn/applyContinueSayUI 同源）
  function gcSettingOn(key) {
    try { return window.activeStore().get(key) === '1'; } catch (e) { return false; }
  }
  function syncGcInputBtns() {
    if (gcMicBtn) gcMicBtn.style.display = gcSettingOn('cs-voice-send') ? '' : 'none';
    if (gcContinueBtn) gcContinueBtn.style.display = gcSettingOn('cs-trigger-bar') ? '' : 'none';
    if (gcBatchBtn) gcBatchBtn.style.display = gcSettingOn('cs-batch-send') ? '' : 'none';
  }
  // 「继续说」：和聊天页 continueChat 同语义——强制让成员回复（无 @ 时随机 1-2 个，不按回复概率过滤）
  function gcContinueSay() {
    const members = getMembers();
    if (!members.length) return;
    const mentioned = [];
    if (input) {
      const t = (input.innerText || '').trim();
      members.forEach(m => { if (t.indexOf('@' + memberName(m.id)) >= 0) mentioned.push(m.id); });
    }
    const chosen = mentioned.length
      ? mentioned.slice()
      : members.slice(0, Math.max(1, Math.min(2, members.length))).map(m => m.id);
    chosen.forEach((cid, i) => {
      setTimeout(() => memberReply(cid, ''), i * (1200 + Math.random() * 1600));
    });
    if (window.playSfx) window.playSfx('in');
  }
  // 语音：复用聊天页录音半框，录完发到群聊
  function gcSendVoice(dataUrl, durSec) {
    const name = '语音 ' + durSec + '″';
    const rec = { side: 'out', text: name + '|||' + dataUrl, type: 'voice', ts: Date.now() };
    msgs.push(rec);
    saveMsgs();
    renderMsg(rec, msgs.length - 1);
    followGcBottom(true);
    if (window.playSfx) window.playSfx('out');
    scheduleReply('');
  }
  // 批量发送：复用聊天页批量面板，条目发到群聊（文字/图片/表情各成一条）
  function gcSendBatch(items) {
    (items || []).forEach(it => {
      if (!it) return;
      if (it.type === 'text') {
        const t = (it.text || '').trim();
        if (!t) return;
        const rec = { side: 'out', text: t, ts: Date.now() };
        msgs.push(rec);
        saveMsgs();
        renderMsg(rec, msgs.length - 1);
      } else if (it.type === 'img') {
        const rec = { side: 'out', text: it.src, parts: [{ k: 'img', v: it.src, sub: 'image' }], ts: Date.now() };
        msgs.push(rec);
        saveMsgs();
        renderMsg(rec, msgs.length - 1);
      } else if (it.type === 'sticker') {
        const rec = { side: 'out', type: 'sticker', text: it.src, ts: Date.now() };
        msgs.push(rec);
        saveMsgs();
        renderMsg(rec, msgs.length - 1);
      }
    });
    followGcBottom(true);
    if (window.playSfx) window.playSfx('out');
    scheduleReply('');
  }
  if (gcContinueBtn) gcContinueBtn.addEventListener('click', (e) => { e.stopPropagation(); gcContinueSay(); });
  if (gcMicBtn) gcMicBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!window.openVoicePanelFor) return;
    if (gcMorePanel) { gcMorePanel.hidden = true; gcSetMoreTopbar(false); }
    window.openVoicePanelFor(gcSendVoice);
  });
  if (gcBatchBtn) gcBatchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!window.openBatchPanelFor) return;
    if (gcMorePanel) { gcMorePanel.hidden = true; gcSetMoreTopbar(false); }
    window.openBatchPanelFor(gcSendBatch);
  });
  syncGcInputBtns();
  document.addEventListener('voice-send-changed', syncGcInputBtns);
  document.addEventListener('batch-send-changed', syncGcInputBtns);
  document.addEventListener('continue-say-changed', syncGcInputBtns);
  // 切换桌面后（群聊成员/设置可能变化）刷新按钮显隐
  document.addEventListener('contact-switched', syncGcInputBtns);

  // ---- 输入栏「更多功能」面板：群聊打开共享面板 #chat-more-panel（与聊天页同款交互）----
  // @群成员 顶部栏仅在群聊打开面板时显示；面板里的功能按钮是聊天页的（handler 在 chat.js），
  // 群聊里点击任功能按钮 → 自动切到聊天页并打开对应功能（双人互动功能在聊天页使用）
  function gcSetMoreTopbar(show) {
    if (gcMoreAt) gcMoreAt.hidden = !show;
  }
  if (gcMoreBtn && gcMorePanel) {
    gcMoreBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止冒泡到 document（chat.js 有面板外关闭监听，避免 toggle 冲突）
      if (gcMorePanel.hidden) {
        // 收起输入法，面板不被键盘遮挡（与聊天页 moreBtn 行为一致）
        try { if (window.closeIme) window.closeIme(); } catch (err) {}
        try { input.blur(); } catch (err) {}
        gcSetMoreTopbar(true);
        // v3.26.x：群聊打开更多面板 → 进入「群聊模式」：只保留【工具】分类，且只留 帮我决定/多人决定/搜索记录/占卜，
        // 禁止使用【小游戏】【TA的提问】【互动】功能（其余分类 tab 与功能按钮在群聊模式中被隐藏）。
        if (window.setMoreGroupMode) window.setMoreGroupMode(true);
        else if (window.applyMoreCat) window.applyMoreCat('tool');
      }
      gcMorePanel.hidden = !gcMorePanel.hidden;
      if (gcMorePanel.hidden) gcSetMoreTopbar(false);
    });
    // 群聊里点面板内的功能按钮（.more-item）→ 切到聊天页打开功能
    // 用捕获阶段：功能按钮的 handler（chat.js）里都有 e.stopPropagation()，冒泡阶段监听不到；
    // 捕获阶段先切页，随后按钮 handler 在聊天页上下文执行（打开半框）。
    gcMorePanel.addEventListener('click', (e) => {
      const item = e.target.closest('.more-item');
      if (!item) return;
      // @群成员 不走切换，保留群聊内打开
      if (gcMoreAt && (item === gcMoreAt || item.contains(gcMoreAt))) return;
      gcMorePanel.hidden = true;
      gcSetMoreTopbar(false);
      // 切到聊天页（面板功能按钮的 handler 都在聊天页上下文；半框也在聊天页内）
      const chatPage = document.getElementById('page-chat');
      if (chatPage && chatPage.hidden) {
        document.querySelectorAll('.page').forEach(p => p.hidden = true);
        chatPage.hidden = false;
      }
    }, true);
  }
  // @群成员：从共享面板顶部栏打开成员选择（仅群聊有）
  if (gcMoreAt) gcMoreAt.addEventListener('click', (e) => {
    e.stopPropagation();
    if (gcMorePanel) gcMorePanel.hidden = true;
    gcSetMoreTopbar(false);
    renderAtPanel();
    if (atPanel) atPanel.hidden = false;
  });

  // ---- 表情包按钮：复用聊天页同一个表情包面板（写信/回信同款插入模式回调）----
  if (gcEmojiBtn) gcEmojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!window.openEmojiPanelForInsert) return;
    // allowUrl：链接保存的表情在群聊里直接发送（仅信纸插入才限 data:）
    window.openEmojiPanelForInsert((src) => sendGcSticker(src), { allowUrl: true });
    // mail-emoji-mode 会把面板压低到 bottom:64px（写信页布局），群聊页与聊天页一致用默认 96px
    document.body.classList.remove('mail-emoji-mode');
  });

  // ---- 插入图片按钮：多选图片 → 压缩 → 草稿条预览，随发送合并为组合消息（同聊天页）----
  if (gcImgBtn) gcImgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true;
    fi.onchange = () => {
      const files = Array.prototype.slice.call(fi.files || []);
      if (!files.length) return;
      files.forEach(f => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            try {
              const c = document.createElement('canvas');
              const scale = Math.min(1, 720 / Math.max(img.width, img.height));
              c.width = Math.max(1, Math.round(img.width * scale));
              c.height = Math.max(1, Math.round(img.height * scale));
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
              gcDraftImgs.push(c.toDataURL('image/jpeg', 0.85));
            } catch (err) {
              gcDraftImgs.push(reader.result);
            }
            renderGcDraft();
          };
          // 解码失败（HEIC/损坏图）按原图兜底，不静默丢失
          img.onerror = () => {
            gcDraftImgs.push(reader.result);
            renderGcDraft();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(f);
      });
    };
    fi.click();
  });

  // 点击面板背景关闭
  if (atPanel) atPanel.addEventListener('click', (e) => { if (e.target === atPanel) atPanel.hidden = true; });

  // ---- 消息气泡操作菜单（v3.16.x：点气泡弹出「引用」，与聊天页 #msg-actions 同款交互）----
  const gcMsgActions = document.getElementById('gc-msg-actions');
  let gcActiveMsgEl = null;
  function closeGcMsgActions() {
    if (gcMsgActions) gcMsgActions.hidden = true;
    gcActiveMsgEl = null;
  }
  // 消息快照 → 待引用内容（与聊天页 quote 分支同构：语音/表情/图片转占位文案）
  function gcQuoteSnapOf(rec) {
    let qimgs = (rec.parts || []).filter(p => p.k === 'img').map(p => p.v).slice(0, 3);
    if (!qimgs.length && (rec.type === 'sticker' || rec.type === 'image')
      && typeof rec.text === 'string' && rec.text.indexOf('data:') === 0) qimgs.push(rec.text);
    let qtext = rec.text;
    if (rec.type === 'voice') qtext = '[语音] ' + String(qtext || '').split('|||')[0];
    else if (rec.type === 'sticker') qtext = '表情包';
    else if (qimgs.length && String(qtext || '').indexOf('data:') === 0) qtext = '图片';
    return { text: qtext, imgs: qimgs, idx: msgs.indexOf(rec) };
  }
  if (body && gcMsgActions) {
    // v3.26.x：群聊消息操作菜单（引用）同样支持「长按 + 轻点」双手势，与聊天页保持一致
    function gcOpenMsgActions(item, bk) {
      gcActiveMsgEl = item;
      gcMsgActions.hidden = false;
      // 定位：气泡上方居中，放不下换下方；clamp 在视口内（与聊天页同款算法）
      try {
        const bRect = bk.getBoundingClientRect();
        const aw = gcMsgActions.offsetWidth || 120;
        const ah = gcMsgActions.offsetHeight || 50;
        const vv = window.visualViewport;
        const vw = vv ? vv.width : window.innerWidth;
        const vh = vv ? vv.height : window.innerHeight;
        let x = bRect.left + bRect.width / 2 - aw / 2;
        x = Math.max(10, Math.min(vw - aw - 10, x));
        let y = bRect.top - ah - 8;
        const below = bRect.bottom + 8;
        const aboveFits = y >= 50;
        const belowFits = below + ah <= vh - 8;
        y = aboveFits || !belowFits ? y : below;
        gcMsgActions.style.left = x + 'px';
        gcMsgActions.style.top = y + 'px';
      } catch (err) {}
    }
    let gcHoldTimer = null;
    let gcHoldEl = null;
    let gcSuppressClickUntil = 0;
    body.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.msg-bubble') && !e.target.closest('.msg-quote')) e.preventDefault();
    });
    body.addEventListener('touchstart', (e) => {
      const bk = e.target.closest('.msg-bubble');
      if (!bk) return;
      if (e.target.closest('.msg-quote')) return;               // 引用块点击留给后续跳原消息
      const item = bk.closest('.msg');
      if (!item || item.classList.contains('msg-poke')) return; // 拍一拍居中条不弹
      if ((bk.textContent || '').indexOf('撤回了一条消息') >= 0) return; // 撤回提示有专属点击
      gcHoldEl = item;
      gcHoldTimer = setTimeout(() => {
        gcHoldTimer = null;
        gcSuppressClickUntil = Date.now() + 800; // 松开后抑制随之而来的轻点，防菜单被刚弹即关
        if (window.getSelection) { try { const s = window.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (err) {} }
        gcOpenMsgActions(gcHoldEl, bk);
      }, 500);
    }, { passive: true });
    function endGcHold() { if (gcHoldTimer) { clearTimeout(gcHoldTimer); gcHoldTimer = null; } }
    body.addEventListener('touchmove', endGcHold, { passive: true }); // 手指滑动=滚动，取消长按
    body.addEventListener('touchend', endGcHold);
    body.addEventListener('touchcancel', endGcHold);
    body.addEventListener('click', (e) => {
      if (gcSuppressClickUntil && Date.now() < gcSuppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
      const bk = e.target.closest('.msg-bubble');
      if (!bk) return;
      const item = bk.closest('.msg');
      if (!item) return;
      if (item.classList.contains('msg-poke')) return;          // 拍一拍居中条不弹
      if (e.target.closest('.msg-quote')) return;               // 引用块点击留给后续跳原消息
      if ((bk.textContent || '').indexOf('撤回了一条消息') >= 0) return; // 撤回提示有专属点击（查看原文）
      e.stopPropagation();
      gcOpenMsgActions(item, bk);
    });
    document.addEventListener('click', (e) => {
      if (!gcMsgActions.hidden && !gcMsgActions.contains(e.target)) closeGcMsgActions();
    });
    gcMsgActions.addEventListener('click', (e) => {
      const btn = e.target.closest('.ma-btn');
      if (!btn) return;
      if (btn.dataset.act === 'quote' && gcActiveMsgEl) {
        const idx = Number(gcActiveMsgEl.dataset.gcIdx);
        const rec = (idx >= 0 && msgs[idx]) ? msgs[idx] : null;
        if (rec) {
          gcLastQuote = gcQuoteSnapOf(rec);
          renderGcDraft();
          try { if (input) input.focus(); } catch (err) {}
        }
      }
      closeGcMsgActions();
    });
  }

  // ---- 切联系人：消息全局不变，刷新群名 + 重渲染（"我"头像/成员名可能变） ----
  document.addEventListener('contact-switched', function () {
    try { hideTyping(); } catch (e) {}
    updateGroupName();
    renderAll();
    try { if (settingsPanel && !settingsPanel.hidden) renderSettingsPanel(); } catch (e) {}
  });

  // 暴露（供数据备份/回归测试用）
  window.groupChatGetMsgs = function () { return msgs.slice(); };
  window.groupChatClear = function () { msgs = []; saveNow(); renderAll(); };
  window.groupChatProfileGet = function (key) { try { return JSON.parse(JSON.stringify(gcProfileGet(key))); } catch (e) { return {}; } };
  // name/avatar：传 undefined 保持不变，传空串清除该字段
  window.groupChatProfileSet = function (key, name, avatar) { gcProfileSet(key, name, avatar); };
  window.groupChatBeautyGet = function (k) { return gcBeautyGet(k); };
  // 设置群聊美化（空值/默认值 = 恢复默认）
  window.groupChatBeautySet = function (k, v) { gcBeautySet(k, v); };
  // v3.12.x：只读探针——某成员当前回复字卡池（公用+专属+按其桌面开关的默认字卡），
  // 供回归测试/作用域问题诊断（不暴露内部引用，返回纯数据副本）
  window.groupChatPoolFor = function (cid) {
    try { return JSON.parse(JSON.stringify(gcPool(cid))); } catch (e) { return null; }
  };

  // ===== v3.x：群聊主动发送（成员主动来找你聊天，等同聊天页的「主动发送」） =====
  // 设置读 xy-home-v2:gc-as-* 全局键（回复设置 → 群聊 → 主动发送 段）：
  //   en=总开关(1/0) · prob=命中概率% · min/max=发送间隔分钟 · count-min/count-max=发送条数
  function gcAsCfg() {
    const s = gcProfileStore();
    const get = function (k, d) {
      try { const v = s.get('reply-gc-as-' + k); if (v !== null && v !== undefined && v !== '') return v; } catch (e) {}
      return d;
    };
    return {
      en: get('en', '1'),
      prob: Number(get('prob', 25)),
      min: Number(get('min', 20)),
      max: Number(get('max', 60)),
      countMin: Number(get('count-min', 1)),
      countMax: Number(get('count-max', 2))
    };
  }
  function gcAsSendOne(cid) {
    const name = memberName(cid);
    const rep = gcGenReply(cid, gcCfg());
    const rec = { side: 'in', cid: cid, name: name, text: rep.text, type: rep.type, parts: rep.parts, ts: Date.now() };
    msgs.push(rec);
    saveMsgs();
    renderMsg(rec, msgs.length - 1);
    followGcBottom();
    if (window.playSfx) window.playSfx('in');
  }
  function gcTryAutoSend() {
    try {
      const c = gcAsCfg();
      if (c.en !== '1') return;
      if (document.hidden) return;
      if (Math.random() * 100 >= c.prob) return;
      const members = getMembers();
      if (!members.length) return;
      const count = randInt(Math.max(1, c.countMin), Math.max(c.countMin, c.countMax));
      const pool = members.slice();
      for (let i = 0; i < count && pool.length; i++) {
        const pickIdx = Math.floor(Math.random() * pool.length);
        const m = pool.splice(pickIdx, 1)[0];
        setTimeout(function () { gcAsSendOne(m.id); }, i * (1500 + Math.random() * 2500));
      }
    } catch (e) {}
  }
  function gcScheduleAutoSend() {
    const c = gcAsCfg();
    const min = Math.max(1, c.min);
    const max = Math.max(min, c.max);
    const delay = (min + Math.random() * Math.max(1, max - min)) * 60000;
    setTimeout(function () {
      gcTryAutoSend();
      gcScheduleAutoSend();
    }, delay);
  }
  function gcBootAutoSend() {
    if (!window.__mochiDataReady) { setTimeout(gcBootAutoSend, 500); return; }
    gcScheduleAutoSend();
  }
  document.addEventListener('mochi-restore-done', gcBootAutoSend);
  setTimeout(gcBootAutoSend, 3000);
})();
