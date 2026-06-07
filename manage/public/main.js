let artData = [];
let currentEditIdx = -1;
let dirty = false;
let clipboard = null;
let contextMenuTargetIdx = -1;

const CATEGORY_MAP = {
  "personal-2d": { type: "personal", is3D: false },
  "personal-3d": { type: "personal", is3D: true },
  "professional-2d": { type: "professional", is3D: false },
  "professional-3d": { type: "professional", is3D: true },
};

const CATEGORY_KEYS = Object.keys(CATEGORY_MAP);

async function loadData() {
  const res = await fetch("/api/data");
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const parsed = await res.json();
  artData = parsed.artData || [];
  renderAll();
}

async function commitData() {
  const res = await fetch("/api/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artData }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function loadSettings() {
  const res = await fetch("/api/settings");
  if (!res.ok) return;
  const s = await res.json();
  document.getElementById("settingsRepo").value = s.repo || "";
  document.getElementById("settingsDataPath").value = s.dataPath || "";
  if (!s.hasToken) {
    openSettings();
    document.getElementById("settingsToken").focus();
  }
}

async function saveSettings() {
  const body = {
    githubToken: document.getElementById("settingsToken").value.trim(),
    repo: document.getElementById("settingsRepo").value.trim(),
    dataPath: document.getElementById("settingsDataPath").value.trim(),
  };
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to save settings");
}

function getCategory(entry) {
  const dim = entry.is3D ? "3d" : "2d";
  return `${entry.type || "personal"}-${dim}`;
}

function createCard(entry, idx) {
  const card = document.createElement("div");
  card.className = "card";
  card.draggable = true;
  card.dataset.idx = idx;

  const thumb = document.createElement("div");
  thumb.className = "card-thumb";
  if (entry.images && entry.images.length > 0) {
    const img = document.createElement("img");
    img.src = entry.images[0];
    img.alt = entry.title || "";
    img.loading = "lazy";
    thumb.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "thumb-placeholder";
    placeholder.textContent = "?";
    thumb.appendChild(placeholder);
  }

  const info = document.createElement("div");
  info.className = "card-info";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = entry.title || "(untitled)";

  const editBtn = document.createElement("button");
  editBtn.className = "card-edit-btn";
  editBtn.textContent = "Edit Details";
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEdit(idx);
  });

  info.appendChild(title);
  info.appendChild(editBtn);
  card.appendChild(thumb);
  card.appendChild(info);

  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, idx);
  });

  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = card.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    card.classList.toggle("dnd-before", before);
    card.classList.toggle("dnd-after", !before);
    card.closest(".column-body")?.classList.remove("drag-over");
  });

  card.addEventListener("dragleave", (e) => {
    if (card.contains(e.relatedTarget)) return;
    card.classList.remove("dnd-before", "dnd-after");
  });

  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", String(idx));
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    document.querySelectorAll(".column-body.drag-over").forEach((el) => el.classList.remove("drag-over"));
    document.querySelectorAll(".card.dnd-before, .card.dnd-after").forEach((el) => el.classList.remove("dnd-before", "dnd-after"));
  });

  return card;
}

function renderAll() {
  const containers = {};
  const counts = {};

  for (const key of CATEGORY_KEYS) {
    containers[key] = document.getElementById(`col-${key}`);
    counts[key] = 0;
  }

  Object.values(containers).forEach((el) => {
    if (el) el.innerHTML = "";
  });

  const groups = {};
  for (const key of CATEGORY_KEYS) groups[key] = [];

  for (let i = 0; i < artData.length; i++) {
    const entry = artData[i];
    const cat = CATEGORY_KEYS.includes(getCategory(entry)) ? getCategory(entry) : "personal-2d";
    groups[cat].push({ entry, idx: i });
  }

  for (const key of CATEGORY_KEYS) {
    const container = containers[key];
    if (!container) continue;
    for (const { entry, idx } of groups[key]) {
      container.appendChild(createCard(entry, idx));
    }
    counts[key] = groups[key].length;
  }

  for (const key of CATEGORY_KEYS) {
    const el = document.getElementById(`count-${key}`);
    if (el) el.textContent = counts[key];
  }
}

function setupColumns() {
  const bodies = document.querySelectorAll(".column-body");
  bodies.forEach((body) => {
    body.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      body.classList.add("drag-over");
    });

    body.addEventListener("dragleave", (e) => {
      if (body.contains(e.relatedTarget)) return;
      body.classList.remove("drag-over");
    });

    body.addEventListener("drop", (e) => {
      e.preventDefault();
      body.classList.remove("drag-over");
      document.querySelectorAll(".card.dnd-before, .card.dnd-after").forEach((el) => el.classList.remove("dnd-before", "dnd-after"));

      const srcIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (isNaN(srcIdx) || srcIdx < 0 || srcIdx >= artData.length) return;

      const column = body.closest(".column");
      if (!column) return;

      const category = column.dataset.category;
      const target = CATEGORY_MAP[category];
      if (!target) return;

      const entry = artData[srcIdx];
      const sameCategory = entry.type === target.type && entry.is3D === target.is3D;

      if (sameCategory) {
        const cardEl = e.target.closest(".card");
        let tgtIdx = -1;
        let before = true;
        if (cardEl) {
          tgtIdx = parseInt(cardEl.dataset.idx, 10);
          const rect = cardEl.getBoundingClientRect();
          before = e.clientY < rect.top + rect.height / 2;
        }

        if (tgtIdx === -1) {
          let lastIdx = -1;
          for (let i = 0; i < artData.length; i++) {
            if (artData[i].type === entry.type && artData[i].is3D === entry.is3D) {
              lastIdx = i;
            }
          }
          if (lastIdx === srcIdx) { renderAll(); return; }
          const [moved] = artData.splice(srcIdx, 1);
          const insertAt = lastIdx > srcIdx ? lastIdx - 1 : lastIdx;
          artData.splice(insertAt + 1, 0, moved);
        } else {
          if (srcIdx === tgtIdx) { renderAll(); return; }
          const [moved] = artData.splice(srcIdx, 1);
          let insertAt = tgtIdx;
          if (tgtIdx > srcIdx) insertAt = tgtIdx - 1;
          if (!before) insertAt = insertAt + 1;
          artData.splice(insertAt, 0, moved);
        }

        dirty = true;
        document.getElementById("saveBtn").disabled = false;
        renderAll();
        return;
      }

      entry.type = target.type;
      entry.is3D = target.is3D;
      dirty = true;
      document.getElementById("saveBtn").disabled = false;
      renderAll();
    });
  });
}

function createContextMenu() {
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "contextMenu";

  const actions = [
    { label: "Duplicate", action: "duplicate" },
    { label: "Delete", action: "delete" },
    { label: "Copy", action: "copy" },
    { label: "Paste", action: "paste" },
  ];

  actions.forEach(({ label, action }) => {
    const btn = document.createElement("button");
    btn.className = "context-menu-item";
    btn.dataset.action = action;
    btn.textContent = label;
    if (action === "paste") btn.classList.add("disabled");
    btn.addEventListener("click", () => handleContextAction(action));
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);

  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target)) menu.style.display = "none";
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") menu.style.display = "none";
  });
}

function showContextMenu(x, y, idx) {
  contextMenuTargetIdx = idx;
  const menu = document.getElementById("contextMenu");
  const pasteItem = menu.querySelector('[data-action="paste"]');
  pasteItem.classList.toggle("disabled", !clipboard);

  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.style.display = "block";

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 8) + "px";
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 8) + "px";
  }
}

function handleContextAction(action) {
  const menu = document.getElementById("contextMenu");
  menu.style.display = "none";

  const idx = contextMenuTargetIdx;
  if (idx < 0 || idx >= artData.length) return;

  switch (action) {
    case "duplicate": {
      const entry = artData[idx];
      artData.splice(idx + 1, 0, { ...entry });
      dirty = true;
      document.getElementById("saveBtn").disabled = false;
      renderAll();
      break;
    }
    case "delete": {
      artData.splice(idx, 1);
      dirty = true;
      document.getElementById("saveBtn").disabled = false;
      renderAll();
      break;
    }
    case "copy": {
      clipboard = { ...artData[idx] };
      break;
    }
    case "paste": {
      if (!clipboard) return;
      artData.splice(idx + 1, 0, { ...clipboard });
      dirty = true;
      document.getElementById("saveBtn").disabled = false;
      renderAll();
      break;
    }
  }
}

function openEdit(idx) {
  currentEditIdx = idx;
  const isNew = idx < 0 || idx >= artData.length;
  const entry = isNew ? null : artData[idx];

  document.getElementById("editPanelTitle").textContent = isNew ? "New Entry" : "Edit Details";

  const workTypeToggles = document.querySelectorAll("#editForm .toggle-group:first-of-type .toggle");
  const dimToggles = document.querySelectorAll("#editForm .toggle-group:last-of-type .toggle");

  if (isNew) {
    document.getElementById("editTitle").value = "";
    document.getElementById("editDescription").value = "";
    document.getElementById("editSourceLink").value = "";
    document.getElementById("editImages").value = "";
    document.getElementById("editIncludeEmbed").checked = false;
    document.getElementById("editEmbedCode").value = "";
    document.getElementById("editEmbedRow").style.display = "none";

    workTypeToggles.forEach((b) => b.classList.remove("active"));
    workTypeToggles[0].classList.add("active");
    dimToggles.forEach((b) => b.classList.remove("active"));
    dimToggles[0].classList.add("active");
  } else {
    document.getElementById("editTitle").value = entry.title || "";
    document.getElementById("editDescription").value = entry.description || "";
    document.getElementById("editSourceLink").value = entry.sourceLink || "";
    document.getElementById("editImages").value = (entry.images || []).join("\n");

    const hasEmbed = !!(entry.embed && entry.embed.trim());
    document.getElementById("editIncludeEmbed").checked = hasEmbed;
    document.getElementById("editEmbedCode").value = entry.embed || "";
    document.getElementById("editEmbedRow").style.display = hasEmbed ? "block" : "none";

    workTypeToggles.forEach((b) => {
      b.classList.toggle("active", b.dataset.value === entry.type);
    });
    dimToggles.forEach((b) => {
      b.classList.toggle("active", b.dataset.value === String(entry.is3D));
    });
  }

  document.getElementById("overlay").style.display = "flex";
}

function closeEdit() {
  document.getElementById("overlay").style.display = "none";
  currentEditIdx = -1;
}

function saveEdit() {
  const isNew = currentEditIdx < 0 || currentEditIdx >= artData.length;

  const activeType = document.querySelector("#editForm .toggle-group:first-of-type .toggle.active");
  const activeDim = document.querySelector("#editForm .toggle-group:last-of-type .toggle.active");
  const type = activeType ? activeType.dataset.value : "personal";
  const is3D = activeDim ? activeDim.dataset.value === "true" : false;

  const title = document.getElementById("editTitle").value.trim();
  const description = document.getElementById("editDescription").value.trim();
  const sourceLink = document.getElementById("editSourceLink").value.trim();
  const images = document
    .getElementById("editImages")
    .value.split(/\r?\n/)
    .filter((u) => u.trim())
    .map((u) => u.trim());

  const includeEmbed = document.getElementById("editIncludeEmbed").checked;
  const embedCode = document.getElementById("editEmbedCode").value;
  const embed = includeEmbed && embedCode.trim() ? embedCode : "";

  if (isNew) {
    artData.push({ type, is3D, title, description, sourceLink, images, embed });
  } else {
    const entry = artData[currentEditIdx];
    entry.type = type;
    entry.is3D = is3D;
    entry.title = title;
    entry.description = description;
    entry.sourceLink = sourceLink;
    entry.images = images;
    entry.embed = embed;
  }

  dirty = true;
  document.getElementById("saveBtn").disabled = false;
  closeEdit();
  renderAll();
}

function openSettings() {
  document.getElementById("settingsOverlay").style.display = "flex";
}

function closeSettings() {
  document.getElementById("settingsOverlay").style.display = "none";
}

async function init() {
  const status = document.getElementById("statusMsg");
  const saveBtn = document.getElementById("saveBtn");

  status.textContent = "Loading data from GitHub...";
  status.className = "status-msg";
  try {
    await loadData();
    status.textContent = `${artData.length} entries loaded`;
    status.className = "status-msg success";
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.className = "status-msg error";
  }

  setupColumns();
  createContextMenu();

  document.querySelectorAll("#editForm .toggle-group").forEach((group) => {
    const buttons = group.querySelectorAll(".toggle");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  });

  document.getElementById("addBtn").addEventListener("click", () => openEdit(-1));

  document.getElementById("overlayBg").addEventListener("click", closeEdit);
  document.getElementById("editCloseBtn").addEventListener("click", closeEdit);
  document.getElementById("editSaveBtn").addEventListener("click", saveEdit);

  document.getElementById("editIncludeEmbed").addEventListener("change", () => {
    const row = document.getElementById("editEmbedRow");
    row.style.display = document.getElementById("editIncludeEmbed").checked ? "block" : "none";
  });

  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("settingsOverlayBg").addEventListener("click", closeSettings);
  document.getElementById("settingsCloseBtn").addEventListener("click", closeSettings);
  document.getElementById("settingsSaveBtn").addEventListener("click", async () => {
    const btn = document.getElementById("settingsSaveBtn");
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      await saveSettings();
      closeSettings();
      status.textContent = "Settings saved — reloading data...";
      status.className = "status-msg";
      try {
        await loadData();
        status.textContent = `${artData.length} entries loaded`;
        status.className = "status-msg success";
      } catch (e) {
        status.textContent = `Error: ${e.message}`;
        status.className = "status-msg error";
      }
    } catch (e) {
      status.textContent = `Settings error: ${e.message}`;
      status.className = "status-msg error";
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (!dirty) return;
    saveBtn.disabled = true;
    status.textContent = "Committing to GitHub...";
    status.className = "status-msg";
    try {
      const result = await commitData();
      status.textContent = `Saved! SHA: ${result.sha.slice(0, 7)}`;
      status.className = "status-msg success";
      dirty = false;
    } catch (e) {
      status.textContent = `Error: ${e.message}`;
      status.className = "status-msg error";
      saveBtn.disabled = false;
    }
  });

  loadSettings();
}

document.addEventListener("DOMContentLoaded", init);
