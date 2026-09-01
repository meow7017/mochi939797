// ===== 我的档案（v3.16.x：与【梦角档案】互为镜像——这里记录「我是谁，以及我希望怎样被理解」） =====
// 入口：桌面第三页「我的档案」图标（梦角档案右边）。
// 定位：我的档案=认识自己；梦角档案=认识TA；共同记录=记录我们（在梦角档案内维护，本页只做桥接入口）。
// 数据键 xy-home-v2:<cid>:myarc——按桌面联系人各存一份（我和不同 TA 的相处期望可能不同，
//   不设全局统一档）；命名空间键天然免 migrateLegacy 误迁。旧版全局键 myarc 仅作首次读取兜底，
//   另有根键 myarc-cur 记住上次查看（contacts.js EXCLUDE 的 'myarc' 前缀同时覆盖两键）。
// 结构（9 个分区，前 8 个为本页数据，第 9 个桥接梦角档案·共同记录）：
//   关于我 / 我的喜好 / 我的习惯 / 我的物品 / 我和TA（希望的相处）/ 我对自己的描述 / 我的梦境 / 我的IF世界(世界母档) / 我们的共同记录→
// 双向约定：本页与梦角档案互不自动改写对方数据；「TA的身份」等母档字段将来由梦角档案侧读取镜像。
// 样式复用 memo-arc.css 的 narc-* 类族（同视觉语言，零新增 CSS 文件）。
// 弹窗注意：离开胶囊阶段必须 ctl.pills([])（fire() pills 分支按 pillClicked 判断）；cb 内链式开新弹窗
//   必须 setTimeout 0——与 memo-arc.js 同款纪律。
(function () {
  const GNS = 'xy-home-v2';
  const KEY = 'myarc';
  const page = document.getElementById('page-my-arc');
  const root = document.getElementById('myarc-root');

  function gStore() { try { return window.xyStore(GNS); } catch (e) { return null; } }
  function toast(m) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = m; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 1800);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function short(s, n) { s = String(s == null ? '' : s); n = n || 18; return s.length > n ? s.slice(0, n) + '…' : s; }
  function strim(v) { return String(v == null ? '' : v).trim(); }
  function mdstr(ts) { const d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }

  // ---- 关于我 字段 ----
  const WHO_FIELDS = [
    ['name', '名字', '你的名字或常用昵称', 0],
    ['call', '我希望TA怎么叫我', '例如：小满、笨蛋、或者连名带姓', 0],
    ['bday', '生日', '例如：5月20日', 0],
    ['identity', '身份 / 现在的样子', '例如：学生 / 上班族', 0],
    ['nature', '性格', '例如：慢热，熟了以后话很多', 0],
    ['looks', '外貌', '发型、眼镜、常穿的衣服……', 1],
    ['intro', '自我介绍', '如果向TA正式介绍自己，你会说什么？', 1],
    ['hope', '我希望被怎样理解', '例如：嘴硬心软——别只听我说的，看我做的', 1]
  ];
  // ---- 我和TA · 我希望的相处 ----
  const RELATE_FIELDS = [
    ['accompany', '我希望TA陪我的方式', '例如：不用一直说话，在就行', 0],
    ['comfort', '我难过的时候，希望TA', '例如：别讲道理，先抱我', 0],
    ['space', '我需要独处的时候', '例如：我会说「没事」，其实想静一静', 0],
    ['quarrel', '我们闹别扭的时候', '例如：可以凶我，但要先低头', 0],
    ['taboo', '我不喜欢的相处方式', '例如：忽冷忽热、已读不回', 0],
    ['loveway', '能让我感到被爱的方式', '例如：记住我随口说过的小事', 0]
  ];
  // ---- 我对自己的描述 卡片类型（定义，不是观察——无来源/圆点） ----
  const SELF_TYPES = [
    ['swant', '我希望被理解成'], ['sreal', '别人以为，其实'], ['scare', '我在意的小事'],
    ['smood', '我的情绪规律'], ['sdream', '我的小心愿'], ['staboo', '我的雷点'],
    ['sfact', '关于我的事实'], ['sother', '其他描述']
  ];
  const SELF_MAP = {}; SELF_TYPES.forEach(t => { SELF_MAP[t[0]] = t[1]; });
  // ---- 我的IF世界（世界母档案） ----
  const IFW_FIELDS = [
    ['world', '当前世界', '例如：海边小镇', 0],
    ['setting', '世界设定', '这个世界的规则与背景……', 1],
    ['mine', '我的身份', '例如：花店老板', 0],
    ['tarole', 'TA的身份（母档）', '例如：咖啡店老板——梦角档案会镜像这一侧', 0],
    ['rel', '我们的关系', '例如：恋人 / 初识', 0]
  ];
  // ---- 列表词表（喜好/习惯/物品） ----
  const TASTE_TABS = [['like', '喜欢'], ['dislike', '不喜欢'], ['pref', '偏好']];
  const LIKE_CATS = ['食物', '饮料', '颜色', '动物', '植物', '天气', '季节', '地方', '活动', '音乐', '游戏', '其他'];
  const HABIT_TABS = [['daily', '日常生活'], ['micro', '小动作'], ['expr', '表达习惯'], ['ta', '和TA在一起时']];
  const HABIT_PH = {
    daily: '例如：几点睡、周末一般干嘛',
    micro: '例如：紧张的时候会转笔',
    expr: '例如：不开心的时候会说「随便」',
    ta: '例如：喜欢和TA分享没用的日常废话'
  };
  const THING_TABS = [['use', '常用'], ['fav', '喜欢'], ['dear', '珍视的纪念'], ['gift', '想送给TA的']];
  const THING_PH = {
    use: '例如：每天背的帆布包',
    fav: '例如：那台旧相机',
    dear: '例如：第一次收到的那封信',
    gift: '例如：一直想送TA的一条围巾'
  };

  // ---- 数据存取（按桌面联系人各存一份：xy-home-v2:<cid>:myarc） ----
  // 我和某位 TA 的相处期望可能不同，所以不设全局统一档；切换 chip 同梦角档案。
  // 旧版全局键 xy-home-v2:myarc 作为首次读取兜底（各桌面第一次打开时继承其内容作为起点）。
  function contactsList() {
    try { const cs = window.getContacts ? window.getContacts() : null; if (cs && cs.length) return cs; } catch (e) {}
    return [{ id: 'default', name: '默认' }];
  }
  function storeOf(cid) { return window.xyStore(GNS + ':' + cid); }
  function partnerNameOf(cid) {
    let n = '';
    try { n = String(storeOf(cid).get('lbl-partner') || '').trim(); } catch (e) {}
    if (!n) { const c = contactsList().find(x => x.id === cid); if (c && c.name) n = c.name; }
    return n || 'TA';
  }
  function loadRaw(cid) {
    const s = storeOf(cid); if (!s) return null;
    try { const o = JSON.parse(s.get(KEY) || 'null'); if (o && typeof o === 'object') return o; } catch (e) {}
    try { const o = JSON.parse(gStore().get(KEY) || 'null'); if (o && typeof o === 'object') return o; } catch (e) {} // 旧全局键兜底
    return null;
  }
  function save(o) { const s = storeOf(viewCid); if (s) { try { s.set(KEY, JSON.stringify(o)); } catch (e) {} } }
  function normObj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }
  function makeId() { return 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  const cache = {};
  function ensureArc() {
    let o = cache[viewCid] || loadRaw(viewCid), dirty = false;
    if (!o) { o = { created: Date.now() }; dirty = true; }
    ['tastes', 'habits', 'things', 'selfs', 'ifchanges', 'dreams'].forEach(k => { if (!Array.isArray(o[k])) { o[k] = []; dirty = true; } });
    if (!normObj(o.who)) { o.who = { f: {} }; dirty = true; } else if (!normObj(o.who.f)) { o.who.f = {}; dirty = true; }
    if (!normObj(o.relate)) { o.relate = { f: {}, notes: [] }; dirty = true; }
    else { if (!normObj(o.relate.f)) { o.relate.f = {}; dirty = true; } if (!Array.isArray(o.relate.notes)) { o.relate.notes = []; dirty = true; } }
    if (!normObj(o.ifw)) { o.ifw = {}; dirty = true; }
    IFW_FIELDS.forEach(f => { if (typeof o.ifw[f[0]] !== 'string') { o.ifw[f[0]] = ''; dirty = true; } });
    if (dirty) save(o);
    cache[viewCid] = o;
    return o;
  }

  // ---- 页面状态 ----
  let view = 'home';           // home|who|tastes|habits|things|relate|self|dream|ifw
  let viewCid = 'default';     // 当前正在看哪位桌面联系人的那份
  const tab = { tastes: 'like', habits: 'daily', things: 'use' };
  const FIELD_INDEX = {};
  WHO_FIELDS.forEach(f => { FIELD_INDEX[f[0]] = { map: 'who', label: f[1], ph: f[2], multi: f[3] }; });
  RELATE_FIELDS.forEach(f => { FIELD_INDEX[f[0]] = { map: 'relate', label: f[1], ph: f[2], multi: f[3] }; });
  IFW_FIELDS.forEach(f => { FIELD_INDEX[f[0]] = { map: 'ifw', label: f[1], ph: f[2], multi: f[3] }; });

  // ---- 打开/关闭 ----
  function restoreCur() {
    const ids = contactsList().map(c => c.id);
    let c = '';
    try { c = String(gStore().get('myarc-cur') || ''); } catch (e) {}
    if (ids.indexOf(c) >= 0) return c;
    const act = window.__activeCid || 'default';
    return ids.indexOf(act) >= 0 ? act : ids[0];
  }
  window.openMyArc = function () {
    if (!page || !root) return;
    viewCid = restoreCur();
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    page.hidden = false;
    view = 'home'; tab.tastes = 'like'; tab.habits = 'daily'; tab.things = 'use';
    render();
  };
  window.closeMyArc = function () {
    if (!page) return;
    page.classList.remove('full');
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const home = document.getElementById('page-phone');
    if (home) home.hidden = false;
  };

  // ---- 渲染主入口 ----
  function render() {
    if (!root) return;
    const arc = ensureArc();
    let h = '';
    h += chipsHTML();
    h += (view === 'home') ? overviewHTML(arc) : sectionHTML(arc);
    root.innerHTML = h;
  }
  function chipsHTML() {
    let h = '<div class="narc-chips">';
    contactsList().forEach(c => {
      h += '<button class="narc-chip' + (c.id === viewCid ? ' on' : '') + '" data-op="pick-cid" data-cid="' + esc(c.id) + '">' + esc(partnerNameOf(c.id)) + '</button>';
    });
    h += '</div>';
    return h;
  }

  function filledN(m, keys) { return keys.filter(k => String(m[k] || '').trim()).length; }

  // ---- 总览：英雄区 + 分区菜单 ----
  function overviewHTML(arc) {
    const days = Math.max(0, Math.floor((Date.now() - arc.created) / 86400000));
    const whoFilled = WHO_FIELDS.filter(f => String(arc.who.f[f[0]] || '').trim()).length;
    const relFilled = RELATE_FIELDS.filter(f => String(arc.relate.f[f[0]] || '').trim()).length + arc.relate.notes.length;
    const ifwFilled = IFW_FIELDS.filter(f => String(arc.ifw[f[0]] || '').trim()).length + arc.ifchanges.length;
    let h = '<div class="narc-hero">';
    h += '<div class="narc-hero-top"><span class="narc-name">我的档案</span><span class="narc-days">写下自己 · ' + days + ' 天</span></div>';
    h += '<div class="narc-hero-sub">写给「' + esc(partnerNameOf(viewCid)) + '」的那一份——认识自己，让TA慢慢读懂你。</div>';
    h += '<div class="narc-stats">';
    h += '<div class="narc-stat"><b>' + arc.selfs.length + '</b><span>描述</span></div>';
    h += '<div class="narc-stat"><b>' + arc.tastes.length + '</b><span>喜好</span></div>';
    h += '<div class="narc-stat"><b>' + arc.things.length + '</b><span>物品</span></div>';
    h += '<div class="narc-stat"><b>' + whoFilled + '/' + WHO_FIELDS.length + '</b><span>关于我</span></div>';
    h += '</div>';
    h += '</div>';
    h += menuHTML(arc, whoFilled, relFilled, ifwFilled);
    return h;
  }

  function menuHTML(arc, whoFilled, relFilled, ifwFilled) {
    const rows = [
      ['who', '关于我', '我是谁，以及我希望怎样被理解', whoFilled],
      ['tastes', '我的喜好', '喜欢 / 不喜欢 / 偏好', arc.tastes.length],
      ['habits', '我的习惯', '日常 · 小动作 · 表达 · 和TA在一起时', arc.habits.length],
      ['things', '我的物品', '常用 · 喜欢 · 纪念 · 想送TA的', arc.things.length],
      ['relate', '我和TA', '不是TA实际怎么做——是我希望的相处方式', relFilled],
      ['self', '我对自己的描述', '我对自己的定义，写给TA看的那种', arc.selfs.length],
      ['dream', '我的梦境', '想留下、或不敢忘记的梦', arc.dreams.length],
      ['ifw', '我的IF世界', '世界母档案：设定在这里维护，梦角档案只记TA那一侧', ifwFilled],
      ['shared', '我们的共同记录', '记录我们 → 在梦角档案里维护', -1]
    ];
    let h = '<div class="narc-menu">';
    rows.forEach(row => {
      h += row[0] === 'shared'
        ? '<button class="narc-mrow" data-op="go-shared"><span class="nm-main"><span class="nm-title">' + esc(row[1]) + '</span><span class="nm-desc">' + esc(row[2]) + '</span></span><span class="nm-arrow">→</span></button>'
        : '<button class="narc-mrow" data-op="nav" data-view="' + row[0] + '"><span class="nm-main"><span class="nm-title">' + esc(row[1]) + '</span><span class="nm-desc">' + esc(row[2]) + '</span></span>' + (row[3] > 0 ? '<span class="nm-count">' + row[3] + '</span>' : '') + '<span class="nm-arrow">›</span></button>';
    });
    h += '</div>';
    return h;
  }
  // ---- 分区详情壳（复用 narc-* 样式） ----
  function backHomeRow() {
    return '<div class="narc-backrow"><button class="narc-backhome" data-op="nav" data-view="home">‹ 返回总览</button></div>';
  }
  function sectHead(title, sub, addBtnHtml) {
    let h = '<div class="narc-sect"><div><h3>' + esc(title) + '</h3>' + (sub ? '<div class="narc-sect-sub">' + esc(sub) + '</div>' : '') + '</div>';
    if (addBtnHtml) h += addBtnHtml;
    h += '</div>';
    return h;
  }
  function fieldRowsHTML(mapObj, fields, mapName) {
    let h = '<div class="narc-fields">';
    fields.forEach(f => {
      const val = String(mapObj[f[0]] == null ? '' : mapObj[f[0]]);
      const empty = !val.trim();
      h += '<button class="narc-frow" data-op="efield" data-map="' + mapName + '" data-key="' + f[0] + '">';
      h += '<span class="nf-label">' + esc(f[1]) + '</span>';
      h += '<span class="nf-val' + (empty ? ' empty' : '') + '">' + (empty ? esc(f[2]) : esc(val)) + '</span>';
      h += '<span class="nf-edit">›</span></button>';
    });
    h += '</div>';
    return h;
  }
  function tabsHTML(tabs, curVal, viewKey) {
    let h = '<div class="narc-btabs">';
    tabs.forEach(t => { h += '<button class="narc-btab' + (curVal === t[0] ? ' on' : '') + '" data-op="stab" data-view="' + viewKey + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; });
    h += '</div>';
    return h;
  }
  function itemShell(inner, metaHtml) {
    return '<div class="narc-item">' + inner + '<div class="ni-meta">' + (metaHtml || '') + '</div></div>';
  }
  function opBtn(op, label, attrs, warn) {
    return '<button class="nk-op' + (warn ? ' warn' : '') + '" data-op="' + op + '"' + (attrs || '') + '>' + label + '</button>';
  }

  function sectionHTML(arc) {
    const SECS = {
      who: ['关于我', '对应「TA是谁」——这里写的是你自己。'], tastes: ['我的喜好', '让TA慢慢知道：你喜欢什么。'],
      habits: ['我的习惯', '相处久了，TA自然会观察到这些。'], things: ['我的物品', '和「TA的物品」互为对照——互赠的都在两边有回声。'],
      relate: ['我和TA', '不是记录TA实际怎么做，是我希望的相处方式。'], self: ['我对自己的描述', '不是别人眼里的你——是你想被理解的样子。'],
      dream: ['我的梦境', '做过的一些梦，想留下或不敢忘记的那种。'],
      ifw: ['我的IF世界', '世界母档案：设定在这里维护；梦角档案只记TA在这一侧的样子。']
    };
    const meta = SECS[view] || SECS.who;
    let h = backHomeRow();
    h += sectHead(meta[0], meta[1], null);
    if (view === 'who') h += fieldRowsHTML(arc.who.f, WHO_FIELDS, 'who');
    else if (view === 'tastes') h += tastesHTML(arc);
    else if (view === 'habits') h += habitsHTML(arc);
    else if (view === 'things') h += thingsHTML(arc);
    else if (view === 'relate') h += relateHTML(arc);
    else if (view === 'self') h += selfHTML(arc);
    else if (view === 'dream') h += dreamHTML(arc);
    else if (view === 'ifw') h += ifwHTML(arc);
    return h;
  }

  // ---- 我的喜好 ----
  function tastesHTML(arc) {
    let h = tabsHTML(TASTE_TABS, tab.tastes, 'tastes');
    const curLabel = (TASTE_TABS.find(t => t[0] === tab.tastes) || [])[1] || '';
    h += sectHead(curLabel, '', '<button class="narc-add" data-op="add-li" data-kind="taste">＋ 记一条</button>');
    const items = arc.tastes.filter(x => x.g === tab.tastes).slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      const tip = tab.tastes === 'like' ? '你喜欢什么呢？<br>TA会拿小本子记下来的那种。' : (tab.tastes === 'dislike' ? '你不喜欢什么呢？' : '例如：比起惊喜，更喜欢提前说好的安排。');
      return h + '<div class="narc-empty">' + tip + '</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top">' + (it.cat ? '<span class="ni-cat">' + esc(it.cat) + '</span>' : '') + '</div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="taste" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="taste" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 我的习惯 ----
  function habitsHTML(arc) {
    let h = tabsHTML(HABIT_TABS, tab.habits, 'habits');
    const curLabel = (HABIT_TABS.find(t => t[0] === tab.habits) || [])[1] || '';
    h += sectHead(curLabel, '', '<button class="narc-add" data-op="add-li" data-kind="habit">＋ 记一条</button>');
    const items = arc.habits.filter(x => x.g === tab.habits).slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      const tips = { daily: '几点睡？周末一般干嘛？<br>这些日常就是你的形状。', micro: '紧张时会转笔、开心时会哼歌……<br>这种小动作最像你。', expr: '不开心的时候会怎么说？<br>TA需要知道怎么读你。', ta: '和TA在一起时，你有什么习惯？' };
      return h + '<div class="narc-empty">' + (tips[tab.habits] || '') + '</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="habit" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="habit" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 我的物品 ----
  function thingsHTML(arc) {
    let h = tabsHTML(THING_TABS, tab.things, 'things');
    const curLabel = (THING_TABS.find(t => t[0] === tab.things) || [])[1] || '';
    h += sectHead(curLabel, '', '<button class="narc-add" data-op="add-li" data-kind="thing">＋ 记一件</button>');
    const items = arc.things.filter(x => x.g === tab.things).slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      return h + '<div class="narc-empty">常用的东西、珍视的纪念、<br>还有一直想送给TA的那一件。</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="thing" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="thing" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 我和TA（希望的相处） ----
  function relateHTML(arc) {
    let h = fieldRowsHTML(arc.relate.f, RELATE_FIELDS, 'relate');
    h += '<div class="narc-ghead">还想补充的<span class="narc-gsub">没说出口的期望也可以写在这里</span></div>';
    h += '<div style="margin:0 2px 10px;text-align:right"><button class="narc-add" data-op="add-li" data-kind="rnote">＋ 补一条</button></div>';
    if (!arc.relate.notes.length) h += '<div class="narc-empty">例如：希望TA在忙之前先跟我说一声。</div>';
    arc.relate.notes.slice().sort((a, b) => b.created - a.created).forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="rnote" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="rnote" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }
  // ---- 我对自己的描述（定义卡片：无来源/圆点） ----
  function selfHTML(arc) {
    let h = sectHead('我的描述卡', '每一条都是你对自己的定义——TA读到时会更懂你一点。', '<button class="narc-add" data-op="add-self">＋ 写一张描述卡</button>');
    const items = arc.selfs.slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      return h + '<div class="narc-empty">例如：【别人以为，其实】<br>「别人以为我大大咧咧，其实我什么都记得。」</div>';
    }
    items.forEach(it => {
      h += '<div class="narc-k">';
      h += '<div class="nk-top"><span class="nk-type">' + esc(SELF_MAP[it.type] || '其他描述') + '</span></div>';
      h += '<div class="nk-text">' + esc(it.text) + '</div>';
      if (it.note) h += '<div class="nk-why">' + esc(it.note) + '</div>';
      h += '<div class="nk-meta"><span class="nk-date">写于 ' + short(it.dateStr || '', 12) + '</span>';
      h += '<span class="nk-ops">' + opBtn('edit-self', '编辑', ' data-id="' + it.id + '"') + opBtn('del-self', '删除', ' data-id="' + it.id + '"', 1) + '</span></div></div>';
    });
    return h;
  }

  // ---- 我的梦境 ----
  function dreamHTML(arc) {
    let h = sectHead('我的梦境', '做过的一些梦，想留下或不敢忘记的那种。', '<button class="narc-add" data-op="add-dream">＋ 记一个梦</button>');
    const items = arc.dreams.slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      return h + '<div class="narc-empty">梦见TA了？梦见自己去远行了？<br>那些醒来还记得的梦，都可以记在这里。</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.text) + '</div>';
      h += itemShell(inner, '<span class="ni-date">' + esc(it.date) + '</span><span class="nk-ops">' + opBtn('edit-dream', '编辑', ' data-id="' + it.id + '"') + opBtn('del-dream', '删除', ' data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 我的IF世界（世界母档案） ----
  function ifwHTML(arc) {
    let h = fieldRowsHTML(arc.ifw, IFW_FIELDS, 'ifw');
    h += '<div class="narc-ghead">这个世界里的我们<span class="narc-gsub">例如：我们住在同一条街的两端</span></div>';
    h += '<div style="margin:0 2px 10px;text-align:right"><button class="narc-add" data-op="add-li" data-kind="ifch">＋ 记一条</button></div>';
    if (!arc.ifchanges.length) h += '<div class="narc-empty">换到IF世界后，「我们」有什么不一样？</div>';
    arc.ifchanges.slice().sort((a, b) => b.created - a.created).forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="ifch" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="ifch" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 弹窗流程 ----
  function fieldMapOf(mapName, arc) {
    if (mapName === 'who') return arc.who.f;
    if (mapName === 'relate') return arc.relate.f;
    return arc.ifw;
  }
  function editField(mapName, key) {
    const def = FIELD_INDEX[key]; if (!def || !window.openModal) return;
    const arc = ensureArc();
    const m = fieldMapOf(mapName, arc);
    window.openModal(def.label, m[key] || '', function (v) {
      m[key] = strim(v);
      save(arc); toast('已记下'); render();
    }, def.multi ? { textarea: true, textareaPlaceholder: def.ph } : { placeholder: def.ph, maxlength: 120 });
  }

  function listOf(kind, arc) {
    if (kind === 'taste') return arc.tastes;
    if (kind === 'habit') return arc.habits;
    if (kind === 'thing') return arc.things;
    if (kind === 'rnote') return arc.relate.notes;
    return arc.ifchanges;
  }
  function liPh(kind) {
    if (kind === 'taste') return tab.tastes === 'like' ? '例如：布丁 / 雨天' : (tab.tastes === 'dislike' ? '例如：香菜 / 被放鸽子' : '例如：比起惊喜，更喜欢提前说好的安排。');
    if (kind === 'habit') return HABIT_PH[tab.habits];
    if (kind === 'thing') return THING_PH[tab.things];
    if (kind === 'rnote') return '例如：希望TA在忙之前先跟我说一声。';
    return '例如：在这个世界我们住在同一街区。';
  }
  function liTitle(kind) {
    if (kind === 'taste') return (TASTE_TABS.find(t => t[0] === tab.tastes) || [])[1] || '';
    if (kind === 'habit') return (HABIT_TABS.find(t => t[0] === tab.habits) || [])[1] || '';
    if (kind === 'thing') return (THING_TABS.find(t => t[0] === tab.things) || [])[1] || '';
    if (kind === 'rnote') return '补充一条期望';
    return '这个世界里的我们';
  }
  function addLi(kind) {
    if (!window.openModal) return;
    const useCat = kind === 'taste' && tab.tastes === 'like';
    let cat = '', phase = useCat ? 'cat' : 'text', ctl = null;
    ctl = window.openModal(liTitle(kind), '', function (v) {
      if (phase === 'cat') {
        if (!v) return;
        cat = String(v); phase = 'text';
        ctl.stay(); ctl.pills([]); ctl.title('具体是什么呢？');
        ctl.input(true); ctl.maxLen(100); ctl.ph(liPh(kind)); ctl.okText('保存');
        return;
      }
      const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
      const arc = ensureArc();
      const item = { id: makeId(), t: t, created: Date.now() };
      if (kind === 'taste') { item.g = tab.tastes; item.cat = (tab.tastes === 'like') ? (cat || '其他') : ''; }
      else if (kind === 'habit') item.g = tab.habits;
      else if (kind === 'thing') item.g = tab.things;
      listOf(kind, arc).push(item);
      save(arc); toast('已记下'); render();
    }, useCat ? { noInput: true, pills: LIKE_CATS.map(c => ({ label: c, value: c })) } : { placeholder: liPh(kind), maxlength: 120 });
  }
  function editLi(kind, id) {
    const arc = ensureArc(); const it = listOf(kind, arc).find(x => x.id === id); if (!it || !window.openModal) return;
    const reCat = kind === 'taste' && it.g === 'like';
    let phase = reCat ? 'cat' : 'text', newCat = it.cat || '', ctl = null;
    ctl = window.openModal('编辑', it.t, function (v) {
      if (phase === 'cat') {
        if (!v) return;
        newCat = String(v); phase = 'text';
        ctl.stay(); ctl.pills([]); ctl.title('内容');
        ctl.input(true); ctl.text(it.t); ctl.maxLen(120); ctl.ph('内容'); ctl.okText('保存');
        return;
      }
      const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
      it.t = t; if (reCat) it.cat = newCat;
      save(arc); toast('已更新'); render();
    }, reCat ? { noInput: true, pill: it.cat, pills: LIKE_CATS.map(c => ({ label: c, value: c })) } : { placeholder: '内容', maxlength: 120 });
  }
  function delLi(kind, id) {
    if (!window.openModal) return;
    window.openModal('删除这条？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc();
      const arr = listOf(kind, arc);
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr.splice(i, 1);
      save(arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }

  // ---- 描述卡流程：类型→内容→备注 ----
  function addSelf() {
    if (!window.openModal) return;
    let phase = 'type', pType = '', pText = '', ctl = null;
    ctl = window.openModal('写一张描述卡', '', function (v) {
      if (phase === 'type') {
        if (!v) return;
        pType = String(v); phase = 'text';
        ctl.stay(); ctl.pills([]);
        ctl.title(SELF_MAP[pType]);
        ctl.hint('一句话就好——写给未来会读到这里的人。');
        ctl.input(true); ctl.maxLen(140); ctl.ph('例如：别人以为我大大咧咧，其实我什么都记得');
        ctl.okText('下一步');
        return;
      }
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        pText = t; phase = 'note';
        ctl.stay(); ctl.title('想补充的话（可选）'); ctl.hint('可留空。');
        ctl.text(''); ctl.maxLen(160); ctl.ph('可留空'); ctl.okText('保存');
        return;
      }
      if (phase === 'note') {
        const arc = ensureArc(); const now = Date.now();
        arc.selfs.push({ id: makeId(), type: pType, text: pText, note: strim(v), created: now, dateStr: (new Date(now).getMonth() + 1) + '.' + new Date(now).getDate() });
        save(arc); toast('写下了一张描述卡'); render();
      }
    }, { noInput: true, pills: SELF_TYPES.map(t => ({ label: t[1], value: t[0] })) });
  }
  function editSelf(id) {
    const arc = ensureArc(); const it = arc.selfs.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'text', nt = '', ctl = null;
    ctl = window.openModal('编辑这张描述卡', it.text, function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        nt = t; phase = 'note';
        ctl.stay(); ctl.title('想补充的话（可选）');
        ctl.text(it.note || ''); ctl.maxLen(160); ctl.ph('可留空'); ctl.okText('保存');
        return;
      }
      if (phase === 'note') { it.text = nt; it.note = strim(v); save(arc); toast('已更新'); render(); }
    }, { placeholder: '你对自己的定义', maxlength: 140 });
  }
  function delSelf(id) {
    if (!window.openModal) return;
    window.openModal('删除这张描述卡？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc();
      arc.selfs = arc.selfs.filter(x => x.id !== id);
      save(arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }

  // ---- 梦境流程：内容 → 日期 ----
  function addDream() {
    if (!window.openModal) return;
    let phase = 'text', text = '', ctl = null;
    ctl = window.openModal('记一个梦', '', function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        text = t; phase = 'date';
        ctl.stay(); ctl.title('梦到哪天？'); ctl.hint('留空默认今天。');
        ctl.text(mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        const arc = ensureArc();
        arc.dreams.push({ id: makeId(), text: text, date: strim(v) || mdstr(Date.now()), created: Date.now() });
        save(arc); toast('记住了一个梦'); render();
      }
    }, { placeholder: '梦见……', maxlength: 200 });
  }
  function editDream(id) {
    const arc = ensureArc(); const it = arc.dreams.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'text', newText = '', ctl = null;
    ctl = window.openModal('编辑这个梦', it.text, function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        newText = t; phase = 'date';
        ctl.stay(); ctl.title('梦到哪天？');
        ctl.text(it.date || mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        it.text = newText; it.date = strim(v) || mdstr(Date.now());
        save(arc); toast('已更新'); render();
      }
    }, { placeholder: '梦见……', maxlength: 200 });
  }
  function delDream(id) {
    if (!window.openModal) return;
    window.openModal('删掉这个梦？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc();
      arc.dreams = arc.dreams.filter(x => x.id !== id);
      save(arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }

  // ---- 事件分发 ----
  function dispatch(op, el) {
    const id = el.getAttribute('data-id');
    const kind = el.getAttribute('data-kind');
    switch (op) {
      case 'nav': view = el.getAttribute('data-view') || 'home'; render(); break;
      case 'stab': { const tv = el.getAttribute('data-view'), tb = el.getAttribute('data-tab'); if (tv && tab[tv] != null) tab[tv] = tb; render(); break; }
      case 'efield': editField(el.getAttribute('data-map'), el.getAttribute('data-key')); break;
      case 'add-li': addLi(el.getAttribute('data-kind')); break;
      case 'edit-li': editLi(el.getAttribute('data-kind'), id); break;
      case 'del-li': delLi(el.getAttribute('data-kind'), id); break;
      case 'add-self': addSelf(); break;
      case 'edit-self': editSelf(id); break;
      case 'del-self': delSelf(id); break;
      case 'add-dream': addDream(); break;
      case 'edit-dream': editDream(id); break;
      case 'del-dream': delDream(id); break;
      case 'pick-cid': {
        // 切换到另一位桌面联系人的那份档案（数据互不统一，各自独立维护）
        const cid = el.getAttribute('data-cid') || '';
        if (cid && contactsList().some(c => c.id === cid)) {
          viewCid = cid;
          try { gStore().set('myarc-cur', cid); } catch (e) {}
          tab.tastes = 'like'; tab.habits = 'daily'; tab.things = 'use';
        }
        render();
        break;
      }
      case 'go-shared':
        // 共同记录在梦角档案内维护：桥接过去（无梦角时那边会显示引导）
        if (window.openNarcShared) window.openNarcShared();
        else if (window.openNarc) window.openNarc();
        break;
    }
  }

  // ---- 绑定 ----
  function bind() {
    const back = document.getElementById('myarc-back');
    if (back) back.addEventListener('click', function () { window.closeMyArc(); });
    // 右上角不放「去TA的档案」按钮（用户要求）；去 TA 档案走总览末行「我们的共同记录」桥接
    const appIcon = document.querySelector('.app[data-app="my-arc"]');
    if (appIcon) {
      appIcon.addEventListener('click', function () {
        const editing = Array.prototype.some.call(document.querySelectorAll('.app-grid'), g => g.classList.contains('editing'));
        if (editing) return;
        window.openMyArc();
      });
    }
    if (root) {
      root.addEventListener('click', function (e) {
        const b = e.target.closest('[data-op]');
        if (!b) return;
        dispatch(b.getAttribute('data-op'), b);
      });
    }
  }

  function boot() { bind(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
