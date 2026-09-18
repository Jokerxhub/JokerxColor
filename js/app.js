/* ===== Jokerx颜色代码 应用逻辑 =====
 * 数据读写 data/colors.json（由本地服务 server.py 提供 /api/data），
 * 不再保存在浏览器本地，无痕模式 / 换系统都不会丢。
 * js/data.js 的 window.COLOR_DATA 仅作为兜底默认值。 */
(() => {
  'use strict';

  var GROUPS_KEY = 'color-codes-groups-v2';
  var LEGACY_KEY = 'color-codes-v1';
  var API_URL = 'api/data';

  function getDefaultGroups() {
    var src = (typeof window.COLOR_DATA === 'object' && window.COLOR_DATA && Array.isArray(window.COLOR_DATA.groups))
      ? window.COLOR_DATA.groups
      : [{ name: '默认组', colors: [] }];
    return src.map(function (g) {
      return {
        name: (g && typeof g.name === 'string' && g.name.trim()) ? g.name.trim() : '默认组',
        colors: (g && Array.isArray(g.colors) ? g.colors : []).map(function (c) {
          return { name: c && c.name ? String(c.name) : '颜色', hex: c && c.hex ? String(c.hex) : '#000000' };
        })
      };
    });
  }

  var tabsEl = document.getElementById('tabs');
  var groupTitle = document.getElementById('groupTitle');
  var groupCount = document.getElementById('groupCount');
  var delGroupBtn = document.getElementById('delGroupBtn');
  var themeSwitch = document.getElementById('themeSwitch');
  var sortToggle = document.getElementById('sortToggle');
  var sortLabel = document.getElementById('sortLabel');
  var renameBtn = document.getElementById('renameBtn');
  var resetDataBtn = document.getElementById('resetDataBtn');
  var exportBtn = document.getElementById('exportBtn');
  var importBtn = document.getElementById('importBtn');
  var importFile = document.getElementById('importFile');
  var grid = document.getElementById('grid');
  var form = document.getElementById('addForm');
  var nameInput = document.getElementById('nameInput');
  var hexInput = document.getElementById('hexInput');
  var picker = document.getElementById('colorPicker');
  var toastEl = document.getElementById('toast');
  var serverBanner = document.getElementById('serverBanner');
  var bannerClose = document.getElementById('bannerClose');
  var toastTimer = null;
  var delTimer = null;
  var resetTimer = null;
  var importTimer = null;
  var saveTimer = null;
  var pendingImport = null;

  var ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var ICON_DEL = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_PLUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_TRASH = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

  var groups = [];
  var active = 0;
  var serverOk = false;
  var sortMode = false;
  var dragIndex = null;
  var groupDragIndex = null;

  function normalizeHex(value) {
    var h = String(value).trim().replace(/^#?/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) {
      h = h.split('').map(function (c) { return c + c; }).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return '#' + h.toUpperCase();
  }

  function normalizeColors(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(function (c) { return c && typeof c.name === 'string'; })
      .map(function (c) { return { name: c.name, hex: normalizeHex(c.hex) }; })
      .filter(function (c) { return c.hex; });
  }

  function normalizeGroups(arr) {
    return arr
      .filter(function (g) { return g && typeof g.name === 'string' && g.name.trim(); })
      .map(function (g) { return { name: g.name.trim(), colors: normalizeColors(g.colors) }; });
  }

  /* ===== 数据读写：data/colors.json（通过本地服务） ===== */

  function showServerBanner() {
    if (serverBanner) serverBanner.hidden = false;
  }
  function hideServerBanner() {
    if (serverBanner) serverBanner.hidden = true;
  }

  function loadFromServer() {
    // file:// 直接打开时浏览器禁止 fetch，提前降级并提示，避免产生网络错误
    if (location.protocol === 'file:') {
      serverOk = false;
      groups = getDefaultGroups();
      active = 0;
      showServerBanner();
      return Promise.resolve();
    }
    var timeout = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, 5000);
    });
    return Promise.race([
      fetch(API_URL, { cache: 'no-store' }),
      timeout
    ]).then(function (r) {
        if (!r.ok) throw new Error('status ' + r.status);
        return r.json();
      })
      .then(function (parsed) {
        var gs = normalizeGroups(parsed && parsed.groups);
        if (!gs.length) throw new Error('no groups');
        groups = gs;
        active = Number.isInteger(parsed.active) && parsed.active >= 0 && parsed.active < gs.length ? parsed.active : 0;
        serverOk = true;
        hideServerBanner();
      })
      .catch(function () {
        serverOk = false;
        groups = getDefaultGroups();
        active = 0;
        showServerBanner();
      });
  }

  function postData() {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 2, groups: groups, active: active })
    }).then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      return r;
    });
  }

  function onSaveFailed() {
    serverOk = false;
    showServerBanner();
    toast('保存失败：无法写入 data/colors.json，请确认服务仍在运行');
  }

  /* 防抖保存：连续操作（拖拽、切换等）合并为一次写入 */
  function save() {
    if (!serverOk) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      postData().catch(onSaveFailed);
    }, 300);
  }

  /* 立即保存（恢复默认 / 导入时使用） */
  function saveNow() {
    if (!serverOk) return Promise.reject(new Error('server down'));
    clearTimeout(saveTimer);
    return postData().catch(function (e) { onSaveFailed(); throw e; });
  }

  /* ===== 旧浏览器数据自动迁移 =====
   * 仅当 data/colors.json 仍是默认内容、且浏览器里存有旧数据时，
   * 自动写入文件并清空浏览器存储，避免老用户数据丢失。 */
  function migrateLegacyIfNeeded() {
    if (!serverOk) return;
    var fileIsDefault = JSON.stringify({ g: groups, a: active }) === JSON.stringify({ g: getDefaultGroups(), a: 0 });
    if (!fileIsDefault) return;
    var raw = null;
    try { raw = localStorage.getItem(GROUPS_KEY) || localStorage.getItem(LEGACY_KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      var gs = null;
      var idx = 0;
      if (Array.isArray(parsed)) {
        var cols = normalizeColors(parsed);
        if (cols.length) gs = [{ name: '默认组', colors: cols }];
      } else if (parsed && Array.isArray(parsed.groups)) {
        gs = normalizeGroups(parsed.groups);
        idx = Number.isInteger(parsed.active) && parsed.active >= 0 && parsed.active < gs.length ? parsed.active : 0;
      }
      if (!gs || !gs.length) return;
      groups = gs;
      active = idx;
      try { localStorage.removeItem(GROUPS_KEY); localStorage.removeItem(LEGACY_KEY); } catch (e) { /* 忽略 */ }
      saveNow().then(function () {
        toast('已把浏览器旧数据迁移到 data/colors.json');
      }, function () { /* 失败已在 onSaveFailed 提示 */ });
    } catch (e) { /* 忽略 */ }
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function luminance(hex) {
    var rgb = hexToRgb(hex);
    function f(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ===== 主题模式（白天 / 黑夜 / 适应系统） =====
   * 主题属于界面偏好，仍保存在浏览器本地；分组与颜色数据保存在文件里。 */

  var THEME_KEY = 'color-codes-theme';
  var themeChoice = 'auto';
  try { themeChoice = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { /* 忽略 */ }
  if (themeChoice !== 'light' && themeChoice !== 'dark') themeChoice = 'auto';

  var darkMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyTheme() {
    var dark = themeChoice === 'dark' || (themeChoice === 'auto' && darkMedia && darkMedia.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var btns = themeSwitch.querySelectorAll('[data-theme-choice]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-theme-choice') === themeChoice);
    }
  }

  function onMediaChange() {
    if (themeChoice === 'auto') applyTheme();
  }

  themeSwitch.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-theme-choice]');
    if (!btn) return;
    themeChoice = btn.getAttribute('data-theme-choice');
    try { localStorage.setItem(THEME_KEY, themeChoice); } catch (err) { /* 忽略 */ }
    applyTheme();
  });
  if (darkMedia) {
    if (darkMedia.addEventListener) darkMedia.addEventListener('change', onMediaChange);
    else if (darkMedia.addListener) darkMedia.addListener(onMediaChange);
  }
  applyTheme();

  /* ===== 渲染 ===== */

  function render() {
    renderTabs();
    renderHead();
    renderGrid();
    save();
  }

  function renderTabs() {
    tabsEl.innerHTML = groups.map(function (g, i) {
      return (
        '<button type="button" class="tab' + (i === active ? ' active' : '') + '" data-tab="' + i + '" draggable="' + (sortMode ? 'true' : 'false') + '" aria-label="切换到分组 ' + esc(g.name) + '">' +
          esc(g.name) +
          '<span class="tab-count">' + g.colors.length + '</span>' +
        '</button>'
      );
    }).join('') +
      '<button type="button" class="add-tab" id="addTabBtn" aria-label="新建分组">' + ICON_PLUS + '</button>';
    var t = tabsEl.querySelector('.tab.active');
    if (t && t.scrollIntoView) {
      try { t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* 忽略 */ }
    }
  }

  function renderHead() {
    var g = groups[active];
    groupTitle.textContent = g.name;
    groupCount.textContent = g.colors.length + ' 个颜色';
    delGroupBtn.innerHTML = ICON_TRASH + '删除组';
    delGroupBtn.classList.remove('confirming');
  }

  function renderGrid() {
    var colors = groups[active].colors;
    if (!colors.length) {
      grid.innerHTML = '<div class="empty">该分组还没有颜色，先添加一个吧</div>';
      return;
    }
    grid.innerHTML = colors.map(function (c, i) {
      var rgb = hexToRgb(c.hex);
      var textColor = luminance(c.hex) > 0.5 ? '#1F2328' : '#FFFFFF';
      var rgbStr = rgb.r + ', ' + rgb.g + ', ' + rgb.b;
      return (
        '<article class="card" draggable="' + (sortMode ? 'true' : 'false') + '" data-idx="' + i + '">' +
          '<div class="swatch" style="background:' + c.hex + '">' +
            '<h2 style="color:' + textColor + '">' + esc(c.name) + '</h2>' +
            '<button type="button" class="del-btn" data-del="' + i + '" aria-label="删除颜色 ' + esc(c.name) + '">' + ICON_DEL + '</button>' +
          '</div>' +
          '<div class="card-body">' +
            '<div class="code-row">' +
              '<span class="code-label">HEX</span>' +
              '<code>' + c.hex + '</code>' +
              '<button type="button" class="copy-btn" data-copy="' + c.hex + '" data-label="HEX" aria-label="复制 HEX ' + c.hex + '">' + ICON_COPY + '</button>' +
            '</div>' +
            '<div class="code-row">' +
              '<span class="code-label">RGB</span>' +
              '<code>' + rgbStr + '</code>' +
              '<button type="button" class="copy-btn" data-copy="' + rgbStr + '" data-label="RGB" aria-label="复制 ' + rgbStr + '">' + ICON_COPY + '</button>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  }

  /* ===== 提示与复制 ===== */

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyToClipboard(btn) {
    var text = btn.dataset.copy;
    var label = btn.dataset.label;
    var copied = function () {
      toast(label + ' ' + text + ' 已复制');
      var prev = btn.innerHTML;
      btn.classList.add('copied');
      btn.innerHTML = ICON_CHECK;
      setTimeout(function () {
        btn.classList.remove('copied');
        btn.innerHTML = prev;
      }, 1200);
    };
    var failed = function () { toast('复制失败，请手动选择复制'); };
    try {
      navigator.clipboard.writeText(text).then(copied).catch(function () {
        if (fallbackCopy(text)) copied(); else failed();
      });
    } catch (e) {
      if (fallbackCopy(text)) copied(); else failed();
    }
  }

  /* ===== 新建分组（行内输入） ===== */

  function startAddGroup() {
    if (tabsEl.querySelector('.tab-input')) return;
    var addBtn = document.getElementById('addTabBtn');
    var input = document.createElement('input');
    input.className = 'tab-input';
    input.placeholder = '分组名称';
    input.maxLength = 20;
    addBtn.replaceWith(input);
    input.focus();

    function done(commit) {
      var name = input.value.trim();
      if (commit && name) {
        groups.push({ name: name, colors: [] });
        active = groups.length - 1;
        render();
        toast('已创建分组「' + name + '」');
      } else if (input.parentNode) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'add-tab';
        btn.id = 'addTabBtn';
        btn.setAttribute('aria-label', '新建分组');
        btn.innerHTML = ICON_PLUS;
        input.replaceWith(btn);
      }
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { done(false); }
    });
    input.addEventListener('blur', function () { done(false); });
  }

  /* ===== 事件绑定 ===== */

  tabsEl.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab) {
      var i = Number(tab.dataset.tab);
      if (Number.isInteger(i) && i >= 0 && i < groups.length) {
        active = i;
        render();
      }
      return;
    }
    if (e.target.closest('#addTabBtn')) startAddGroup();
  });

  delGroupBtn.addEventListener('click', function () {
    if (groups.length <= 1) {
      toast('至少保留一个分组');
      return;
    }
    if (delGroupBtn.classList.contains('confirming')) {
      var removed = groups.splice(active, 1)[0];
      if (active >= groups.length) active = groups.length - 1;
      render();
      toast('已删除分组「' + removed.name + '」');
      return;
    }
    delGroupBtn.classList.add('confirming');
    delGroupBtn.innerHTML = '确认删除？';
    clearTimeout(delTimer);
    delTimer = setTimeout(function () {
      delGroupBtn.classList.remove('confirming');
      delGroupBtn.innerHTML = ICON_TRASH + '删除组';
    }, 3000);
  });

  grid.addEventListener('click', function (e) {
    var del = e.target.closest('[data-del]');
    if (del) {
      var colors = groups[active].colors;
      var i = Number(del.dataset.del);
      if (Number.isInteger(i) && i >= 0 && i < colors.length) {
        var removed = colors.splice(i, 1)[0];
        render();
        toast('已删除「' + removed.name + '」');
      }
      return;
    }
    var btn = e.target.closest('[data-copy]');
    if (btn) copyToClipboard(btn);
  });

  bannerClose.addEventListener('click', function () {
    serverBanner.hidden = true;
  });

  /* ===== 恢复默认数据（写入 data/colors.json） ===== */

  resetDataBtn.addEventListener('click', function () {
    if (resetDataBtn.classList.contains('confirming')) {
      groups = getDefaultGroups();
      active = 0;
      resetDataBtn.classList.remove('confirming');
      resetDataBtn.textContent = '恢复默认数据';
      saveNow().then(function () {
        render();
        toast('已恢复默认数据并保存到 data/colors.json');
      }, function () {
        render();
      });
      return;
    }
    resetDataBtn.classList.add('confirming');
    resetDataBtn.textContent = '确认恢复默认？';
    clearTimeout(resetTimer);
    resetTimer = setTimeout(function () {
      resetDataBtn.classList.remove('confirming');
      resetDataBtn.textContent = '恢复默认数据';
    }, 3000);
  });

  /* ===== 导入 / 导出数据（JSON 文件） ===== */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function exportData() {
    var d = new Date();
    var stamp = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    var payload = {
      app: 'jokerx-color-codes',
      version: 2,
      exportedAt: d.toISOString(),
      groups: groups,
      active: active
    };
    var blob;
    try {
      blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    } catch (e) {
      toast('导出失败，浏览器不支持');
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'jokerx-colors-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('已导出 ' + groups.length + ' 个分组');
  }

  function resetImportBtn() {
    importBtn.classList.remove('confirming');
    importBtn.textContent = '导入数据';
  }

  function applyImport() {
    if (!pendingImport) return;
    groups = pendingImport.groups;
    active = pendingImport.active;
    pendingImport = null;
    resetImportBtn();
    saveNow().then(function () {
      render();
      toast('导入成功，共 ' + groups.length + ' 个分组');
    }, function () {
      render();
    });
  }

  exportBtn.addEventListener('click', exportData);

  importBtn.addEventListener('click', function () {
    if (pendingImport) {
      applyImport();
      return;
    }
    importFile.click();
  });

  importFile.addEventListener('change', function () {
    var file = importFile.files && importFile.files[0];
    importFile.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        toast('导入失败：文件不是有效的 JSON');
        return;
      }
      var gs = normalizeGroups(parsed && parsed.groups);
      if (!gs.length) {
        toast('导入失败：文件中没有可用的分组数据');
        return;
      }
      var idx = Number.isInteger(parsed.active) && parsed.active >= 0 && parsed.active < gs.length ? parsed.active : 0;
      pendingImport = { groups: gs, active: idx };
      var hasData = groups.some(function (g) { return g.colors.length > 0; });
      if (hasData) {
        importBtn.classList.add('confirming');
        importBtn.textContent = '确认导入？';
        clearTimeout(importTimer);
        importTimer = setTimeout(resetImportBtn, 3000);
        toast('文件有效，点击「确认导入」将覆盖当前数据');
      } else {
        applyImport();
      }
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  });

  /* ===== 分组重命名（行内编辑） ===== */

  function startRenameGroup() {
    if (groupTitle.querySelector('.rename-input')) return;
    var current = groups[active].name;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = current;
    input.maxLength = 20;
    groupTitle.textContent = '';
    groupTitle.appendChild(input);
    input.focus();
    input.select();

    var finished = false;
    function done(commit) {
      if (finished) return;
      finished = true;
      var val = input.value.trim();
      if (commit && val) {
        groups[active].name = val;
        render();
        toast('已重命名为「' + val + '」');
      } else {
        render();
      }
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { done(false); }
    });
    input.addEventListener('blur', function () {
      done(input.value.trim() ? true : false);
    });
  }

  /* ===== 排序开关与拖拽排序 ===== */

  renameBtn.addEventListener('click', startRenameGroup);

  sortToggle.addEventListener('click', function () {
    sortMode = !sortMode;
    grid.classList.toggle('sorting', sortMode);
    tabsEl.classList.toggle('sorting', sortMode);
    sortToggle.classList.toggle('active', sortMode);
    sortToggle.setAttribute('aria-pressed', sortMode ? 'true' : 'false');
    sortLabel.textContent = sortMode ? '固定' : '排序';
    toast(sortMode ? '已开启排序，拖动分组或卡片调整顺序' : '已固定排序');
  });

  grid.addEventListener('dragstart', function (e) {
    if (!sortMode) { e.preventDefault(); return; }
    var card = e.target.closest('.card');
    if (!card) { e.preventDefault(); return; }
    dragIndex = Array.prototype.indexOf.call(grid.children, card);
    card.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(dragIndex)); } catch (err) { /* 忽略 */ }
    }
  });

  grid.addEventListener('dragover', function (e) {
    if (!sortMode || dragIndex === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    var target = e.target.closest('.card');
    if (!target) return;
    var targetIndex = Array.prototype.indexOf.call(grid.children, target);
    if (targetIndex === dragIndex) return;
    var rect = target.getBoundingClientRect();
    var after = (e.clientX - rect.left) > rect.width / 2;
    var draggingEl = grid.children[dragIndex];
    if (after) {
      if (grid.children[targetIndex + 1] === draggingEl) return;
      grid.insertBefore(draggingEl, grid.children[targetIndex + 1]);
    } else {
      if (grid.children[targetIndex - 1] === draggingEl) return;
      grid.insertBefore(draggingEl, target);
    }
    dragIndex = Array.prototype.indexOf.call(grid.children, draggingEl);
  });

  grid.addEventListener('dragend', function () {
    if (dragIndex === null) return;
    dragIndex = null;
    var cards = grid.querySelectorAll('.card');
    var order = [];
    for (var i = 0; i < cards.length; i++) order.push(Number(cards[i].getAttribute('data-idx')));
    var colors = groups[active].colors;
    if (order.length === colors.length) {
      groups[active].colors = order.map(function (idx) { return colors[idx]; });
      save();
    }
    render();
  });

  /* ===== 分组标签拖拽排序 ===== */

  function getTabIndex(tab) {
    return Array.prototype.indexOf.call(tabsEl.querySelectorAll('.tab'), tab);
  }

  tabsEl.addEventListener('dragstart', function (e) {
    if (!sortMode) { e.preventDefault(); return; }
    var tab = e.target.closest('.tab');
    if (!tab) { e.preventDefault(); return; }
    groupDragIndex = getTabIndex(tab);
    tab.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(groupDragIndex)); } catch (err) { /* 忽略 */ }
    }
  });

  tabsEl.addEventListener('dragover', function (e) {
    if (!sortMode || groupDragIndex === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    var target = e.target.closest('.tab');
    if (!target) return;
    var targetIndex = getTabIndex(target);
    if (targetIndex === groupDragIndex) return;
    var tabs = tabsEl.querySelectorAll('.tab');
    var rect = target.getBoundingClientRect();
    var after = (e.clientX - rect.left) > rect.width / 2;
    var draggingEl = tabs[groupDragIndex];
    if (after) {
      if (target.nextElementSibling === draggingEl) return;
      tabsEl.insertBefore(draggingEl, target.nextElementSibling);
    } else {
      if (target.previousElementSibling === draggingEl) return;
      tabsEl.insertBefore(draggingEl, target);
    }
    groupDragIndex = getTabIndex(draggingEl);
  });

  tabsEl.addEventListener('dragend', function () {
    if (groupDragIndex === null) return;
    groupDragIndex = null;
    var tabs = tabsEl.querySelectorAll('.tab');
    var order = [];
    for (var i = 0; i < tabs.length; i++) order.push(Number(tabs[i].getAttribute('data-tab')));
    if (order.length === groups.length) {
      var activeGroup = groups[active];
      groups = order.map(function (idx) { return groups[idx]; });
      active = groups.indexOf(activeGroup);
      if (active < 0) active = 0;
      save();
    }
    render();
  });

  hexInput.addEventListener('input', function () {
    var h = normalizeHex(hexInput.value);
    if (h) picker.value = h;
  });

  picker.addEventListener('input', function () {
    hexInput.value = picker.value;
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var hex = normalizeHex(hexInput.value);
    if (!hex) {
      toast('请输入有效的十六进制颜色，如 #00A9E0');
      return;
    }
    var colors = groups[active].colors;
    var name = nameInput.value.trim();
    if (!name) {
      var n = colors.length + 1;
      while (colors.some(function (c) { return c.name === '颜色 ' + n; })) n++;
      name = '颜色 ' + n;
    }
    if (colors.some(function (c) { return c.name === name; })) {
      toast('该分组已有「' + name + '」，名称不能重复');
      return;
    }
    colors.push({ name: name, hex: hex });
    render();
    nameInput.value = '';
    nameInput.focus();
    toast('已添加「' + name + '」到「' + groups[active].name + '」');
  });

  /* ===== 初始化：从数据文件加载后渲染 ===== */

  function init() {
    loadFromServer().then(function () {
      migrateLegacyIfNeeded();
      render();
    });
  }

  init();
})();
