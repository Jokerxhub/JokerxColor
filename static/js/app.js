/* ============================================================
   JokerxColor - 主页面交互（左侧边栏布局）
   ============================================================ */

let groups = [];
let currentGroupId = null;
let currentTheme = localStorage.getItem('jokerxcolor_theme') || 'system';
let cardWidth = 200;
let cardHeight = 160;
let sortMode = false;   // 排序模式：点击排序按钮后才能拖动卡片
let deleteMode = false; // 删除模式：点击删除颜色按钮后，点击卡片删除

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(currentTheme);
  await loadSettings();
  await checkAuth();
  await loadGroups();
  bindGlobalEvents();
});

async function checkAuth() {
  try {
    const resp = await fetch('/api/auth/me');
    const data = await resp.json();
    if (data.authenticated) document.getElementById('logoutBtn').style.display = 'flex';
    if (data.auth_required && !data.authenticated) window.location.href = '/login';
  } catch (e) {}
}

async function loadSettings() {
  try {
    const resp = await fetch('/api/settings');
    const data = await resp.json();
    cardWidth = parseInt(data.card_width) || 200;
    cardHeight = parseInt(data.card_height) || 160;
    if (data.theme) { currentTheme = data.theme; applyTheme(currentTheme); }
  } catch (e) {}
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('jokerxcolor_theme', theme);
}
const themeOrder = ['light', 'dark', 'system'];
document.getElementById('themeToggle').addEventListener('click', () => {
  currentTheme = themeOrder[(themeOrder.indexOf(currentTheme) + 1) % 3];
  applyTheme(currentTheme);
});

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return [parseInt(hex.substring(0,2),16), parseInt(hex.substring(2,4),16), parseInt(hex.substring(4,6),16)];
}
function rgbToHex(r, g, b) {
  return '#' + [r,g,b].map(x => Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,'0').toUpperCase()).join('');
}
function complementary(hex) { const [r,g,b] = hexToRgb(hex); return rgbToHex(255-r,255-g,255-b); }
function triadic(hex) { const [r,g,b] = hexToRgb(hex); return [rgbToHex(b,r,g), rgbToHex(g,b,r)]; }
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

function showToast(message, type = 'success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${type==='success'?'✓':type==='error'?'✕':'ℹ'}</span><span>${message}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = 'toastOut 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, 2500);
}

function copyToClipboard(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => showToast(`已复制 ${text}`));
  else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); showToast(`已复制 ${text}`); }
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('active'); }));

let confirmCallback = null;
function showConfirm(title, message, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = callback;
  openModal('confirmModal');
}
document.getElementById('confirmOkBtn').addEventListener('click', () => { closeModal('confirmModal'); if (confirmCallback) confirmCallback(); });

// ============================================================
async function loadGroups() {
  try {
    const resp = await fetch('/api/groups');
    groups = await resp.json();
    if (groups.length > 0) {
      if (!currentGroupId || !groups.find(g => g.id === currentGroupId)) currentGroupId = groups[0].id;
    } else currentGroupId = null;
    renderSidebar();
    renderColors();
  } catch (e) { showToast('加载失败', 'error'); }
}

// ============================================================
function renderSidebar() {
  const container = document.getElementById('sidebarGroups');
  container.innerHTML = '';
  groups.forEach(group => {
    const item = document.createElement('div');
    item.className = 'sidebar-group-item' + (group.id === currentGroupId ? ' active' : '');
    item.dataset.groupId = group.id;
    item.draggable = true;
    item.innerHTML = `
      <span class="drag-handle" title="拖动排序">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
      </span>
      <input type="text" class="group-name" value="${escapeHtml(group.name)}" data-group-id="${group.id}" readonly>`;

    // 单击选中分组
    item.addEventListener('click', e => {
      if (e.target.closest('.group-name') && !e.target.readOnly) return; // 编辑中不切换
      selectGroup(group.id);
    });

    // 双击分组卡片任意位置进入重命名
    item.addEventListener('dblclick', e => {
      if (e.target.closest('.drag-handle')) return;
      const input = item.querySelector('.group-name');
      input.readOnly = false;
      input.focus();
      input.select();
    });

    // 拖拽排序（整卡可拖，编辑时禁用）
    item.addEventListener('dragstart', e => {
      const input = item.querySelector('.group-name');
      if (!input.readOnly) { e.preventDefault(); return; }
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); saveGroupOrder(); });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      const dragging = container.querySelector('.dragging');
      if (!dragging || dragging === item) return;
      const rect = item.getBoundingClientRect();
      if (e.clientY > rect.top + rect.height / 2) container.insertBefore(dragging, item.nextSibling);
      else container.insertBefore(dragging, item);
    });

    const nameInput = item.querySelector('.group-name');
    nameInput.addEventListener('blur', async () => {
      nameInput.readOnly = true;
      const newName = nameInput.value.trim();
      if (!newName) { nameInput.value = group.name; return; }
      if (newName !== group.name) {
        try {
          await fetch(`/api/groups/${group.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:newName}) });
          group.name = newName;
          if (group.id === currentGroupId) document.getElementById('currentGroupName').textContent = newName;
          showToast('分组已重命名');
        } catch (e) { showToast('重命名失败', 'error'); }
      }
    });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });
    nameInput.addEventListener('click', e => e.stopPropagation());

    container.appendChild(item);
  });
}

function selectGroup(groupId) {
  currentGroupId = groupId;
  document.querySelectorAll('.sidebar-group-item').forEach(el => el.classList.toggle('active', parseInt(el.dataset.groupId) === groupId));
  const g = groups.find(g => g.id === groupId);
  if (g) document.getElementById('currentGroupName').textContent = g.name;
  renderColors();
}

async function saveGroupOrder() {
  const ids = Array.from(document.querySelectorAll('.sidebar-group-item')).map(i => parseInt(i.dataset.groupId));
  try { await fetch('/api/groups/reorder', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ids}) }); } catch (e) {}
}

// ============================================================
function renderColors() {
  const grid = document.getElementById('colorsGrid');
  grid.innerHTML = '';
  const group = groups.find(g => g.id === currentGroupId);
  if (!group) { grid.innerHTML = '<div style="color:var(--text-muted);padding:40px;text-align:center;">请先在左侧创建分组</div>'; return; }
  if (group.colors.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted);padding:40px;text-align:center;">暂无颜色，点击右上角"添加颜色"</div>';
    return;
  }
  group.colors.forEach(color => grid.appendChild(createColorCard(color)));
  bindGridDrag(grid);
  updateModeButtons();
}

function updateModeButtons() {
  document.getElementById('sortColorBtn').classList.toggle('active', sortMode);
  document.getElementById('deleteColorBtn').classList.toggle('active', deleteMode);
  document.querySelectorAll('#colorsGrid .color-card').forEach(card => {
    card.classList.toggle('sort-mode', sortMode);
    card.classList.toggle('delete-mode', deleteMode);
    card.draggable = sortMode;
  });
}

function createColorCard(color) {
  const [r, g, b] = hexToRgb(color.hex);
  const comp = complementary(color.hex);
  const tri = triadic(color.hex);
  const card = document.createElement('div');
  card.className = 'color-card';
  card.dataset.colorId = color.id;
  card.draggable = true;
  card.style.width = cardWidth + 'px';
  card.innerHTML = `
    <div class="color-swatch" style="height:${cardHeight}px;background:${color.hex};"></div>
    <div class="color-info">
      <input type="text" class="color-name" value="${escapeHtml(color.name || '')}" placeholder="颜色名称" readonly>
      <div class="code-panel">
        <div class="color-codes">
          <div class="code-row">
            <span class="code-label">HEX</span>
            <span class="code-value" data-copy="${color.hex}">${color.hex}</span>
          </div>
          <div class="code-row">
            <span class="code-label">RGB</span>
            <span class="code-value rgb-box" data-copy="${r}">${r}</span>
            <span class="code-value rgb-box" data-copy="${g}">${g}</span>
            <span class="code-value rgb-box" data-copy="${b}">${b}</span>
          </div>
        </div>
        <div class="color-schemes">
          <div class="scheme-row">
            <span class="schemes-label">互补</span>
            <div class="scheme-swatch" data-scheme-hex="${comp}" style="background:${comp};"></div>
          </div>
          <div class="scheme-row">
            <span class="schemes-label">三角</span>
            <div class="scheme-swatch" data-scheme-hex="${tri[0]}" style="background:${tri[0]};"></div>
            <div class="scheme-swatch" data-scheme-hex="${tri[1]}" style="background:${tri[1]};"></div>
          </div>
        </div>
      </div>
    </div>`;

  // 删除模式：点击卡片删除
  card.addEventListener('click', e => {
    if (!deleteMode) return;
    if (e.target.closest('[data-copy]') || e.target.closest('.color-name') || e.target.closest('.scheme-swatch')) return;
    e.stopPropagation();
    showConfirm('删除颜色', `确定要删除颜色 ${color.hex} 吗？此操作不可撤销。`, () => deleteColor(color.id));
  });

  card.querySelectorAll('[data-copy]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); copyToClipboard(el.dataset.copy); }));

  card.querySelector('.color-swatch').addEventListener('click', e => {
    if (deleteMode) return;
    e.stopPropagation();
    const codes = card.querySelector('.color-codes');
    const schemes = card.querySelector('.color-schemes');
    if (schemes.classList.contains('active')) { schemes.classList.remove('active'); codes.classList.remove('hidden'); }
    else { schemes.classList.add('active'); codes.classList.add('hidden'); }
  });

  card.querySelectorAll('.scheme-swatch').forEach(sw => sw.addEventListener('click', e => { e.stopPropagation(); copyToClipboard(sw.dataset.schemeHex); }));

  const nameInput = card.querySelector('.color-name');
  nameInput.addEventListener('dblclick', () => { nameInput.readOnly = false; nameInput.focus(); nameInput.select(); });
  nameInput.addEventListener('blur', () => {
    nameInput.readOnly = true;
    if (nameInput.value !== (color.name || '')) { updateColor(color.id, {name: nameInput.value}); color.name = nameInput.value; }
  });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

  return card;
}

// ============================================================
function bindGridDrag(grid) {
  let draggedCard = null;
  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('.color-card');
    if (!card) return;
    draggedCard = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  grid.addEventListener('dragend', () => {
    if (draggedCard) draggedCard.classList.remove('dragging');
    draggedCard = null;
    saveColorOrder();
  });
  // 参照分组拖动：直接移动实际卡片，原位置不留占位/参照
  grid.addEventListener('dragover', e => {
    e.preventDefault();
    if (!draggedCard) return;
    const afterEl = getDragAfterElement(grid, e.clientX);
    const addCard = grid.querySelector('.add-color-card');
    if (afterEl == null) {
      if (addCard) grid.insertBefore(draggedCard, addCard);
      else grid.appendChild(draggedCard);
    } else {
      grid.insertBefore(draggedCard, afterEl);
    }
  });
  grid.addEventListener('drop', e => e.preventDefault());
}

// 横向排列：根据鼠标水平位置找到应插入位置的下一个卡片
function getDragAfterElement(grid, x) {
  const cards = [...grid.querySelectorAll('.color-card:not(.dragging)')];
  let closest = {offset: Number.NEGATIVE_INFINITY, element: null};
  for (const child of cards) {
    const box = child.getBoundingClientRect();
    const mid = box.left + box.width / 2;
    const offset = x - mid;  // 鼠标在该卡片中点左侧时 offset<0
    if (offset < 0 && offset > closest.offset) closest = {offset, element: child};
  }
  return closest.element;
}

async function saveColorOrder() {
  if (!currentGroupId) return;
  const ids = Array.from(document.querySelectorAll('#colorsGrid .color-card')).map(c => parseInt(c.dataset.colorId));
  try { await fetch(`/api/groups/${currentGroupId}/colors/reorder`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ids}) }); } catch (e) {}
}

// ============================================================
function openAddColorModal() {
  if (!currentGroupId) { showToast('请先创建分组', 'error'); return; }
  document.getElementById('newColorName').value = '';
  document.getElementById('newColorPicker').value = '#00A9E0';
  document.getElementById('newColorHex').value = '#00A9E0';
  openModal('addColorModal');
}
document.getElementById('addColorBtn').addEventListener('click', openAddColorModal);

// 排序模式切换
document.getElementById('sortColorBtn').addEventListener('click', () => {
  sortMode = !sortMode;
  if (sortMode) deleteMode = false;
  updateModeButtons();
  showToast(sortMode ? '排序模式：拖动卡片排序，再次点击退出' : '已退出排序模式');
});

// 删除颜色模式切换
document.getElementById('deleteColorBtn').addEventListener('click', () => {
  deleteMode = !deleteMode;
  if (deleteMode) sortMode = false;
  updateModeButtons();
  showToast(deleteMode ? '删除模式：点击卡片删除（需确认），再次点击退出' : '已退出删除模式');
});

// 删除分组（侧边栏底部按钮，仅选中分组可删）
document.getElementById('deleteGroupBtn').addEventListener('click', () => {
  const g = groups.find(g => g.id === currentGroupId);
  if (!g) { showToast('请先选择要删除的分组', 'error'); return; }
  showConfirm('删除分组', `确定要删除分组"${g.name}"吗？组内所有颜色将被删除，此操作不可撤销。`, () => deleteGroup(g.id));
});
document.getElementById('newColorPicker').addEventListener('input', e => { document.getElementById('newColorHex').value = e.target.value.toUpperCase(); });
document.getElementById('newColorHex').addEventListener('input', e => { let v = e.target.value; if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9A-Fa-f]{6}$/.test(v)) document.getElementById('newColorPicker').value = v; });
document.getElementById('confirmAddColor').addEventListener('click', async () => {
  const name = document.getElementById('newColorName').value.trim();
  let hex = document.getElementById('newColorHex').value.trim().toUpperCase();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (!/^#[0-9A-F]{6}$/.test(hex) && !/^#[0-9A-F]{3}$/.test(hex)) { showToast('颜色格式不正确', 'error'); return; }
  try {
    const resp = await fetch(`/api/groups/${currentGroupId}/colors`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({hex, name}) });
    if (resp.ok) { closeModal('addColorModal'); showToast('颜色已添加'); loadGroups(); }
    else { const d = await resp.json(); showToast(d.error || '添加失败', 'error'); }
  } catch (e) { showToast('添加失败', 'error'); }
});

document.getElementById('addGroupBtn').addEventListener('click', async () => {
  const name = prompt('请输入分组名称：', '新分组');
  if (!name || !name.trim()) return;
  try {
    const resp = await fetch('/api/groups', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name: name.trim()}) });
    if (resp.ok) { const d = await resp.json(); showToast('分组已创建'); currentGroupId = d.id; loadGroups(); }
    else showToast('创建失败', 'error');
  } catch (e) { showToast('创建失败', 'error'); }
});

async function deleteGroup(groupId) {
  try { await fetch(`/api/groups/${groupId}`, {method:'DELETE'}); showToast('分组已删除'); if (currentGroupId === groupId) currentGroupId = null; loadGroups(); } catch (e) { showToast('删除失败', 'error'); }
}
async function deleteColor(colorId) {
  try { await fetch(`/api/colors/${colorId}`, {method:'DELETE'}); showToast('颜色已删除'); loadGroups(); } catch (e) { showToast('删除失败', 'error'); }
}
async function updateColor(colorId, data) {
  try { await fetch(`/api/colors/${colorId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) }); } catch (e) {}
}

function bindGlobalEvents() {
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); });
  document.getElementById('logoutBtn').addEventListener('click', async () => { await fetch('/api/auth/logout', {method:'POST'}); window.location.href = '/login'; });
}
