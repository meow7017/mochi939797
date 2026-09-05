/* =========================================================
   milk「抉择助手」原样移植（抛硬币 + 随机抽签）
   替换 mochi 原来的「帮我决定」。
   视觉/动画保持 milk 原版，仅结果发送接到 mochi 聊天。
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 0. 引入 Font Awesome（milk 原版图标依赖它） ---------- */
  if (!document.getElementById('milk-fa')) {
    var fa = document.createElement('link');
    fa.id = 'milk-fa';
    fa.rel = 'stylesheet';
    fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css';
    document.head.appendChild(fa);
  }

  /* ---------- 1. 主题色（想改成你 milk 里的主色，改这一组即可） ----------
     如果你想要和你 milk 网站一模一样的颜色，把下面这 7 行的
     颜色值换成你 milk 主题里 :root 的 --accent-color 等数值即可。 */
  var PALETTE = {
    accent: '#ff6b81',        // 主色
    accentRGB: '255,107,129', // 主色的 RGB（逗号分隔）
    bg1: '#ffffff',           // 弹窗卡片底色
    bg2: '#ffffff',           // 渐变第二底色
    line: '#eee8f0',          // 边框色
    ink: '#2e2a38',           // 主文字
    sub: '#948d9e',           // 次级文字
    soft: '#f6f2f8'           // 浅色按钮/输入底色
  };

  /* ---------- 2. 样式（milk 原版 CSS，仅把变量名换成上面这组） ---------- */
  var cssText = `
  #milk-decision-root {
    --milk-accent: ${PALETTE.accent};
    --milk-accent-rgb: ${PALETTE.accentRGB};
    --milk-bg1: ${PALETTE.bg1};
    --milk-bg2: ${PALETTE.bg2};
    --milk-line: ${PALETTE.line};
    --milk-ink: ${PALETTE.ink};
    --milk-sub: ${PALETTE.sub};
    --milk-soft: ${PALETTE.soft};
    --milk-font: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  }

  /* ===== 弹窗外壳（milk 风格：居中卡片 + 半透明毛玻璃底） ===== */
  #milk-decision-root .modal {
    position: fixed; inset: 0; z-index: 9999;
    display: none;
    align-items: center; justify-content: center;
    background: rgba(20,20,20,0.5);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  }
  #milk-decision-root .modal.show { display: flex; }
  #milk-decision-root .modal-content {
    width: min(92vw, 400px);
    max-height: 90vh; overflow-y: auto;
    background: var(--milk-bg2);
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.25);
    padding: 22px 20px 16px;
    font-family: var(--milk-font);
    color: var(--milk-ink);
    animation: milkIn .28s cubic-bezier(0.34,1.3,0.64,1);
  }
  @keyframes milkIn { from { opacity: 0; transform: translateY(14px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
  #milk-decision-root .modal-content::-webkit-scrollbar { display: none; }
  #milk-decision-root .modal-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 17px; font-weight: 700; color: var(--milk-ink);
    margin-bottom: 4px;
  }
  #milk-decision-root .modal-title i { color: var(--milk-accent); font-size: 16px; }
  #milk-decision-root .modal-buttons {
    display: flex; justify-content: flex-end; gap: 10px;
    margin-top: 16px; flex-wrap: wrap;
  }
  #milk-decision-root .modal-btn {
    padding: 10px 20px; border: none; border-radius: 12px;
    font-size: 13px; cursor: pointer; font-family: var(--milk-font);
    transition: all 0.2s ease; font-weight: 600;
  }
  #milk-decision-root .modal-btn:active { transform: scale(0.96); }
  #milk-decision-root .modal-btn-primary { background: var(--milk-accent); color: #fff; }
  #milk-decision-root .modal-btn-primary:hover { filter: brightness(1.08); }
  #milk-decision-root .modal-btn-secondary { background: var(--milk-soft); color: var(--milk-ink); }
  #milk-decision-root .modal-btn-secondary:hover { background: rgba(0,0,0,0.06); }
  #milk-decision-root .modal-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ===== 抉择助手菜单（两张卡片） ===== */
  #milk-decision-root .decision-menu-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 14px 0; }
  #milk-decision-root .decision-option-card {
    background: var(--milk-bg1);
    border: 1px solid var(--milk-line);
    border-radius: 16px; padding: 26px 12px; text-align: center;
    cursor: pointer; transition: all 0.25s ease;
  }
  #milk-decision-root .decision-option-card:hover {
    transform: translateY(-4px);
    border-color: var(--milk-accent);
    box-shadow: 0 6px 16px rgba(var(--milk-accent-rgb),0.2);
  }
  #milk-decision-root .decision-option-card i { font-size: 34px; margin-bottom: 10px; color: var(--milk-accent); display:block; }
  #milk-decision-root .decision-option-card h3 { font-size: 16px; margin: 0 0 4px; color: var(--milk-ink); }
  #milk-decision-root .decision-option-card p { font-size: 12px; margin: 0; color: var(--milk-sub); }

  /* ===== 随机抽签 ===== */
  #milk-decision-root .picker-box-stage {
    display: flex; flex-direction: column; align-items: center; gap: 16px;
    margin: 8px 0;
  }
  #milk-decision-root .picker-cards-row {
    display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;
    min-height: 90px; align-items: center; width: 100%;
  }
  #milk-decision-root .picker-card {
    width: 70px; height: 92px; border-radius: 12px;
    background: linear-gradient(135deg, var(--milk-bg2) 0%, var(--milk-bg1) 100%);
    border: 1.5px solid var(--milk-line);
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 600; color: var(--milk-sub);
    cursor: default; transition: all 0.35s cubic-bezier(0.34,1.56,0.64,1);
    box-shadow: 0 2px 10px rgba(0,0,0,0.08);
    text-align: center; padding: 6px; word-break: break-all; position: relative; overflow: hidden;
    animation: milkCardEnter 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
  }
  @keyframes milkCardEnter { from { opacity: 0; transform: translateY(12px) scale(0.88); } to { opacity: 1; transform: translateY(0) scale(1); } }
  #milk-decision-root .picker-card.selected {
    background: linear-gradient(135deg, var(--milk-accent) 0%, rgba(var(--milk-accent-rgb),0.75) 100%);
    color: #fff; border-color: transparent;
    transform: translateY(-6px) scale(1.08);
    box-shadow: 0 10px 28px rgba(var(--milk-accent-rgb),0.4);
    animation: milkCardWin 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
  }
  @keyframes milkCardWin {
    0% { transform: translateY(0) scale(1); }
    40% { transform: translateY(-10px) scale(1.12) rotate(-2deg); }
    70% { transform: translateY(-5px) scale(1.1) rotate(1deg); }
    100% { transform: translateY(-6px) scale(1.08) rotate(0deg); }
  }
  #milk-decision-root .picker-card.unselected { opacity: 0.4; transform: scale(0.94); }
  #milk-decision-root .picker-result-text {
    font-size: 18px; font-weight: 700; color: var(--milk-accent); text-align: center;
    min-height: 28px; padding: 8px 16px; border-radius: 10px;
    background: rgba(var(--milk-accent-rgb),0.08);
    border: 1px solid rgba(var(--milk-accent-rgb),0.2);
    opacity: 0; transition: opacity 0.4s ease; width: 100%;
  }
  #milk-decision-root .picker-result-text.show { opacity: 1; }
  #milk-decision-root .picker-controls { width: 100%; }
  #milk-decision-root .picker-options-label {
    font-size: 12px; font-weight: 600; color: var(--milk-sub);
    letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px;
  }
  #milk-decision-root .picker-options-list {
    max-height: 150px; overflow-y: auto;
    border: 1.5px solid var(--milk-line); border-radius: 12px;
    padding: 6px; margin-bottom: 10px; background: var(--milk-bg1);
  }
  #milk-decision-root .picker-options-list::-webkit-scrollbar { display: none; }
  #milk-decision-root .picker-option-item { display: flex; gap: 8px; padding: 7px 8px; align-items: center; border-radius: 8px; }
  #milk-decision-root .picker-option-item:hover { background: var(--milk-soft); }
  #milk-decision-root .picker-option-color-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  #milk-decision-root .picker-option-input {
    flex: 1; border: none; background: transparent;
    border-bottom: 1px solid var(--milk-line); padding: 3px 4px;
    font-size: 14px; outline: none; font-family: var(--milk-font); color: var(--milk-ink);
  }
  #milk-decision-root .picker-option-remove { color: var(--milk-sub); cursor: pointer; padding: 4px 6px; border-radius: 6px; font-size: 12px; }
  #milk-decision-root .picker-option-remove:hover { color: #ff4757; background: rgba(255,71,87,0.1); }
  #milk-decision-root .picker-add-btn {
    width: 100%; margin-bottom: 0;
    font-size: 13px; border-style: dashed !important;
    opacity: 0.75; background: var(--milk-soft);
  }
  #milk-decision-root .picker-add-btn:hover { opacity: 1 !important; }

  /* ===== 抛硬币全屏浮层（milk 原版：深色毛玻璃 + 3D 翻币） ===== */
  #milk-decision-root .coin-toss-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(20,20,20,0.72);
    backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px);
    z-index: 9999; display: none;
    flex-direction: column; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 0.4s ease;
    font-family: var(--milk-font);
  }
  #milk-decision-root .coin-toss-overlay.visible { display: flex; opacity: 1; }
  #milk-decision-root .coin-container { perspective: 1200px; margin-bottom: 20px; filter: drop-shadow(0 20px 30px rgba(0,0,0,0.25)); }
  #milk-decision-root .coin { width: 170px; height: 170px; position: relative; transform-style: preserve-3d; border-radius: 50%; }
  #milk-decision-root .coin.flipping-heads { animation: milkFlipHeads 3s cubic-bezier(0.2,0.8,0.2,1) forwards; }
  #milk-decision-root .coin.flipping-tails { animation: milkFlipTails 3s cubic-bezier(0.2,0.8,0.2,1) forwards; }
  #milk-decision-root .coin-face {
    position: absolute; width: 100%; height: 100%;
    -webkit-backface-visibility: hidden; backface-visibility: hidden;
    border-radius: 50%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    font-family: "Noto Serif SC", "Songti SC", serif;
    border: 8px solid rgba(255,255,255,0.18);
    box-shadow: inset 0 0 20px rgba(0,0,0,0.08);
  }
  #milk-decision-root .coin-front { background: linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%); color: #333; transform: rotateY(0deg); }
  #milk-decision-root .coin-front::after {
    content: ""; position: absolute; top: 9px; left: 9px; right: 9px; bottom: 9px;
    border: 1px dashed #bdc3c7; border-radius: 50%;
  }
  #milk-decision-root .coin-back { background: linear-gradient(135deg, #2c3e50 0%, #000000 100%); color: #fdfbfb; transform: rotateY(180deg); }
  #milk-decision-root .coin-back::after {
    content: ""; position: absolute; top: 9px; left: 9px; right: 9px; bottom: 9px;
    border: 1px dashed #7f8c8d; border-radius: 50%;
  }
  #milk-decision-root .coin-text-main { font-size: 46px; font-weight: 400; letter-spacing: 4px; margin-bottom: 4px; }
  #milk-decision-root .coin-text-sub { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.75; font-family: sans-serif; }
  #milk-decision-root .coin-result-container { min-height: 50px; display: flex; justify-content: center; }
  #milk-decision-root .coin-result-text {
    font-family: "Noto Serif SC", "Songti SC", serif;
    font-size: 15px; color: #fff; font-weight: 300; opacity: 0.8;
    letter-spacing: 3px; transition: all 0.5s cubic-bezier(0.2,0.8,0.2,1);
    margin-top: 16px; text-align: center;
  }
  #milk-decision-root .coin-toss-overlay.finished .coin-result-text {
    font-size: 28px; opacity: 1; font-weight: 500; letter-spacing: 2px;
    text-shadow: 0 0 20px rgba(255,255,255,0.5); transform: scale(1.1);
  }
  #milk-decision-root .coin-confirm-buttons {
    display: flex; gap: 14px; margin-top: 26px; justify-content: center;
    opacity: 0; transform: translateY(20px); pointer-events: none;
    transition: opacity 0.3s ease, transform 0.3s ease;
  }
  #milk-decision-root .coin-toss-overlay.finished .coin-confirm-buttons {
    opacity: 1; transform: translateY(0); pointer-events: auto; transition-delay: 0.3s;
  }
  #milk-decision-root .coin-btn-action {
    padding: 10px 24px; border-radius: 30px; border: 1px solid rgba(255,255,255,0.25);
    background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85);
    font-size: 13px; cursor: pointer; transition: all 0.2s ease;
    font-family: var(--milk-font); backdrop-filter: blur(5px);
  }
  #milk-decision-root .coin-btn-action:hover { background: rgba(255,255,255,0.2); color: #fff; transform: translateY(-2px); }
  #milk-decision-root .coin-btn-primary { background: #fff; color: #000; border-color: #fff; font-weight: 600; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
  #milk-decision-root .coin-btn-primary:hover { background: #f0f0f0; box-shadow: 0 6px 20px rgba(255,255,255,0.3); transform: translateY(-2px) scale(1.02); }
  @keyframes milkFlipHeads {
    0% { transform: rotateY(0deg) scale(1); animation-timing-function: ease-in; }
    35% { transform: rotateY(900deg) scale(1.35); animation-timing-function: ease-out; }
    75% { transform: rotateY(1800deg) scale(1.1); }
    100% { transform: rotateY(2160deg) scale(1); }
  }
  @keyframes milkFlipTails {
    0% { transform: rotateY(0deg) scale(1); animation-timing-function: ease-in; }
    35% { transform: rotateY(900deg) scale(1.35); animation-timing-function: ease-out; }
    75% { transform: rotateY(1980deg) scale(1.1); }
    100% { transform: rotateY(2340deg) scale(1); }
  }
  `;

  var style = document.createElement('style');
  style.textContent = cssText;
  document.head.appendChild(style);

  /* ---------- 3. 界面结构（milk 原版 HTML） ---------- */
  var root = document.createElement('div');
  root.id = 'milk-decision-root';
  document.body.appendChild(root);
  root.innerHTML = `
    <div class="modal" id="decision-menu-modal">
      <div class="modal-content">
        <div class="modal-title">
          <i class="fas fa-balance-scale"></i><span>抉择助手</span>
        </div>
        <div class="decision-menu-grid">
          <div class="decision-option-card" id="open-coin-toss">
            <i class="fas fa-coins"></i>
            <h3>抛硬币</h3>
            <p>是 / 否 二元选择</p>
          </div>
          <div class="decision-option-card" id="open-wheel">
            <i class="fas fa-magic"></i>
            <h3>随机抽签</h3>
            <p>自定义选项随机抽取</p>
          </div>
        </div>
        <div class="modal-buttons">
          <button class="modal-btn modal-btn-secondary" id="close-decision-menu">关闭</button>
        </div>
      </div>
    </div>

    <div class="modal" id="wheel-modal">
      <div class="modal-content">
        <div class="modal-title">
          <i class="fas fa-magic"></i><span>随机抽签</span>
        </div>
        <div class="picker-box-stage">
          <div class="picker-cards-row" id="picker-cards-row"></div>
          <div class="picker-result-text" id="wheel-result"></div>
        </div>
        <div class="picker-controls">
          <div class="picker-options-label">选项列表（至少 2 项）</div>
          <div class="picker-options-list" id="wheel-options-list"></div>
          <button class="modal-btn modal-btn-secondary picker-add-btn" id="add-wheel-option">
            <i class="fas fa-plus"></i> 添加选项
          </button>
        </div>
        <div class="modal-buttons">
          <button class="modal-btn modal-btn-secondary" id="close-wheel">关闭</button>
          <button class="modal-btn modal-btn-primary" id="spin-wheel-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 12a10 10 0 0 1 18.8-3.6M22 12a10 10 0 0 1-18.8 3.6"/></svg> 开始抽签</button>
          <button class="modal-btn modal-btn-primary" id="send-wheel-result" style="display:none;">发送结果</button>
        </div>
      </div>
    </div>

    <div class="coin-toss-overlay" id="coin-toss-overlay">
      <div class="coin-container">
        <div class="coin" id="animated-coin">
          <div class="coin-face coin-front">
            <div class="coin-text-main">是</div>
            <div class="coin-text-sub">YES</div>
          </div>
          <div class="coin-face coin-back">
            <div class="coin-text-main">否</div>
            <div class="coin-text-sub">NO</div>
          </div>
        </div>
      </div>
      <div class="coin-result-container">
        <div class="coin-result-text" id="coin-result-text"></div>
      </div>
      <div class="coin-confirm-buttons" id="coin-action-area">
        <button class="coin-btn-action" id="cancel-coin-result">取消</button>
        <button class="coin-btn-action" id="retry-coin-toss"><i class="fas fa-redo-alt"></i> 再来一次</button>
        <button class="coin-btn-action coin-btn-primary" id="send-coin-result">发送结果</button>
      </div>
    </div>
  `;

  /* ---------- 4. 逻辑（milk 原版，发送结果改为接 mochi 聊天） ---------- */
  var menu = document.getElementById('decision-menu-modal');
  var wheel = document.getElementById('wheel-modal');
  var overlay = document.getElementById('coin-toss-overlay');
  var coin = document.getElementById('animated-coin');
  var coinResultText = document.getElementById('coin-result-text');
  var coinSendBtn = document.getElementById('send-coin-result');
  var coinRetryBtn = document.getElementById('retry-coin-toss');
  var coinCancelBtn = document.getElementById('cancel-coin-result');

  var wheelOptions = ['是', '否', '再想一想', '听你的'];
  var wheelResultText = '';
  var lastCoinResult = null;

  function showModal(m) { if (m) m.classList.add('show'); }
  function hideModal(m) { if (m) m.classList.remove('show'); }
  function hideCoin() {
    if (overlay) { overlay.classList.remove('visible', 'finished'); }
    lastCoinResult = null;
  }
  function showCoin() {
    hideModal(menu); hideModal(wheel);
    if (overlay) { overlay.classList.remove('finished'); overlay.classList.add('visible'); }
    if (coin) coin.style.transform = '';
    startCoinFlipAnimation();
  }

  /* 轻提示（复用 mochi 的黑字 toast；没有就自己做一个） */
  function toast(msg) {
    var t = document.getElementById('cc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cc-toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:8%;transform:translateX(-50%);background:rgba(0,0,0,.75);color:#fff;padding:9px 18px;border-radius:18px;font-size:13px;z-index:100000;pointer-events:none;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.style.opacity = '0'; }, 2000);
  }

  /* 发送结果到 mochi 聊天（以 TA 回话样式出现） */
  function sendToChat(text) {
    try {
      if (window.chatAddIn) window.chatAddIn(text, { enter: true, silent: true });
      else toast('发送失败：聊天未就绪');
    } catch (e) { toast('发送失败，请重试'); }
  }

  /* ===== 抽签 ===== */
  function initPicker() {
    renderPickerOptions();
    renderPickerCards();
    var result = document.getElementById('wheel-result');
    var sendBtn = document.getElementById('send-wheel-result');
    var spinBtn = document.getElementById('spin-wheel-btn');
    if (result) { result.textContent = ''; result.classList.remove('show'); }
    if (sendBtn) sendBtn.style.display = 'none';
    if (spinBtn) spinBtn.disabled = false;
    wheelResultText = '';
  }

  function renderPickerOptions() {
    var list = document.getElementById('wheel-options-list');
    if (!list) return;
    list.innerHTML = '';
    var colors = ['#FFD93D','#FF6B6B','#6BCB77','#4D96FF','#E0C3FC','#FF9A8B','#A8D8EA','#C44569'];
    wheelOptions.forEach(function (opt, index) {
      var item = document.createElement('div');
      item.className = 'picker-option-item';
      var dot = document.createElement('span');
      dot.className = 'picker-option-color-dot';
      dot.style.background = colors[index % colors.length];
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'picker-option-input';
      input.value = opt;
      input.placeholder = '输入选项...';
      var remove = document.createElement('span');
      remove.className = 'picker-option-remove';
      remove.innerHTML = '<i class="fas fa-times"></i>';
      input.addEventListener('input', function (e) {
        wheelOptions[index] = e.target.value;
        renderPickerCards();
      });
      remove.addEventListener('click', function () {
        if (wheelOptions.length <= 2) { toast('至少保留两个选项'); return; }
        wheelOptions.splice(index, 1);
        renderPickerOptions();
        renderPickerCards();
      });
      item.appendChild(dot);
      item.appendChild(input);
      item.appendChild(remove);
      list.appendChild(item);
    });
  }

  function renderPickerCards(selectedIndex) {
    if (selectedIndex === undefined) selectedIndex = -1;
    var row = document.getElementById('picker-cards-row');
    if (!row) return;
    var colors = ['#FFD93D','#FF6B6B','#6BCB77','#4D96FF','#E0C3FC','#FF9A8B','#A8D8EA','#C44569'];
    row.innerHTML = '';
    wheelOptions.forEach(function (opt, i) {
      var card = document.createElement('div');
      card.className = 'picker-card';
      if (selectedIndex >= 0) {
        if (i === selectedIndex) card.classList.add('selected');
        else card.classList.add('unselected');
      }
      if (selectedIndex >= 0 && i === selectedIndex) {
        card.style.background = 'linear-gradient(135deg,' + colors[i % colors.length] + ',' + colors[(i + 2) % colors.length] + ')';
        card.style.borderColor = 'transparent';
        card.style.color = '#fff';
      } else {
        card.style.borderTop = '3px solid ' + colors[i % colors.length];
      }
      card.style.animationDelay = (i * 0.06) + 's';
      var label = opt || ('选项' + (i + 1));
      card.textContent = label.length > 6 ? label.slice(0, 5) + '…' : label;
      row.appendChild(card);
    });
  }

  function doPick() {
    if (wheelOptions.length < 2) { toast('请至少添加两个选项'); return; }
    var spinBtn = document.getElementById('spin-wheel-btn');
    var resultDisplay = document.getElementById('wheel-result');
    var sendBtn = document.getElementById('send-wheel-result');
    spinBtn.disabled = true;
    sendBtn.style.display = 'none';
    resultDisplay.classList.remove('show');
    resultDisplay.textContent = '';

    var flashCount = 0;
    var totalFlashes = 16 + Math.floor(Math.random() * 8);
    var finalIndex = Math.floor(Math.random() * wheelOptions.length);

    function flash() {
      var row = document.getElementById('picker-cards-row');
      if (!row) return;
      var cards = row.querySelectorAll('.picker-card');
      var showIdx;
      if (flashCount < totalFlashes - 3) {
        showIdx = Math.floor(Math.random() * wheelOptions.length);
      } else {
        showIdx = finalIndex;
      }
      cards.forEach(function (c, i) {
        if (i === showIdx) {
          c.style.transform = 'translateY(-4px) scale(1.06)';
          c.style.background = 'linear-gradient(135deg, var(--milk-accent), rgba(var(--milk-accent-rgb),0.7))';
          c.style.borderTopColor = 'transparent';
          c.style.color = '#fff';
        } else {
          c.style.transform = '';
          c.style.background = '';
          c.style.borderTopColor = '';
          c.style.color = '';
        }
      });
      flashCount++;
      var delay = flashCount < 8 ? 80 : flashCount < 14 ? 130 : 250;
      if (flashCount < totalFlashes) {
        setTimeout(flash, delay);
      } else {
        setTimeout(function () {
          renderPickerCards(finalIndex);
          wheelResultText = wheelOptions[finalIndex];
          resultDisplay.innerHTML = '<i class="fas fa-star" style="font-size:14px;margin-right:6px;"></i>';
          resultDisplay.appendChild(document.createTextNode(wheelResultText));
          resultDisplay.classList.add('show');
          spinBtn.disabled = false;
          sendBtn.style.display = 'inline-block';
        }, 300);
      }
    }
    flash();
  }

  /* ===== 抛硬币 ===== */
  function startCoinFlipAnimation() {
    if (!coin || !overlay) return;
    overlay.classList.remove('finished');
    if (coinResultText) coinResultText.textContent = '';
    if (coinSendBtn) coinSendBtn.style.display = 'none';
    if (coinRetryBtn) coinRetryBtn.style.display = 'none';

    var isHeads = Math.random() < 0.5;
    lastCoinResult = isHeads ? '正面 ☀️' : '反面 🌙';

    coin.classList.remove('flipping-heads', 'flipping-tails');
    void coin.offsetWidth;
    coin.classList.add(isHeads ? 'flipping-heads' : 'flipping-tails');
    setTimeout(function () {
      coin.classList.remove('flipping-heads', 'flipping-tails');
      coin.style.transform = isHeads ? 'rotateY(0deg)' : 'rotateY(180deg)';
      if (coinResultText) coinResultText.textContent = lastCoinResult;
      overlay.classList.add('finished');
      if (coinSendBtn) coinSendBtn.style.display = '';
      if (coinRetryBtn) coinRetryBtn.style.display = '';
    }, 3050);
  }

  /* ---------- 5. 按钮绑定 ---------- */
  document.getElementById('open-coin-toss').addEventListener('click', showCoin);
  document.getElementById('open-wheel').addEventListener('click', function () {
    hideModal(menu); hideCoin();
    initPicker();
    showModal(wheel);
  });
  document.getElementById('close-decision-menu').addEventListener('click', function () { hideModal(menu); });
  document.getElementById('close-wheel').addEventListener('click', function () { hideModal(wheel); });
  document.getElementById('add-wheel-option').addEventListener('click', function () {
    wheelOptions.push('选项 ' + (wheelOptions.length + 1));
    renderPickerOptions();
    renderPickerCards();
  });
  document.getElementById('spin-wheel-btn').addEventListener('click', doPick);
  document.getElementById('send-wheel-result').addEventListener('click', function () {
    if (wheelResultText) {
      sendToChat('✨ 随机抽签结果：' + wheelResultText);
      hideModal(wheel);
      wheelResultText = '';
      var sendBtn = document.getElementById('send-wheel-result');
      if (sendBtn) sendBtn.style.display = 'none';
      var spinBtn = document.getElementById('spin-wheel-btn');
      if (spinBtn) spinBtn.disabled = false;
      var resultEl = document.getElementById('wheel-result');
      if (resultEl) { resultEl.textContent = ''; resultEl.classList.remove('show'); }
    }
  });
  if (coinCancelBtn) coinCancelBtn.addEventListener('click', hideCoin);
  if (coinRetryBtn) coinRetryBtn.addEventListener('click', startCoinFlipAnimation);
  if (coinSendBtn) coinSendBtn.addEventListener('click', function () {
    if (lastCoinResult) {
      sendToChat('🎲 抛硬币结果：' + lastCoinResult);
      hideCoin();
    }
  });

  /* ---------- 6. 对外入口：让 mochi 的「帮我决定」按钮点开就是这个 ---------- */
  window.openDecision = function () {
    hideCoin();
    hideModal(wheel);
    showModal(menu);
  };
  window.openMilkDecision = window.openDecision;
})();
/* 把「＋」菜单里「帮我决定」按钮文字改为「抉择」（运行期替换，build 后依然生效） */
(function () {
  function rename() {
    try {
      var b = document.getElementById('more-decide');
      if (!b) return;
      var walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, null);
      var n;
      while (walk.nextNode()) {
        n = walk.currentNode;
        if (n.nodeValue && n.nodeValue.indexOf('帮我决定') !== -1) {
          n.nodeValue = n.nodeValue.split('帮我决定').join('抉择');
        }
      }
    } catch (e) {}
  }
  if (document.body) rename(); else document.addEventListener('DOMContentLoaded', rename);
})();