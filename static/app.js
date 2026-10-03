(() => {
  "use strict";

  const state = {
    groups: [],
    currentGroupId: null,
    theme: localStorage.getItem("jokerx-theme") || "system",
    cardWidth: Number(localStorage.getItem("jokerx-card-width") || 300),
    harmony: {}
  };

  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));

  async function api(url, options={}) {
    const res = await fetch(url, {
      headers: {"Content-Type":"application/json", ...(options.headers || {})},
      ...options
    });
    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      if (body.login_required) {
        showLoginRequired();
        throw new Error("login_required");
      }
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `请求失败 ${res.status}`);
    }
    return res.json();
  }

  function toast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    $("#toastWrap").appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function setTheme(theme) {
    state.theme = theme;
    localStorage.setItem("jokerx-theme", theme);
    const effective = theme === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    document.documentElement.dataset.theme = effective;
  }

  function cycleTheme() {
    const next = {system:"light",light:"dark",dark:"system"}[state.theme];
    setTheme(next);
    toast(`主题：${next === "system" ? "跟随系统" : next === "dark" ? "暗色" : "亮色"}`);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r,g,b) {
    return "#" + [r,g,b].map(x => Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,"0")).join("").toUpperCase();
  }

  function hsvToHex(h,s,v) {
    const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
    let r=0,g=0,b=0;
    if(h<60){r=c;g=x;} else if(h<120){r=x;g=c;} else if(h<180){g=c;b=x;}
    else if(h<240){g=x;b=c;} else if(h<300){r=x;b=c;} else {r=c;b=x;}
    return rgbToHex((r+m)*255,(g+m)*255,(b+m)*255);
  }

  function rotateHex(hex, deg) {
    const [r,g,b] = hexToRgb(hex).map(x=>x/255);
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
    let h=0;
    if(d) {
      if(mx===r) h=60*(((g-b)/d)%6);
      else if(mx===g) h=60*((b-r)/d+2);
      else h=60*((r-g)/d+4);
    }
    if(h<0) h+=360;
    const s=mx===0?0:d/mx;
    return hsvToHex((h+deg+360)%360,s,mx);
  }

  function harmonyColors(hex, type) {
    if(type === "complementary") return [hex, rotateHex(hex,180)];
    return [hex, rotateHex(hex,120), rotateHex(hex,240)];
  }

  async function load() {
    const cfg = await api("/api/config");
    if (cfg.oidc_enabled && !cfg.authenticated) {
      showLoginRequired();
      return;
    }
    const data = await api("/api/data");
    state.groups = data.groups || [];
    if (!state.currentGroupId || !state.groups.some(g=>g.id===state.currentGroupId)) {
      state.currentGroupId = state.groups[0]?.id ?? null;
    }
    render();
  }

  function showLoginRequired() {
    openModal(`
      <div class="modal-head"><h2>需要登录</h2><button class="icon-btn" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <p>JokerxColor 已启用 OIDC / Casdoor，请登录后继续。</p>
        <a class="primary-btn" style="display:inline-block;text-decoration:none" href="/auth/login">使用 Casdoor 登录</a>
      </div>
    `);
  }

  function render() {
    document.documentElement.style.setProperty("--card-width", `${state.cardWidth}px`);
    renderGroups();
    renderColors();
  }

  function renderGroups() {
    const box = $("#groupList");
    box.innerHTML = "";
    state.groups.forEach(g => {
      const el = document.createElement("div");
      el.className = "group-item" + (g.id === state.currentGroupId ? " active" : "");
      el.draggable = true;
      el.dataset.id = g.id;
      el.innerHTML = `
        <span class="group-drag">⋮⋮</span>
        <span class="group-name">${esc(g.name)}</span>
        <span class="group-count">${g.colors.length}</span>
        <span class="group-menu">
          <button class="mini-btn rename-group" title="重命名">✎</button>
          <button class="mini-btn delete-group" title="删除">×</button>
        </span>`;
      el.addEventListener("click", (e) => {
        if (e.target.closest(".group-menu")) return;
        state.currentGroupId = g.id;
        render();
      });
      el.querySelector(".rename-group").onclick = () => renameGroup(g);
      el.querySelector(".delete-group").onclick = () => deleteGroup(g);
      el.addEventListener("dragstart", e => e.dataTransfer.setData("text/plain", String(g.id)));
      el.addEventListener("dragover", e => e.preventDefault());
      el.addEventListener("drop", async e => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData("text/plain"));
        const to = g.id;
        if (from === to) return;
        reorderArray(state.groups, from, to);
        render();
        await api("/api/groups/reorder", {
          method:"POST", body:JSON.stringify({ids:state.groups.map(x=>x.id)})
        });
      });
      box.appendChild(el);
    });
  }

  function reorderArray(arr, fromId, toId) {
    const from = arr.findIndex(x=>x.id===fromId);
    const to = arr.findIndex(x=>x.id===toId);
    if(from<0 || to<0) return;
    const [item] = arr.splice(from,1);
    arr.splice(to,0,item);
  }

  function currentGroup() {
    return state.groups.find(g=>g.id===state.currentGroupId);
  }

  function renderColors() {
    const g = currentGroup();
    $("#currentGroupName").textContent = g?.name || "未选择分组";
    $("#currentGroupMeta").textContent = `${g?.colors.length || 0} 个颜色`;
    const grid = $("#colorGrid");
    grid.innerHTML = "";
    $("#emptyState").classList.toggle("hidden", !!g?.colors.length);

    if (!g) return;
    g.colors.forEach((c, idx) => {
      const card = document.createElement("article");
      card.className = "color-card";
      card.draggable = true;
      card.dataset.id = c.id;
      const rgb = hexToRgb(c.hex).join(",");
      const type = state.harmony[c.id] || "complementary";
      const harmony = harmonyColors(c.hex, type);
      card.innerHTML = `
        <div class="color-swatch" style="background:${esc(c.hex)}">
          <div class="name-pill">${esc(c.name)}</div>
          <div class="card-actions">
            <button class="card-action edit-card" title="编辑">✎</button>
            <button class="card-action delete-card" title="删除">×</button>
          </div>
        </div>
        <div class="code-area">
          <div class="code-row"><span class="code-label">HEX</span><span class="code-value">${esc(c.hex)}</span><button class="copy-btn" data-copy="${esc(c.hex)}">复制</button></div>
          <div class="code-row"><span class="code-label">RGB</span><span class="code-value">${rgb}</span><button class="copy-btn" data-copy="${rgb}">复制</button></div>
        </div>
        <div class="harmony">
          <div class="harmony-title">
            <span>${type === "complementary" ? "互补色" : "三角配色"}</span>
            <div class="harmony-toggle">
              <button class="${type==="complementary"?"active":""}" data-harmony="complementary">互补</button>
              <button class="${type==="triadic"?"active":""}" data-harmony="triadic">三角</button>
            </div>
          </div>
          <div class="harmony-colors">
            ${harmony.map(h => `<button class="harmony-chip" style="background:${h}" data-copy="${h}">${h}</button>`).join("")}
          </div>
        </div>`;
      card.querySelector(".edit-card").onclick = () => editColor(c);
      card.querySelector(".delete-card").onclick = () => deleteColor(c);
      card.querySelectorAll(".copy-btn,.harmony-chip").forEach(b => b.onclick = () => copyText(b.dataset.copy));
      card.querySelectorAll("[data-harmony]").forEach(b => b.onclick = () => {
        state.harmony[c.id] = b.dataset.harmony; renderColors();
      });
      card.addEventListener("dragstart", e => e.dataTransfer.setData("text/plain", String(c.id)));
      card.addEventListener("dragover", e => e.preventDefault());
      card.addEventListener("drop", async e => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData("text/plain"));
        const to = c.id;
        if(from === to) return;
        reorderArray(g.colors, from, to);
        renderColors();
        await api("/api/colors/reorder", {
          method:"POST", body:JSON.stringify({group_id:g.id,ids:g.colors.map(x=>x.id)})
        });
      });
      grid.appendChild(card);
    });
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
    toast(`已复制：${text}`);
  }

  function openModal(html) {
    $("#modal").innerHTML = html;
    $("#modalBackdrop").classList.remove("hidden");
  }
  window.closeModal = () => $("#modalBackdrop").classList.add("hidden");

  function modalForm(title, body, onSubmit, submitText="保存") {
    openModal(`
      <div class="modal-head"><h2>${title}</h2><button class="icon-btn" onclick="closeModal()">×</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"><button class="secondary-btn" onclick="closeModal()">取消</button><button class="primary-btn" id="modalSubmit">${submitText}</button></div>
    `);
    $("#modalSubmit").onclick = async () => {
      try { await onSubmit(); closeModal(); await load(); }
      catch(e) { toast(e.message); }
    };
  }

  function addGroup() {
    modalForm("新建分组", `
      <div class="field"><label>分组名称</label><input id="groupName" type="text" placeholder="例如：品牌色"></div>
    `, async () => {
      const name = $("#groupName").value.trim();
      if(!name) throw new Error("请输入分组名称");
      await api("/api/groups",{method:"POST",body:JSON.stringify({name})});
      toast("分组已创建");
    }, "创建");
  }

  function renameGroup(g) {
    modalForm("重命名分组", `
      <div class="field"><label>分组名称</label><input id="groupName" type="text" value="${esc(g.name)}"></div>
    `, async () => {
      const name = $("#groupName").value.trim();
      if(!name) throw new Error("请输入分组名称");
      await api(`/api/groups/${g.id}`,{method:"PATCH",body:JSON.stringify({name})});
      toast("分组名称已修改");
    });
  }

  async function deleteGroup(g) {
    if(!confirm(`确定删除分组“${g.name}”吗？\n该分组中的所有颜色也会被删除，此操作不可撤销。`)) return;
    try {
      await api(`/api/groups/${g.id}`,{method:"DELETE"});
      if(state.currentGroupId===g.id) state.currentGroupId=null;
      await load(); toast("分组已删除");
    } catch(e) { toast(e.message); }
  }

  function addColor() {
    const g = currentGroup();
    if(!g) return toast("请先创建一个分组");
    modalForm("添加颜色", `
      <div class="field"><label>颜色名称</label><input id="colorName" type="text" placeholder="例如：主色蓝"></div>
      <div class="field"><label>HEX</label><input id="colorHex" type="text" value="#00A9E0" placeholder="#000000"></div>
      <div class="field"><label>颜色预览</label><input id="colorPicker" type="color" value="#00A9E0"></div>
    `, async () => {
      const name=$("#colorName").value.trim();
      const hex=$("#colorHex").value.trim().toUpperCase();
      if(!/^#[0-9A-F]{6}$/.test(hex)) throw new Error("HEX 格式应为 #000000");
      await api("/api/colors",{method:"POST",body:JSON.stringify({group_id:g.id,name,hex})});
      toast("颜色已添加");
    }, "添加");
    $("#colorPicker").oninput = e => $("#colorHex").value=e.target.value.toUpperCase();
    $("#colorHex").oninput = e => { if(/^#[0-9a-f]{6}$/i.test(e.target.value)) $("#colorPicker").value=e.target.value; };
  }

  function editColor(c) {
    modalForm("编辑颜色", `
      <div class="field"><label>颜色名称</label><input id="colorName" type="text" value="${esc(c.name)}"></div>
      <div class="field"><label>HEX</label><input id="colorHex" type="text" value="${esc(c.hex)}"></div>
      <div class="field"><label>颜色预览</label><input id="colorPicker" type="color" value="${esc(c.hex)}"></div>
    `, async () => {
      const name=$("#colorName").value.trim();
      const hex=$("#colorHex").value.trim().toUpperCase();
      if(!/^#[0-9A-F]{6}$/.test(hex)) throw new Error("HEX 格式应为 #000000");
      await api(`/api/colors/${c.id}`,{method:"PATCH",body:JSON.stringify({name,hex})});
      toast("颜色已更新");
    });
    $("#colorPicker").oninput = e => $("#colorHex").value=e.target.value.toUpperCase();
    $("#colorHex").oninput = e => { if(/^#[0-9a-f]{6}$/i.test(e.target.value)) $("#colorPicker").value=e.target.value; };
  }

  async function deleteColor(c) {
    if(!confirm(`确定删除颜色“${c.name}” ${c.hex} 吗？\n此操作不可撤销。`)) return;
    try {
      await api(`/api/colors/${c.id}`,{method:"DELETE"});
      await load(); toast("颜色已删除");
    } catch(e) { toast(e.message); }
  }

  function settings() {
    openModal(`
      <div class="modal-head"><h2>设置</h2><button class="icon-btn" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <div class="setting-section">
          <h3>主题</h3>
          <p>支持亮色、暗色和跟随系统。</p>
          <div class="harmony-toggle">
            <button data-theme-choice="light">亮色</button>
            <button data-theme-choice="dark">暗色</button>
            <button data-theme-choice="system">跟随系统</button>
          </div>
        </div>
        <div class="setting-section">
          <h3>卡片大小</h3>
          <p>拖动滑块实时预览颜色卡片大小。</p>
          <div class="range-row">
            <input id="cardRange" type="range" min="220" max="420" step="10" value="${state.cardWidth}">
            <div class="range-value" id="cardRangeValue">${state.cardWidth}px</div>
          </div>
          <div class="setting-preview"><div class="preview-card" id="previewCard"></div></div>
        </div>
        <div class="setting-section">
          <h3>数据管理</h3>
          <p>数据保存在服务器 SQLite 数据库中。导入会覆盖当前数据。</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="secondary-btn" id="exportBtn">导出 JSON</button>
            <label class="secondary-btn import-label" for="fileInput">导入 JSON</label>
            <input id="fileInput" type="file" accept=".json,application/json">
            <button class="danger-btn" id="resetBtn">恢复默认数据</button>
          </div>
        </div>
        <div class="setting-section">
          <h3>OIDC / Casdoor</h3>
          <p>认证由服务器环境变量配置。当前状态：<b id="oidcStatus">读取中…</b></p>
        </div>
      </div>
    `);
    document.querySelectorAll("[data-theme-choice]").forEach(b => {
      b.onclick = () => { setTheme(b.dataset.themeChoice); };
    });
    const range=$("#cardRange"), val=$("#cardRangeValue"), preview=$("#previewCard");
    const updateRange=()=> {
      state.cardWidth=Number(range.value); val.textContent=`${state.cardWidth}px`;
      preview.style.setProperty("--preview-width",`${state.cardWidth}px`);
      document.documentElement.style.setProperty("--card-width",`${state.cardWidth}px`);
      localStorage.setItem("jokerx-card-width",state.cardWidth);
    };
    range.oninput=updateRange; updateRange();

    $("#exportBtn").onclick = async () => {
      const data=await api("/api/export");
      const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="jokerxcolor-backup.json";a.click();
      URL.revokeObjectURL(a.href); toast("已导出");
    };
    $("#fileInput").onchange = async e => {
      const file=e.target.files[0]; if(!file) return;
      if(!confirm("导入会覆盖当前所有分组和颜色，确定继续吗？")) return;
      try {
        const data=JSON.parse(await file.text());
        await api("/api/import",{method:"POST",body:JSON.stringify(data)});
        closeModal(); await load(); toast("导入成功");
      } catch(err) { toast("导入失败："+err.message); }
    };
    $("#resetBtn").onclick = async () => {
      if(!confirm("确定恢复默认数据吗？当前所有数据将被覆盖。")) return;
      await api("/api/reset",{method:"POST"});
      closeModal(); await load(); toast("已恢复默认数据");
    };
    api("/api/config").then(cfg => {
      $("#oidcStatus").textContent = cfg.oidc_enabled ? "已启用" : "未启用";
    });
  }

  $("#addGroupBtn").onclick=addGroup;
  $("#addColorBtn").onclick=addColor;
  $("#emptyAddBtn").onclick=addColor;
  $("#settingsBtn").onclick=settings;
  $("#themeBtn").onclick=cycleTheme;
  $("#modalBackdrop").onclick=e=>{ if(e.target===$("#modalBackdrop")) closeModal(); };

  setTheme(state.theme);
  load().catch(e => { if(e.message!=="login_required") toast(e.message); });
})();
