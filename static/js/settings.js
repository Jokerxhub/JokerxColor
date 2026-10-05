/* ============================================================
   JokerxColor - 设置页面交互
   ============================================================ */

let currentTheme = localStorage.getItem('jokerxcolor_theme') || 'system';
let currentUser = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(currentTheme);
  await checkAuth();
  await loadSettings();
  bindTabNavigation();
  bindPersonalize();
  bindDataManagement();
  bindUserManagement();
  bindSecurity();
});

async function checkAuth() {
  try {
    const resp = await fetch('/api/auth/me');
    const data = await resp.json();
    if (!data.authenticated) {
      window.location.href = '/login';
      return;
    }
    currentUser = data.user;
  } catch (e) {
    window.location.href = '/login';
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('jokerxcolor_theme', theme);
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

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('active'); });
});

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
// Tab 导航
// ============================================================
function bindTabNavigation() {
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
      item.classList.add('active');
      document.getElementById('tab-' + item.dataset.tab).classList.add('active');
    });
  });
}

// ============================================================
// 加载设置
// ============================================================
async function loadSettings() {
  try {
    const resp = await fetch('/api/settings');
    const data = await resp.json();

    // 主题
    currentTheme = data.theme || 'system';
    applyTheme(currentTheme);
    document.querySelectorAll('.theme-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.themeValue === currentTheme);
    });

    // 卡片尺寸
    const w = parseInt(data.card_width) || 200;
    const h = parseInt(data.card_height) || 160;
    document.getElementById('cardWidthSlider').value = w;
    document.getElementById('cardHeightSlider').value = h;
    document.getElementById('cardWidthValue').textContent = w + ' px';
    document.getElementById('cardHeightValue').textContent = h + ' px';
    updatePreview(w, h);

    // 登录保护（仅管理员可见）
    if (currentUser && currentUser.is_admin) {
      document.getElementById('authRequiredSection').style.display = 'block';
      document.getElementById('authRequiredSwitch').checked = data.auth_required === 'true';
    }
  } catch (e) {}
}

// ============================================================
// 个性化
// ============================================================
function bindPersonalize() {
  // 主题选择
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      currentTheme = opt.dataset.themeValue;
      applyTheme(currentTheme);
    });
  });

  // 滑块
  const wSlider = document.getElementById('cardWidthSlider');
  const hSlider = document.getElementById('cardHeightSlider');
  wSlider.addEventListener('input', () => {
    document.getElementById('cardWidthValue').textContent = wSlider.value + ' px';
    updatePreview(parseInt(wSlider.value), parseInt(hSlider.value));
  });
  hSlider.addEventListener('input', () => {
    document.getElementById('cardHeightValue').textContent = hSlider.value + ' px';
    updatePreview(parseInt(wSlider.value), parseInt(hSlider.value));
  });

  // 保存
  document.getElementById('savePersonalize').addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/settings', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          card_width: wSlider.value,
          card_height: hSlider.value,
          theme: currentTheme
        })
      });
      if (resp.ok) {
        showToast('设置已保存');
      } else {
        const data = await resp.json();
        showToast(data.error || '保存失败（需要管理员权限）', 'error');
      }
    } catch (e) {
      showToast('保存失败', 'error');
    }
  });
}

function updatePreview(width, height) {
  const card = document.getElementById('previewCard');
  const swatch = document.getElementById('previewSwatch');
  card.style.width = width + 'px';
  swatch.style.height = height + 'px';
}

// ============================================================
// 数据管理
// ============================================================
function bindDataManagement() {
  // 导出
  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      const resp = await fetch('/api/data/export');
      const data = await resp.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jokerxcolor-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('数据已导出');
    } catch (e) {
      showToast('导出失败', 'error');
    }
  });

  // 导入
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showConfirm('导入数据', '导入将覆盖现有所有颜色和分组数据，确定继续吗？', async () => {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const resp = await fetch('/api/data/import', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(data)
        });
        if (resp.ok) {
          showToast('数据已导入');
        } else {
          const err = await resp.json();
          showToast(err.error || '导入失败', 'error');
        }
      } catch (err) {
        showToast('文件格式不正确', 'error');
      }
    });
    e.target.value = '';
  });

  // 恢复默认
  document.getElementById('resetBtn').addEventListener('click', () => {
    showConfirm('恢复默认数据', '这将清除所有自定义颜色和分组，恢复为默认的蓝/粉两色分组。确定继续吗？', async () => {
      try {
        const resp = await fetch('/api/data/reset', {method: 'POST'});
        if (resp.ok) {
          showToast('已恢复默认数据');
        } else {
          showToast('恢复失败', 'error');
        }
      } catch (e) {
        showToast('恢复失败', 'error');
      }
    });
  });
}

// ============================================================
// 用户管理
// ============================================================
function bindUserManagement() {
  loadUsers();

  // 登录保护开关（仅管理员）
  if (currentUser && currentUser.is_admin) {
    document.getElementById('authRequiredSwitch').addEventListener('change', async (e) => {
    try {
      const resp = await fetch('/api/settings', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({auth_required: e.target.checked ? 'true' : 'false'})
      });
      if (resp.ok) {
        showToast(e.target.checked ? '登录保护已开启' : '登录保护已关闭');
      } else {
        showToast('保存失败', 'error');
        e.target.checked = !e.target.checked;
      }
    } catch (err) {
      showToast('保存失败', 'error');
      e.target.checked = !e.target.checked;
    }
    });
  }

  // 添加用户（仅管理员可见）
  if (currentUser && currentUser.is_admin) {
    document.getElementById('addUserBtn').style.display = 'inline-flex';
  }
  document.getElementById('addUserBtn').addEventListener('click', () => {
    document.getElementById('newUserUsername').value = '';
    document.getElementById('newUserPassword').value = '';
    openModal('addUserModal');
  });

  document.getElementById('confirmAddUser').addEventListener('click', async () => {
    const username = document.getElementById('newUserUsername').value.trim();
    const password = document.getElementById('newUserPassword').value;
    if (!username || !password) { showToast('用户名和密码不能为空', 'error'); return; }
    try {
      const resp = await fetch('/api/users', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password})
      });
      if (resp.ok) { closeModal('addUserModal'); showToast('用户已添加'); loadUsers(); }
      else { const data = await resp.json(); showToast(data.error || '添加失败', 'error'); }
    } catch (e) { showToast('添加失败', 'error'); }
  });

  // 编辑用户
  document.getElementById('confirmEditUser').addEventListener('click', async () => {
    const userId = document.getElementById('editUserId').value;
    const username = document.getElementById('editUserUsername').value.trim();
    const email = document.getElementById('editUserEmail').value.trim();
    const password = document.getElementById('editUserPassword').value;
    const isAdmin = document.getElementById('editUserIsAdmin').checked;
    const body = {username, email};
    // 只有管理员能改密码和角色
    if (currentUser && currentUser.is_admin) {
      if (password) body.password = password;
      body.is_admin = isAdmin;
    }
    try {
      const resp = await fetch(`/api/users/${userId}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
      });
      if (resp.ok) {
        closeModal('editUserModal');
        showToast('用户已更新');
        loadUsers();
      } else {
        const data = await resp.json();
        showToast(data.error || '更新失败', 'error');
      }
    } catch (e) {
      showToast('更新失败', 'error');
    }
  });
}

async function loadUsers() {
  try {
    const resp = await fetch('/api/users');
    if (!resp.ok) return;
    const users = await resp.json();
    const tbody = document.getElementById('usersTableBody');
    const isAdmin = currentUser && currentUser.is_admin;
    const isSelf = u => u.id === currentUser.id;
    const canEdit = u => isAdmin || isSelf(u);
    const canDelete = u => isAdmin && !isSelf(u);
    tbody.innerHTML = users.map(u => `
      <tr>
        <td><strong>${escapeHtml(u.username)}</strong></td>
        <td><span class="user-badge ${u.is_admin ? 'admin' : 'user'}">${u.is_admin ? '管理员' : '普通用户'}</span></td>
        <td>${u.totp_enabled ? '✅' : '—'}</td>
        <td>${u.casdoor_bound ? '🔗 已绑定' : '—'}</td>
        <td>${u.email ? escapeHtml(u.email) : '—'}</td>
        <td style="color:var(--text-secondary);font-size:12px;">${u.created_at}</td>
        <td>
          ${canEdit ? `<button class="btn btn-sm btn-ghost" onclick="editUser(${u.id}, '${escapeHtml(u.username)}', ${u.is_admin}, '${escapeHtml(u.email || '')}')">编辑</button>` : ''}
          ${canDelete ? `<button class="btn btn-sm btn-ghost" style="color:var(--danger);" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">删除</button>` : ''}
        </td>
      </tr>
    `).join('');
  } catch (e) {}
}

window.editUser = function(id, username, isAdmin, email) {
  const isAdminUser = currentUser && currentUser.is_admin;
  document.getElementById('editUserId').value = id;
  document.getElementById('editUserUsername').value = username;
  document.getElementById('editUserEmail').value = email || '';
  document.getElementById('editUserPassword').value = '';
  document.getElementById('editUserIsAdmin').checked = isAdmin;
  // 普通用户编辑自己时隐藏密码和角色字段
  document.getElementById('editUserPasswordGroup').style.display = isAdminUser ? 'block' : 'none';
  document.getElementById('editUserIsAdminGroup').style.display = isAdminUser ? 'block' : 'none';
  openModal('editUserModal');
};

window.deleteUser = function(id, username) {
  showConfirm('删除用户', `确定要删除用户"${username}"吗？此操作不可撤销。`, async () => {
    try {
      const resp = await fetch(`/api/users/${id}`, {method: 'DELETE'});
      if (resp.ok) {
        showToast('用户已删除');
        loadUsers();
      } else {
        const data = await resp.json();
        showToast(data.error || '删除失败', 'error');
      }
    } catch (e) {
      showToast('删除失败', 'error');
    }
  });
};

// ============================================================
// 安全设置
// ============================================================
function bindSecurity() {
  // 修改密码（需验证原密码）
  document.getElementById('changePasswordBtn').addEventListener('click', async () => {
    const oldPwd = document.getElementById('oldPassword').value;
    const p1 = document.getElementById('newPassword').value;
    const p2 = document.getElementById('confirmPassword').value;
    if (!oldPwd) { showToast('请输入原密码', 'error'); return; }
    if (!p1 || p1.length < 4) { showToast('新密码至少 4 位', 'error'); return; }
    if (p1 !== p2) { showToast('两次输入的新密码不一致', 'error'); return; }
    try {
      const resp = await fetch('/api/auth/change-password', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({old_password: oldPwd, new_password: p1, confirm_password: p2})
      });
      if (resp.ok) {
        showToast('密码已修改');
        document.getElementById('oldPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
      } else {
        const data = await resp.json();
        showToast(data.error || '修改失败', 'error');
      }
    } catch (e) { showToast('修改失败', 'error'); }
  });

  // 2FA 状态
  loadTwoFAStatus();

  // Casdoor 绑定状态
  loadCasdoorBindStatus();

  // 设置 2FA
  document.getElementById('twofaSetupBtn')?.addEventListener('click', setupTwoFA);

  // 验证启用
  document.getElementById('twofaVerifyBtn').addEventListener('click', async () => {
    const code = document.getElementById('twofaVerifyCode').value.trim();
    if (!code) {
      showToast('请输入验证码', 'error');
      return;
    }
    try {
      const resp = await fetch('/api/2fa/verify', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code})
      });
      if (resp.ok) {
        showToast('双因素认证已启用');
        loadTwoFAStatus();
      } else {
        const data = await resp.json();
        showToast(data.error || '验证失败', 'error');
      }
    } catch (e) {
      showToast('验证失败', 'error');
    }
  });

  // 关闭 2FA
  document.getElementById('twofaDisableBtn').addEventListener('click', async () => {
    const password = document.getElementById('twofaDisablePassword').value;
    if (!password) {
      showToast('请输入当前密码', 'error');
      return;
    }
    try {
      const resp = await fetch('/api/2fa/disable', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password})
      });
      if (resp.ok) {
        showToast('双因素认证已关闭');
        document.getElementById('twofaDisablePassword').value = '';
        loadTwoFAStatus();
      } else {
        const data = await resp.json();
        showToast(data.error || '关闭失败', 'error');
      }
    } catch (e) {
      showToast('关闭失败', 'error');
    }
  });
}

async function loadTwoFAStatus() {
  try {
    const resp = await fetch('/api/auth/me');
    const data = await resp.json();
    const statusEl = document.getElementById('twofaStatus');
    const setupArea = document.getElementById('twofaSetupArea');
    const disableArea = document.getElementById('twofaDisableArea');

    if (data.user && data.user.totp_enabled) {
      statusEl.innerHTML = `<div style="padding:10px 14px;background:rgba(34,197,94,0.1);border-radius:8px;color:var(--success);font-size:14px;margin-bottom:12px;">✅ 双因素认证已启用</div>`;
      setupArea.style.display = 'none';
      disableArea.style.display = 'block';
    } else {
      statusEl.innerHTML = `
        <div style="padding:10px 14px;background:var(--bg-tertiary);border-radius:8px;color:var(--text-secondary);font-size:14px;margin-bottom:12px;">
          ⚠️ 双因素认证未启用
          <button class="btn btn-primary btn-sm" style="margin-left:12px;" onclick="setupTwoFA()">立即设置</button>
        </div>
      `;
      setupArea.style.display = 'none';
      disableArea.style.display = 'none';
    }
  } catch (e) {}
}

window.setupTwoFA = async function() {
  try {
    const resp = await fetch('/api/2fa/setup', {method: 'POST'});
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      showToast(errData.error || '设置失败 (' + resp.status + ')', 'error');
      return;
    }
    const data = await resp.json();
    document.getElementById('twofaQrImg').src = data.qr_code;
    document.getElementById('twofaSecretText').textContent = data.secret;
    document.getElementById('twofaSecretText').onclick = () => {
      navigator.clipboard.writeText(data.secret);
      showToast('密钥已复制');
    };
    document.getElementById('twofaSetupArea').style.display = 'block';
    document.getElementById('twofaVerifyCode').value = '';
    document.getElementById('twofaStatus').innerHTML = '';
  } catch (e) {
    showToast('设置失败: ' + e.message, 'error');
  }
};

// ============================================================
// Casdoor 绑定
// ============================================================
async function loadCasdoorBindStatus() {
  try {
    const resp = await fetch('/api/auth/casdoor/bind-status');
    const data = await resp.json();
    const section = document.getElementById('casdoorBindSection');
    const statusEl = document.getElementById('casdoorBindStatus');

    if (!data.enabled) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';

    if (data.bound) {
      statusEl.innerHTML = `
        <div style="padding:12px 14px;background:rgba(34,197,94,0.1);border-radius:8px;margin-bottom:12px;">
          <div style="color:var(--success);font-size:14px;font-weight:600;margin-bottom:4px;">✅ 已绑定 Casdoor 账号</div>
          <div style="font-size:12px;color:var(--text-secondary);">Casdoor 标识: ${escapeHtml(data.casdoor_sub)}</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="unbindCasdoor()">解绑 Casdoor</button>
      `;
    } else {
      statusEl.innerHTML = `
        <div style="padding:12px 14px;background:var(--bg-tertiary);border-radius:8px;margin-bottom:12px;">
          <div style="color:var(--text-secondary);font-size:14px;margin-bottom:4px;">⚠️ 尚未绑定 Casdoor 账号</div>
          <div style="font-size:12px;color:var(--text-muted);">绑定后可使用 Casdoor SSO 免密登录</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="bindCasdoor()">绑定 Casdoor 账号</button>
      `;
    }
  } catch (e) {}
}

window.bindCasdoor = async function() {
  try {
    const resp = await fetch('/api/auth/casdoor/bind', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'}
    });
    const data = await resp.json();
    if (resp.ok && data.auth_url) {
      // 前端跳转至 Casdoor 授权页
      window.location.href = data.auth_url;
    } else {
      showToast(data.error || '绑定失败', 'error');
    }
  } catch (e) {
    showToast('绑定失败', 'error');
  }
};

window.unbindCasdoor = function() {
  showConfirm('解绑 Casdoor', '确定要解绑当前的 Casdoor 账号吗？解绑后将无法使用 Casdoor SSO 登录。', async () => {
    try {
      const resp = await fetch('/api/auth/casdoor/unbind', {method: 'POST'});
      if (resp.ok) {
        showToast('已解绑 Casdoor');
        loadCasdoorBindStatus();
      } else {
        const data = await resp.json();
        showToast(data.error || '解绑失败', 'error');
      }
    } catch (e) {
      showToast('解绑失败', 'error');
    }
  });
};
