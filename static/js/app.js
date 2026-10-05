/* ============================================================
   JokerxColor - 主页面交互
   ============================================================ */

let groups = [];
let currentTheme = localStorage.getItem('jokerxcolor_theme') || 'system';
let cardWidth = 200;
let cardHeight = 160;
let currentAddGroupId = null;

// ============================================================
// 初始化
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(currentTheme);
  await loadSettings();
  await checkAuth();
  await loadGroups();
  bindEvents();
});

async function checkAuth() {
  try {
    const resp = await fetch('/api/auth/me');
    const data = await resp.json();
    if (data.authenticated) {
      document.getElementById('logoutBtn').style.display = 'flex';
    }
    if (data.auth_required && !data.authenticated) {
      window.location.href = '/login';
    }
  } catch (e) {}
}

async function loadSettings() {
  try {
    const resp = await fetch('/api/settings');
    const data = await resp.json();
    cardWidth = parseInt(data.card_width) || 200;
    cardHeight = parseInt(data.card_height) || 160;
    if (data.theme) {
      currentTheme = data.theme;
      applyTheme(currentTheme);
    }
  } catch (e) {}
}

// ============================================================
// 主题
// ============================================================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('jokerxcolor_theme', theme);
}

const themeOrder = ['light', 'dark', 'system'];
document.getElementById('themeToggle').addEventListener('click', () => {
  const idx = themeOrder.indexOf(currentTheme);
  currentTheme = themeOrder[(idx + 1) % themeOrder.length];
  applyTheme(currentTheme);
});

// ============================================================
// 工具函数
// ============================================================
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16)
  ];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0').toUpperCase()).join('');
}

function complementary(hex) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(255 - r, 255 - g, 255 - b);
}

function triadic(hex) {
  const [r, g, b] = hexToRgb(hex);
  return [rgbToHex(b, r, g), rgbToHex(g, b, r)];
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast(`已复制 ${text}`));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(`已复制 ${text}`);
  }
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// 点击遮罩关闭
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});

// ============================================================
// 确认对话框
// ============================================================
let confirmCallback = null;
function showConfirm(title, message, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = callback;
  openModal('confirmModal');
}

document.getElementById('confirmOkBtn').addEventListener('click', () => {
  closeModal('confirmModal');
  if (confirmCallback) confirmCallback();
});

// ============================================================
// 加载分组
// ============================================================
async function loadGroups() {
  try {
    const resp = await fetch('/api/groups');
    groups = await resp.json();
    renderGroups();
  } catch (e) {
    showToast('加载失败', 'error');
  }
}

function renderGroups() {
  const container = document.getElementById('groupsContainer');
  container.innerHTML = '';

  groups.forEach(group => {
    const section = document.createElement('div');
    section.className = 'group-section';
    section.dataset.groupId = group.id;
    section.draggable = false;

    section.innerHTML = `
      <div class="group-header">
        <div class="group-title-wrapper">
          <span class="group-drag-handle" title="拖动排序">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
          </span>
          <input type="text" class="group-title" value="${escapeHtml(group.name)}" data-group-id="${group.id}">
        </div>
        <div class="group-actions">
          <button class="btn btn-sm btn-ghost add-color-btn" data-group-id="${group.id}" title="添加颜色">+ 颜色</button>
          <button class="btn btn-sm btn-ghost btn-icon delete-group-btn" data-group-id="${group.id}" title="删除分组">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="colors-grid" data-group-id="${group.id}"></div>
    `;

    container.appendChild(section);

    // 渲染颜色卡片
    const grid = section.querySelector('.colors-grid');
    group.colors.forEach(color => {
      grid.appendChild(createColorCard(color, group.id));
    });

    // 添加颜色卡片按钮
    const addCard = document.createElement('div');
    addCard.className = 'add-color-card';
    addCard.style.width = cardWidth + 'px';
    addCard.style.minHeight = (cardHeight + 80) + 'px';
    addCard.innerHTML = `<div class="plus-icon">+</div><div class="add-label">添加颜色</div>`;
    addCard.addEventListener('click', () => openAddColorModal(group.id));
    grid.appendChild(addCard);

    // 绑定分组拖拽
    bindGroupDrag(section);
    // 绑定颜色网格拖拽
    bindColorsGridDrag(grid);
  });

  // 添加分组按钮
  const addGroup = document.createElement('div');
  addGroup.className = 'add-group-section';
  addGroup.innerHTML = `<div style="font-size:24px;margin-bottom:4px;">+</div><div>添加新分组</div>`;
  addGroup.addEventListener('click', addNewGroup);
  container.appendChild(addGroup);

  // 绑定事件
  bindGroupEvents();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// 颜色卡片
// ============================================================
function createColorCard(color, groupId) {
  const [r, g, b] = hexToRgb(color.hex);
  const card = document.createElement('div');
  card.className = 'color-card';
  card.dataset.colorId = color.id;
  card.dataset.groupId = groupId;
  card.draggable = true;
  card.style.width = cardWidth + 'px';

  card.innerHTML = `
    <div class="color-card-actions">
      <button class="card-action-btn delete" title="删除颜色" data-color-id="${color.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
    <div class="color-swatch" style="height:${cardHeight}px;background:${color.hex};" data-color-id="${color.id}"></div>
    <div class="color-info">
      <input type="text" class="color-name" value="${escapeHtml(color.name || '')}" placeholder="颜色名称" data-color-id="${color.id}">
      <div class="color-codes">
        <div class="code-row">
          <span class="code-label">HEX</span>
          <span class="code-value" data-copy="${color.hex}">${color.hex}</span>
          <button class="copy-btn" data-copy="${color.hex}" title="复制">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
        <div class="code-row">
          <span class="code-label">RGB</span>
          <span class="code-value" data-copy="${r},${g},${b}">${r},${g},${b}</span>
          <button class="copy-btn" data-copy="${r},${g},${b}" title="复制">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="schemes-panel" data-color-id="${color.id}">
      <div class="schemes-title">互补色</div>
      <div class="scheme-row" id="complementary-${color.id}"></div>
      <div class="schemes-title" style="margin-top:10px;">三角配色</div>
      <div class="scheme-row" id="triadic-${color.id}"></div>
    </div>
  `;

  // 复制事件
  card.querySelectorAll('[data-copy]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(el.dataset.copy);
    });
  });

  // 色块点击 - 切换配色方案
  const swatch = card.querySelector('.color-swatch');
  swatch.addEventListener('click', () => toggleSchemes(color.id, color.hex));

  // 颜色名称修改
  const nameInput = card.querySelector('.color-name');
  nameInput.addEventListener('blur', () => {
    if (nameInput.value !== (color.name || '')) {
      updateColor(color.id, { name: nameInput.value });
    }
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });

  // 删除颜色
  card.querySelector('.delete').addEventListener('click', (e) => {
    e.stopPropagation();
    showConfirm('删除颜色', `确定要删除颜色 ${color.hex} 吗？此操作不可撤销。`, () => deleteColor(color.id));
  });

  return card;
}

// ============================================================
// 配色方案
// ============================================================
function toggleSchemes(colorId, hex) {
  const panel = document.querySelector(`.schemes-panel[data-color-id="${colorId}"]`);
  if (panel.classList.contains('active')) {
    panel.classList.remove('active');
    return;
  }
  // 关闭其他
  document.querySelectorAll('.schemes-panel.active').forEach(p => p.classList.remove('active'));

  const comp = complementary(hex);
  const tri = triadic(hex);

  const compContainer = document.getElementById(`complementary-${colorId}`);
  compContainer.innerHTML = `
    <div class="scheme-swatch" style="background:${comp};" data-copy="${comp}" title="点击复制"></div>
    <span class="scheme-hex" data-copy="${comp}">${comp}</span>
  `;
  compContainer.querySelectorAll('[data-copy]').forEach(el => {
    el.addEventListener('click', () => copyToClipboard(el.dataset.copy));
  });

  const triContainer = document.getElementById(`triadic-${colorId}`);
  triContainer.innerHTML = tri.map(c => `
    <div class="scheme-swatch" style="background:${c};" data-copy="${c}" title="点击复制"></div>
    <span class="scheme-hex" data-copy="${c}">${c}</span>
  `).join('');
  triContainer.querySelectorAll('[data-copy]').forEach(el => {
    el.addEventListener('click', () => copyToClipboard(el.dataset.copy));
  });

  panel.classList.add('active');
}

// ============================================================
// 分组事件
// ============================================================
function bindGroupEvents() {
  // 分组重命名
  document.querySelectorAll('.group-title').forEach(input => {
    input.addEventListener('blur', async () => {
      const groupId = parseInt(input.dataset.groupId);
      const newName = input.value.trim();
      if (!newName) {
        showToast('分组名称不能为空', 'error');
        input.value = groups.find(g => g.id === groupId)?.name || '';
        return;
      }
      try {
        await fetch(`/api/groups/${groupId}`, {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({name: newName})
        });
        showToast('分组已重命名');
      } catch (e) {
        showToast('重命名失败', 'error');
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  });

  // 删除分组
  document.querySelectorAll('.delete-group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = parseInt(btn.dataset.groupId);
      const group = groups.find(g => g.id === groupId);
      showConfirm('删除分组', `确定要删除分组"${group?.name}"吗？组内所有颜色将被删除，此操作不可撤销。`, () => deleteGroup(groupId));
    });
  });

  // 添加颜色按钮
  document.querySelectorAll('.add-color-btn').forEach(btn => {
    btn.addEventListener('click', () => openAddColorModal(parseInt(btn.dataset.groupId)));
  });
}

// ============================================================
// 添加颜色
// ============================================================
function openAddColorModal(groupId) {
  currentAddGroupId = groupId;
  document.getElementById('newColorName').value = '';
  document.getElementById('newColorPicker').value = '#00A9E0';
  document.getElementById('newColorHex').value = '#00A9E0';
  openModal('addColorModal');
}

document.getElementById('newColorPicker').addEventListener('input', (e) => {
  document.getElementById('newColorHex').value = e.target.value.toUpperCase();
});
document.getElementById('newColorHex').addEventListener('input', (e) => {
  let val = e.target.value;
  if (!val.startsWith('#')) val = '#' + val;
  if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
    document.getElementById('newColorPicker').value = val;
  }
});

document.getElementById('confirmAddColor').addEventListener('click', async () => {
  const name = document.getElementById('newColorName').value.trim();
  let hex = document.getElementById('newColorHex').value.trim().toUpperCase();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (!/^#[0-9A-F]{6}$/.test(hex) && !/^#[0-9A-F]{3}$/.test(hex)) {
    showToast('颜色格式不正确', 'error');
    return;
  }
  try {
    const resp = await fetch(`/api/groups/${currentAddGroupId}/colors`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({hex, name})
    });
    if (resp.ok) {
      closeModal('addColorModal');
      showToast('颜色已添加');
      loadGroups();
    } else {
      const data = await resp.json();
      showToast(data.error || '添加失败', 'error');
    }
  } catch (e) {
    showToast('添加失败', 'error');
  }
});

// ============================================================
// 添加分组
// ============================================================
async function addNewGroup() {
  const name = prompt('请输入分组名称：', '新分组');
  if (!name || !name.trim()) return;
  try {
    const resp = await fetch('/api/groups', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: name.trim()})
    });
    if (resp.ok) {
      showToast('分组已创建');
      loadGroups();
    } else {
      showToast('创建失败', 'error');
    }
  } catch (e) {
    showToast('创建失败', 'error');
  }
}

// ============================================================
// 删除操作
// ============================================================
async function deleteGroup(groupId) {
  try {
    await fetch(`/api/groups/${groupId}`, {method: 'DELETE'});
    showToast('分组已删除');
    loadGroups();
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

async function deleteColor(colorId) {
  try {
    await fetch(`/api/colors/${colorId}`, {method: 'DELETE'});
    showToast('颜色已删除');
    loadGroups();
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

async function updateColor(colorId, data) {
  try {
    await fetch(`/api/colors/${colorId}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    });
    showToast('已更新');
  } catch (e) {
    showToast('更新失败', 'error');
  }
}

// ============================================================
// 拖拽排序 - 分组
// ============================================================
let draggedGroup = null;

function bindGroupDrag(section) {
  const handle = section.querySelector('.group-drag-handle');

  handle.addEventListener('mousedown', () => {
    section.draggable = true;
  });
  handle.addEventListener('mouseup', () => {
    section.draggable = false;
  });

  section.addEventListener('dragstart', (e) => {
    if (!section.draggable) {
      e.preventDefault();
      return;
    }
    draggedGroup = section;
    section.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'group');
  });

  section.addEventListener('dragend', () => {
    section.classList.remove('dragging');
    section.draggable = false;
    draggedGroup = null;
    saveGroupOrder();
  });

  section.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedGroup || draggedGroup === section) return;
    const container = document.getElementById('groupsContainer');
    const rect = section.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    if (after) {
      container.insertBefore(draggedGroup, section.nextSibling);
    } else {
      container.insertBefore(draggedGroup, section);
    }
  });
}

async function saveGroupOrder() {
  const sections = document.querySelectorAll('.group-section');
  const ids = Array.from(sections).map(s => parseInt(s.dataset.groupId));
  try {
    await fetch('/api/groups/reorder', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ids})
    });
  } catch (e) {}
}

// ============================================================
// 拖拽排序 - 颜色卡片
// ============================================================
let draggedCard = null;

function bindColorsGridDrag(grid) {
  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.color-card');
    if (!card) return;
    draggedCard = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'color');
  });

  grid.addEventListener('dragend', (e) => {
    const card = e.target.closest('.color-card');
    if (card) card.classList.remove('dragging');
    // 移除所有占位
    grid.querySelectorAll('.drag-placeholder').forEach(p => p.remove());
    draggedCard = null;
    saveColorOrder(grid);
  });

  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedCard) return;
    const afterElement = getDragAfterElement(grid, e.clientX, e.clientY);
    // 移除旧占位
    grid.querySelectorAll('.drag-placeholder').forEach(p => p.remove());
    // 创建占位
    const placeholder = document.createElement('div');
    placeholder.className = 'drag-placeholder';
    placeholder.style.width = draggedCard.offsetWidth + 'px';
    placeholder.style.height = draggedCard.offsetHeight + 'px';
    placeholder.style.flexShrink = '0';

    if (afterElement == null) {
      // 插到添加按钮之前
      const addCard = grid.querySelector('.add-color-card');
      if (addCard) {
        grid.insertBefore(placeholder, addCard);
      } else {
        grid.appendChild(placeholder);
      }
    } else {
      grid.insertBefore(placeholder, afterElement);
    }
  });

  grid.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggedCard) return;
    const placeholder = grid.querySelector('.drag-placeholder');
    if (placeholder) {
      grid.insertBefore(draggedCard, placeholder);
      placeholder.remove();
    }
  });
}

function getDragAfterElement(grid, x, y) {
  const cards = [...grid.querySelectorAll('.color-card:not(.dragging)')];
  return cards.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offsetX = x - box.left - box.width / 2;
    const offsetY = y - box.top - box.height / 2;
    // 主要看 X 轴（水平排列），Y 轴作为辅助
    const offset = offsetX < 0 && offsetY > -box.height / 2 ? offsetX : offsetX - 1000;
    if (offset < 0 && offset > closest.offset) {
      return {offset, element: child};
    }
    return closest;
  }, {offset: Number.NEGATIVE_INFINITY}).element;
}

async function saveColorOrder(grid) {
  const groupId = parseInt(grid.dataset.groupId);
  const cards = grid.querySelectorAll('.color-card');
  const ids = Array.from(cards).map(c => parseInt(c.dataset.colorId));
  try {
    await fetch(`/api/groups/${groupId}/colors/reorder`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ids})
    });
  } catch (e) {}
}

// ============================================================
// 退出登录
// ============================================================
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', {method: 'POST'});
  window.location.href = '/login';
});

// 全局事件绑定
function bindEvents() {
  // ESC 关闭模态框
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
  });
}
