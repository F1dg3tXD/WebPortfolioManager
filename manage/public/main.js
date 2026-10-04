let artData = [];
let currentEditIdx = -1;
let currentEditId = "";
let dirty = false;
let clipboard = null;
let contextMenuTargetIdx = -1;

const CATEGORY_MAP = {
  "personal-2d": { type: "personal", is3D: false, isAvatar: false },
  "personal-3d": { type: "personal", is3D: true, isAvatar: false },
  "personal-avatar": { type: "personal", is3D: false, isAvatar: true },
  "professional-2d": { type: "professional", is3D: false, isAvatar: false },
  "professional-3d": { type: "professional", is3D: true, isAvatar: false },
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
  if (entry.isAvatar) return "personal-avatar";
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
  const thumbSrc = entry.thumbnail || (entry.images && entry.images[0]);
  if (thumbSrc) {
    const img = document.createElement("img");
    img.src = thumbSrc;
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

  const tags = entry.tags || [];
  if (tags.length) {
    const tagRow = document.createElement("div");
    tagRow.className = "card-tags";
    tagRow.textContent = tags.slice(0, 3).join(", ");
    if (tags.length > 3) tagRow.textContent += "...";
    info.appendChild(tagRow);
  }

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
      const sameCategory = (entry.isAvatar === target.isAvatar) && entry.type === target.type && entry.is3D === target.is3D;

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
      entry.isAvatar = target.isAvatar || false;
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
    { label: null, action: "sep" },
    { label: "Send to Top", action: "send-top" },
    { label: "Send to Bottom", action: "send-bottom" },
  ];

  actions.forEach(({ label, action }) => {
    if (action === "sep") {
      const sep = document.createElement("div");
      sep.className = "context-menu-sep";
      menu.appendChild(sep);
      return;
    }
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

function moveWithinCategory(srcIdx, toTop) {
  const entry = artData[srcIdx];
  let cat = getCategory(entry);
  const sameCat = (e) => getCategory(e) === cat;

  let first = -1;
  let last = -1;
  for (let i = 0; i < artData.length; i++) {
    if (sameCat(artData[i])) {
      if (first === -1) first = i;
      last = i;
    }
  }

  if (first === -1 || (toTop && srcIdx === first) || (!toTop && srcIdx === last)) {
    renderAll();
    return;
  }

  const [moved] = artData.splice(srcIdx, 1);
  let insertAt;
  if (toTop) {
    insertAt = first > srcIdx ? first - 1 : first;
  } else {
    const tail = last > srcIdx ? last - 1 : last;
    insertAt = tail + 1;
  }
  artData.splice(insertAt, 0, moved);

  dirty = true;
  document.getElementById("saveBtn").disabled = false;
  renderAll();
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
    case "send-top": {
      moveWithinCategory(idx, true);
      break;
    }
    case "send-bottom": {
      moveWithinCategory(idx, false);
      break;
    }
  }
}

function openEdit(idx, prefill = null) {
  currentEditIdx = idx;
  const isNew = idx < 0 || idx >= artData.length;
  const entry = isNew ? null : artData[idx];
  currentEditId = isNew && prefill && prefill.id ? prefill.id : "";

  document.getElementById("editPanelTitle").textContent = isNew ? "New Entry" : "Edit Details";

  const workTypeToggles = document.querySelectorAll("#editForm .toggle-group:first-of-type .toggle");
  const dimToggles = document.querySelectorAll("#editForm .toggle-group:last-of-type .toggle");

  if (isNew) {
    document.getElementById("editTitle").value = "";
    document.getElementById("editDescription").value = "";
    document.getElementById("editTags").value = "";
    document.getElementById("editSourceLink").value = "";
    document.getElementById("editImages").value = "";
    document.getElementById("editThumbnail").value = "";
    document.getElementById("editCropX").value = "0";
    document.getElementById("editCropY").value = "0";
    document.getElementById("editCropW").value = "0";
    document.getElementById("editCropH").value = "0";
    document.getElementById("editIncludeEmbed").checked = false;
    document.getElementById("editEmbedCode").value = "";
    document.getElementById("editEmbedRow").style.display = "none";
    document.getElementById("editIsAvatarCheck").checked = false;

    workTypeToggles.forEach((b) => b.classList.remove("active"));
    workTypeToggles[0].classList.add("active");
    dimToggles.forEach((b) => b.classList.remove("active"));
    dimToggles[0].classList.add("active");

    if (prefill) {
      document.getElementById("editTitle").value = prefill.title || "";
      document.getElementById("editDescription").value = prefill.description || "";
      document.getElementById("editTags").value = (prefill.tags || []).join(", ");
      document.getElementById("editSourceLink").value = prefill.sourceLink || "";
      document.getElementById("editImages").value = (prefill.images || []).join("\n");
      document.getElementById("editThumbnail").value = prefill.thumbnail || "";
      document.getElementById("editIsAvatarCheck").checked = !!prefill.isAvatar;
      const hasEmbed = !!(prefill.embed && prefill.embed.trim());
      document.getElementById("editIncludeEmbed").checked = hasEmbed;
      document.getElementById("editEmbedCode").value = prefill.embed || "";
      document.getElementById("editEmbedRow").style.display = hasEmbed ? "block" : "none";
      workTypeToggles.forEach((b) => b.classList.toggle("active", b.dataset.value === (prefill.type || "personal")));
      dimToggles.forEach((b) => b.classList.toggle("active", b.dataset.value === String(!!prefill.is3D)));
    }
  } else {
    document.getElementById("editTitle").value = entry.title || "";
    document.getElementById("editDescription").value = entry.description || "";
    document.getElementById("editTags").value = (entry.tags || []).join(", ");
    document.getElementById("editSourceLink").value = entry.sourceLink || "";
    document.getElementById("editImages").value = (entry.images || []).join("\n");
    document.getElementById("editThumbnail").value = entry.thumbnail || "";

    const crop = entry.thumbnailCrop || {};
    document.getElementById("editCropX").value = crop.x ?? 0;
    document.getElementById("editCropY").value = crop.y ?? 0;
    document.getElementById("editCropW").value = crop.width ?? 0;
    document.getElementById("editCropH").value = crop.height ?? 0;

    const hasEmbed = !!(entry.embed && entry.embed.trim());
    document.getElementById("editIncludeEmbed").checked = hasEmbed;
    document.getElementById("editEmbedCode").value = entry.embed || "";
    document.getElementById("editEmbedRow").style.display = hasEmbed ? "block" : "none";
    document.getElementById("editIsAvatarCheck").checked = !!entry.isAvatar;

    workTypeToggles.forEach((b) => {
      b.classList.toggle("active", b.dataset.value === entry.type);
    });
    dimToggles.forEach((b) => {
      b.classList.toggle("active", b.dataset.value === String(entry.is3D));
    });
  }

  document.getElementById("overlay").style.display = "flex";
  loadCropPreview();
}

function closeEdit() {
  document.getElementById("overlay").style.display = "none";
  currentEditIdx = -1;
  cropDrag = null;
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

  const thumbnail = document.getElementById("editThumbnail").value.trim();
  const cx = parseInt(document.getElementById("editCropX").value, 10);
  const cy = parseInt(document.getElementById("editCropY").value, 10);
  const cw = parseInt(document.getElementById("editCropW").value, 10);
  const ch = parseInt(document.getElementById("editCropH").value, 10);
  const hasCrop = !!(cx || cy || cw || ch);
  const thumbnailCrop = hasCrop ? { x: cx, y: cy, width: cw, height: ch } : null;

  const isAvatar = document.getElementById("editIsAvatarCheck").checked;

  const tags = document.getElementById("editTags").value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t);

  if (isNew) {
    artData.push({ id: currentEditId || undefined, type, is3D, isAvatar, title, description, tags, sourceLink, images, embed, thumbnail, thumbnailCrop });
  } else {
    const entry = artData[currentEditIdx];
    entry.type = type;
    entry.is3D = is3D;
    entry.isAvatar = isAvatar;
    entry.title = title;
    entry.description = description;
    entry.tags = tags;
    entry.sourceLink = sourceLink;
    entry.images = images;
    entry.embed = embed;
    entry.thumbnail = thumbnail || "";
    entry.thumbnailCrop = thumbnailCrop;
  }

  dirty = true;
  document.getElementById("saveBtn").disabled = false;
  closeEdit();
  renderAll();
}

let cropDrag = null;

function initCropInteraction() {
  const preview = document.getElementById("cropPreview");
  const box = document.getElementById("cropBox");

  preview.addEventListener("dragstart", (e) => e.preventDefault());

  box.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const handle = e.target.closest(".crop-handle");
    if (handle) {
      const cls = Array.from(handle.classList).find((c) => c.startsWith("crop-handle-"));
      startCropDrag(e, cls.replace("crop-handle-", ""));
    } else {
      startCropDrag(e, "move");
    }
    e.preventDefault();
  });

  document.addEventListener("mousemove", doCropDrag);
  document.addEventListener("mouseup", endCropDrag);

  ["editCropX", "editCropY", "editCropW", "editCropH"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      if (!cropDrag) syncBoxToInputs();
    });
  });

  document.getElementById("editThumbnail").addEventListener("input", loadCropPreview);
}

function loadCropPreview() {
  const url = document.getElementById("editThumbnail").value.trim();
  const preview = document.getElementById("cropPreview");
  const img = document.getElementById("cropPreviewImg");

  if (!url) {
    preview.style.display = "none";
    return;
  }

  img.src = url;
  img.onload = () => {
    preview.style.display = "block";
    const hasCrop =
      parseInt(document.getElementById("editCropX").value) ||
      parseInt(document.getElementById("editCropY").value) ||
      parseInt(document.getElementById("editCropW").value) ||
      parseInt(document.getElementById("editCropH").value);
    if (!hasCrop) {
      const dw = img.offsetWidth;
      const dh = img.offsetHeight;
      const cw = Math.round(dw * 0.5);
      const ch = Math.round(dh * 0.5);
      const cx = Math.round((dw - cw) / 2);
      const cy = Math.round((dh - ch) / 2);
      const scale = img.naturalWidth / dw;
      document.getElementById("editCropX").value = Math.round(cx * scale);
      document.getElementById("editCropY").value = Math.round(cy * scale);
      document.getElementById("editCropW").value = Math.round(cw * scale);
      document.getElementById("editCropH").value = Math.round(ch * scale);
    }
    syncBoxToInputs();
  };
  img.onerror = () => {
    preview.style.display = "none";
  };
}

function getDisplayScale() {
  const img = document.getElementById("cropPreviewImg");
  if (!img.complete || !img.naturalWidth) return 1;
  return img.naturalWidth / (img.offsetWidth || 1);
}

function syncBoxToInputs() {
  const box = document.getElementById("cropBox");
  const scale = getDisplayScale();
  const ox = parseInt(document.getElementById("editCropX").value) || 0;
  const oy = parseInt(document.getElementById("editCropY").value) || 0;
  const ow = parseInt(document.getElementById("editCropW").value) || 0;
  const oh = parseInt(document.getElementById("editCropH").value) || 0;

  box.style.left = ox / scale + "px";
  box.style.top = oy / scale + "px";
  box.style.width = ow / scale + "px";
  box.style.height = oh / scale + "px";
}

function syncInputsToBox() {
  const box = document.getElementById("cropBox");
  const scale = getDisplayScale();
  const left = parseFloat(box.style.left) || 0;
  const top = parseFloat(box.style.top) || 0;
  const w = parseFloat(box.style.width) || 0;
  const h = parseFloat(box.style.height) || 0;

  document.getElementById("editCropX").value = Math.round(left * scale);
  document.getElementById("editCropY").value = Math.round(top * scale);
  document.getElementById("editCropW").value = Math.round(w * scale);
  document.getElementById("editCropH").value = Math.round(h * scale);
}

function startCropDrag(e, mode) {
  const box = document.getElementById("cropBox");
  const img = document.getElementById("cropPreviewImg");
  cropDrag = {
    mode,
    startX: e.clientX,
    startY: e.clientY,
    startLeft: parseFloat(box.style.left) || 0,
    startTop: parseFloat(box.style.top) || 0,
    startW: parseFloat(box.style.width) || 0,
    startH: parseFloat(box.style.height) || 0,
    maxW: img.offsetWidth || 1,
    maxH: img.offsetHeight || 1,
  };
}

function doCropDrag(e) {
  if (!cropDrag) return;
  const { mode, startX, startY, startLeft, startTop, startW, startH, maxW, maxH } = cropDrag;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  const box = document.getElementById("cropBox");
  const MIN = 20;

  let left = startLeft;
  let top = startTop;
  let w = startW;
  let h = startH;

  if (mode === "move") {
    left = Math.max(0, Math.min(startLeft + dx, maxW - w));
    top = Math.max(0, Math.min(startTop + dy, maxH - h));
  } else {
    if (mode.includes("e")) w = Math.max(MIN, startW + dx);
    if (mode.includes("w")) {
      w = Math.max(MIN, startW - dx);
      left = startLeft + startW - w;
    }
    if (mode.includes("s")) h = Math.max(MIN, startH + dy);
    if (mode.includes("n")) {
      h = Math.max(MIN, startH - dy);
      top = startTop + startH - h;
    }
    if (left < 0) { w += left; left = 0; }
    if (top < 0) { h += top; top = 0; }
    if (left + w > maxW) w = maxW - left;
    if (top + h > maxH) h = maxH - top;
    w = Math.max(MIN, w);
    h = Math.max(MIN, h);
  }

  box.style.left = left + "px";
  box.style.top = top + "px";
  box.style.width = w + "px";
  box.style.height = h + "px";
  syncInputsToBox();
}

function endCropDrag() {
  cropDrag = null;
}

function openSettings() {
  document.getElementById("settingsOverlay").style.display = "flex";
}

function closeSettings() {
  document.getElementById("settingsOverlay").style.display = "none";
}

function openArtstationOverlay() {
  document.getElementById("asUrlInput").value = "";
  const statusEl = document.getElementById("asStatus");
  statusEl.textContent = "";
  statusEl.className = "status-msg";
  document.getElementById("artstationOverlay").style.display = "flex";
  document.getElementById("asUrlInput").focus();
}

function closeArtstationOverlay() {
  document.getElementById("artstationOverlay").style.display = "none";
}

function openJsonOverlay() {
  document.getElementById("jsonUrlInput").value = "";
  document.getElementById("jsonFileInput").value = "";
  document.getElementById("jsonFileName").textContent = "No file selected";
  const statusEl = document.getElementById("jsonStatus");
  statusEl.textContent = "";
  statusEl.className = "status-msg";
  document.getElementById("jsonOverlay").style.display = "flex";
  document.getElementById("jsonUrlInput").focus();
}

function closeJsonOverlay() {
  document.getElementById("jsonOverlay").style.display = "none";
}

let siteConfig = null;
let siteConfigSha = null;

async function loadSiteConfig() {
  const res = await fetch("/api/siteconfig");
  if (!res.ok) return;
  const result = await res.json();
  siteConfig = result.data || {};
  siteConfigSha = result.sha || null;
}

function openSiteConfig() {
  const p = (siteConfig && siteConfig.personal) || {};
  document.getElementById("scBio").value = (p.bio || "").replace(/<br\s*\/?>/gi, "\n");
  document.getElementById("scCommissionLink").value = p.commissionLink || "";
  document.getElementById("scSocials").value = Object.entries(p.socials || {})
    .map(([k, v]) => `${k}: ${v}`).join("\n");
  document.getElementById("scLinks").value = (p.links || [])
    .map(l => `${l.label}: ${l.url}`).join("\n");
  document.getElementById("scFooter").value = (p.footerContacts || [])
    .map(c => `${c.label}: ${c.url}`).join("\n");

  document.getElementById("scPfpImage").value = (siteConfig && siteConfig.site && siteConfig.site.pfpImage) || "";
  document.getElementById("scAboutImage").value = (siteConfig && siteConfig.about && siteConfig.about.image) || "";

  const sp = (siteConfig && siteConfig.socialsPage) || {};
  document.getElementById("scSocialsIcons").value = (sp.icons || [])
    .map(c => `${c.name}: ${c.url}`).join("\n");
  document.getElementById("scSocialsGrid").value = (sp.grid || [])
    .map(c => `${c.name}: ${c.url}`).join("\n");
  document.getElementById("scSocialImage").value = sp.socialImage || "";
  document.getElementById("scSocialsFooter").value = (sp.footerContacts || [])
    .map(c => `${c.label}: ${c.url}`).join("\n");

  document.getElementById("siteConfigOverlay").style.display = "flex";
}

function closeSiteConfig() {
  document.getElementById("siteConfigOverlay").style.display = "none";
}

async function saveSiteConfig() {
  const rawSocials = document.getElementById("scSocials").value.split("\n").filter(l => l.trim());
  const socials = {};
  for (const line of rawSocials) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    socials[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  const rawLinks = document.getElementById("scLinks").value.split("\n").filter(l => l.trim());
  const links = rawLinks.map(line => {
    const idx = line.indexOf(":");
    return idx === -1 ? null : { label: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() };
  }).filter(Boolean);

  const rawFooter = document.getElementById("scFooter").value.split("\n").filter(l => l.trim());
  const footerContacts = rawFooter.map(line => {
    const idx = line.indexOf(":");
    return idx === -1 ? null : { label: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() };
  }).filter(Boolean);

  const rawSocialsIcons = document.getElementById("scSocialsIcons").value.split("\n").filter(l => l.trim());
  const socialsIcons = rawSocialsIcons.map(line => {
    const idx = line.indexOf(":");
    return idx === -1 ? null : { name: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() };
  }).filter(Boolean);

  const rawSocialsGrid = document.getElementById("scSocialsGrid").value.split("\n").filter(l => l.trim());
  const socialsGrid = rawSocialsGrid.map(line => {
    const idx = line.indexOf(":");
    return idx === -1 ? null : { name: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() };
  }).filter(Boolean);

  const rawSocialsFooter = document.getElementById("scSocialsFooter").value.split("\n").filter(l => l.trim());
  const socialsFooterContacts = rawSocialsFooter.map(line => {
    const idx = line.indexOf(":");
    return idx === -1 ? null : { label: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() };
  }).filter(Boolean);

  const data = {
    personal: {
      bio: document.getElementById("scBio").value.trim(),
      commissionLink: document.getElementById("scCommissionLink").value.trim(),
      socials,
      links,
      footerContacts,
    },
    about: {
      image: document.getElementById("scAboutImage").value.trim() || "/personal/pfp.png",
    },
    socialsPage: {
      icons: socialsIcons,
      grid: socialsGrid,
      socialImage: document.getElementById("scSocialImage").value.trim() || "",
      footerContacts: socialsFooterContacts,
    },
    site: {
      pfpImage: document.getElementById("scPfpImage").value.trim() || "/personal/pfp.png",
    },
    professional: (siteConfig && siteConfig.professional) || { bio: "", contacts: [] },
  };

  const res = await fetch("/api/siteconfig", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, sha: siteConfigSha }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const result = await res.json();
  siteConfigSha = result.sha;
  siteConfig = data;
}

// ── Style tab ──

let styleBlocks = [];
let styleSha = null;
let styleDirty = false;
let styleElements = null;

// Style undo history. Each entry reverts a single variable change:
// { block, prop, before, after, hadDecl, created }. Drags and color-wheel
// interactions are coalesced into ONE entry via a transaction, so undoing a
// color change goes straight back to the color before the drag started.
let styleUndoStack = [];
let styleUndoActive = false;
let styleUndoPending = null;

function switchTab(name) {
  document.querySelectorAll(".app-tab").forEach((t) => {
    t.classList.toggle("app-tab--active", t.dataset.tab === name);
  });
  document.getElementById("panel-artdata").classList.toggle("tab-panel--active", name === "artdata");
  document.getElementById("panel-style").classList.toggle("tab-panel--active", name === "style");
  document.getElementById("panel-background").classList.toggle("tab-panel--active", name === "background");
  document.getElementById("panel-mobile").classList.toggle("tab-panel--active", name === "mobile");
  if (name === "background") ensureBgInit();
  if (name === "mobile") renderMobileTab();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function parseCSS(css) {
  const blocks = [];
  let buffer = "";
  let i = 0;
  const n = css.length;

  const flushBuffer = () => {
    const t = buffer;
    buffer = "";
    if (t.trim()) {
      blocks.push({ type: "comment", raw: t });
    }
  };

  while (i < n) {
    const ch = css[i];

    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) { buffer += css.slice(i); break; }
      buffer += css.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const q = ch;
      let j = i + 1;
      while (j < n && css[j] !== q) {
        if (css[j] === "\\") j++;
        j++;
      }
      buffer += css.slice(i, Math.min(j + 1, n));
      i = Math.min(j + 1, n);
      continue;
    }

    if (ch === "{") {
      const prelude = buffer;
      buffer = "";

      const comments = [];
      const parts = [];
      const re = /\/\*[\s\S]*?\*\//g;
      let m;
      let last = 0;
      while ((m = re.exec(prelude))) {
        if (m.index > last) parts.push(prelude.slice(last, m.index));
        comments.push(m[0]);
        last = m.index + m[0].length;
      }
      if (last < prelude.length) parts.push(prelude.slice(last));
      for (const c of comments) blocks.push({ type: "comment", raw: c });
      const selectorText = parts.join(" ");

      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        const c = css[j];
        if (c === "/" && css[j + 1] === "*") {
          j = css.indexOf("*/", j + 2);
          if (j === -1) break;
          j += 2;
          continue;
        }
        if (c === "'" || c === '"') {
          const q = c;
          j++;
          while (j < n && css[j] !== q) {
            if (css[j] === "\\") j++;
            j++;
          }
          j++;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        if (depth > 0) j++;
      }
      const end = Math.min(j, n);
      const body = css.slice(i + 1, end);
      const preludeTrim = selectorText.trim();
      if (preludeTrim.startsWith("@")) {
        blocks.push({ type: "atrule", prelude: preludeTrim, inner: body, raw: selectorText + "{" + body + "}", edited: false });
      } else if (preludeTrim) {
        blocks.push({ type: "rule", prelude: preludeTrim, inner: body, raw: selectorText + "{" + body + "}", edited: false });
      }
      i = end + 1;
      continue;
    }

    buffer += ch;
    i++;
  }
  flushBuffer();
  return blocks;
}

function generateCSS(blocks) {
  const parts = [];
  for (const b of blocks) {
    const p = b.edited ? `${b.prelude} {\n${b.inner.trim()}\n}` : b.raw.trim();
    if (!p) continue;
    if (/^[\s\u00a0]*}\s*$/.test(p)) continue; // stray closing brace from source CSS — would invalidate everything after it
    parts.push(p);
  }
  return parts.join("\n\n") + "\n";
}

function selectorTokens(selector) {
  const classes = new Set();
  const ids = new Set();
  const tags = new Set();
  const m1 = selector.match(/\.[A-Za-z_][A-Za-z0-9_-]*/g);
  if (m1) m1.forEach((t) => classes.add(t));
  const m2 = selector.match(/#[A-Za-z_][A-Za-z0-9_-]*/g);
  if (m2) m2.forEach((t) => ids.add(t));
  const m3 = selector.match(/(?:^|[\s>+~,(])([a-zA-Z][a-zA-Z0-9-]*)/g);
  if (m3) m3.forEach((t) => tags.add(t.replace(/^[\s>+~,(]/, "")));
  return { classes, ids, tags };
}

function ruleMatchesElement(block, element) {
  if (block.type !== "rule") return false;
  const { classes, ids, tags } = selectorTokens(block.prelude);
  if (element.startsWith(".")) return classes.has(element);
  if (element.startsWith("#")) return ids.has(element);
  return tags.has(element);
}

// ── Per-page style scoping ──
// Styling can be unique per page. A rule whose selector begins with
// body[data-page="game-art"] ... only applies inside the Game Art page, so
// the same class (e.g. .root-wrap) can look different on different pages.
const PAGES = [
  { key: "home", path: "home/index.html", label: "Home" },
  { key: "about", path: "about/index.html", label: "About" },
  { key: "personal", path: "personal/index.html", label: "Personal" },
  { key: "game-art", path: "game-art/index.html", label: "Game Art" },
];

let editScopePref = "page"; // "page" = this page only | "all" = all pages

// Element states you can style separately. The "state" selector at the top of
// the inspector picks which one the visual controls edit, e.g. a :hover rule
// that only applies while the pointer is over the element.
const ELEMENT_STATES = [
  { key: "normal", label: "Normal", pseudo: "" },
  { key: "hover", label: "Hover", pseudo: ":hover" },
  { key: "active", label: "Active", pseudo: ":active" },
  { key: "focus", label: "Focus", pseudo: ":focus" },
];

let editStatePref = "normal";

function statePseudoOf(key) {
  const s = ELEMENT_STATES.find((x) => x.key === key);
  return s ? s.pseudo : "";
}

function editStateNow() {
  const el = document.getElementById("editState");
  return el && el.value ? el.value : "normal";
}

// Pseudo-state a rule is scoped to ("", ":hover", ":active", ":focus").
function stateSuffixOf(block) {
  if (!block || block.type !== "rule") return "";
  const m = /(:hover|:active|:focus|:visited)(?=[\s,]|$)/.exec((block.prelude || "").trim());
  return m ? m[1] : "";
}

function currentPageKey() {
  const sel = document.getElementById("previewPage");
  const path = (sel && sel.value) || "home/index.html";
  const page = PAGES.find((p) => p.path === path);
  return page ? page.key : "";
}

function currentPageLabel() {
  const page = PAGES.find((p) => p.key === currentPageKey());
  return page ? page.label : "";
}

function pageScopeOfRule(block) {
  if (!block || block.type !== "rule") return "";
  const m = /\[data-page=(["'])([a-z0-9-]+)\1\]/i.exec(block.prelude || "");
  return m ? m[2] : "";
}

function isScopedRule(block) {
  return !!pageScopeOfRule(block);
}

function pageSelector(pageKey, sel) {
  return `body[data-page="${pageKey}"] ${sel}`;
}

function scopedSelector(sel) {
  const key = currentPageKey();
  return key ? pageSelector(key, sel) : sel;
}

function editScopeNow() {
  const el = document.getElementById("editScope");
  return el ? el.value : "page";
}

// ── CSS declarations model ──
// Rules are kept as prelude + inner text. For visual editing we additionally
// parse `inner` into declaration items so a control can read/modify a single
// property without touching the rest of the rule body.

function parseDecls(inner) {
  const items = [];
  for (const raw of String(inner || "").split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    const m = /^([a-zA-Z-]+)\s*:\s*(.+?);?\s*$/.exec(t);
    if (m) items.push({ kind: "decl", prop: m[1].toLowerCase(), value: m[2].trim().replace(/;+$/, ""), raw });
    else items.push({ kind: "other", raw });
  }
  return items;
}

function serializeDecls(items) {
  if (!items || !items.length) return "";
  let out = "";
  for (const it of items) {
    if (it.kind === "decl") out += `  ${it.prop}: ${it.value};\n`;
    else if (it.raw) out += `  ${it.raw}\n`;
  }
  return "\n" + out;
}

function declsOf(block) {
  if (!block.decls) block.decls = parseDecls(block.inner);
  return block.decls;
}

function getBlockProp(block, prop) {
  const d = declsOf(block).find((i) => i.kind === "decl" && i.prop === prop);
  return d ? d.value : null;
}

function setBlockProp(block, prop, value) {
  const decls = declsOf(block);
  const found = decls.find((i) => i.kind === "decl" && i.prop === prop);
  if (found) {
    found.value = value;
    found.raw = `${prop}: ${value};`;
  } else {
    decls.push({ kind: "decl", prop, value, raw: `${prop}: ${value};` });
  }
  block.inner = serializeDecls(decls);
  block.edited = true;
}

async function loadStyle() {
  const res = await fetch("/api/style");
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  styleSha = data.sha;
  clearStyleUndo();
  styleBlocks = parseCSS(data.content || "");
  const beforeClean = styleBlocks.length;
  styleBlocks = styleBlocks.filter((b) => !/(\.si-(?:hover|selected))(?![\w-])/.test(b.prelude || ""));
  if (styleBlocks.length !== beforeClean) styleDirty = true;
  try {
    await loadStyleElements();
  } catch (e) {
    console.warn("Could not scan site elements:", e);
  }
  renderStyleList();
  updateStyleSave();
}

async function loadStyleElements() {
  const res = await fetch("/api/style/elements");
  if (!res.ok) return;
  styleElements = await res.json();
}

function getStyleElements() {
  if (!styleElements) return [];
  return [...(styleElements.classes || []), ...(styleElements.ids || []), ...(styleElements.tags || [])];
}

function createRuleItem(b) {
  const item = document.createElement("div");
  item.className = "style-rule";
  const head = document.createElement("div");
  head.className = "style-rule-head";
  const label = document.createElement("div");
  label.className = "style-rule-prelude";
  label.textContent = b.prelude;
  label.title = b.prelude;
  head.appendChild(label);
  const scopedPage = pageScopeOfRule(b);
  if (scopedPage) {
    const badge = document.createElement("span");
    badge.className = "style-rule-page";
    const pg = PAGES.find((p) => p.key === scopedPage);
    badge.textContent = pg ? `${pg.label} only` : scopedPage;
    head.appendChild(badge);
  }
  const del = document.createElement("button");
  del.className = "style-rule-del";
  del.textContent = "Delete";
  del.title = "Remove this rule from style.css (restoreable via Undo)";
  del.addEventListener("click", () => removeStyleBlock(b, null));
  head.appendChild(del);
  item.appendChild(head);
  const ta = document.createElement("textarea");
  ta.className = "text-input style-rule-input";
  ta.spellcheck = false;
  ta.value = b.inner.replace(/^\n+/, "").replace(/\n+\s*$/, "");
  ta.addEventListener("input", () => {
    b.edited = true;
    b.inner = "\n" + ta.value + "\n";
    b.decls = parseDecls(b.inner);
    styleDirty = true;
    updateStyleSave();
  });
  item.appendChild(ta);
  return item;
}

function createElementRow(m) {
  const row = document.createElement("div");
  row.className = "style-element";

  const head = document.createElement("button");
  head.className = "style-element-head";
  head.innerHTML = `<span class="style-sel">${escapeHtml(m.element)}</span><span class="style-count">${m.rules.length}</span>`;
  head.addEventListener("click", () => row.classList.toggle("open"));
  row.appendChild(head);

  const body = document.createElement("div");
  body.className = "style-element-body";

  if (m.rules.length) {
    for (const b of m.rules) body.appendChild(createRuleItem(b));
  } else {
    const note = document.createElement("div");
    note.className = "style-note";
    note.textContent = "No rules in style.css for this element.";
    body.appendChild(note);
    const addBtn = document.createElement("button");
    addBtn.className = "secondary-btn style-add-btn";
    addBtn.textContent = "Add rule";
    addBtn.addEventListener("click", () => {
      styleBlocks.push({
        type: "rule",
        prelude: m.element,
        inner: "\n  /* style " + m.element + " */\n",
        raw: "",
        edited: true,
      });
      styleDirty = true;
      updateStyleSave();
      renderStyleList();
      row.classList.add("open");
    });
    body.appendChild(addBtn);
  }

  row.appendChild(body);
  return row;
}

function renderStyleList() {
  const list = document.getElementById("styleList");
  list.innerHTML = "";
  const filter = document.getElementById("styleFilter").value.trim().toLowerCase();
  const pageFilter = document.getElementById("stylePageFilter") ? document.getElementById("stylePageFilter").value : "";
  const elements = getStyleElements();

  const ruleVisible = (b) => !pageFilter || !isScopedRule(b) || pageScopeOfRule(b) === pageFilter;

  const matchedSet = new Set();
  const matched = [];
  for (const element of elements) {
    const rules = styleBlocks.filter((b) => ruleMatchesElement(b, element) && ruleVisible(b));
    rules.forEach((b) => matchedSet.add(b));
    matched.push({ element, rules });
  }

  const isUniversalRule = (b) => {
    if (b.type !== "rule") return false;
    return b.prelude.replace(/\s+/g, "").split(",").every((s) => s === "*" || s === "*::before" || s === "*::after");
  };
  const others = styleBlocks.filter((b) => !matchedSet.has(b) && !isUniversalRule(b) && (b.type === "atrule" || b.type === "rule") && ruleVisible(b));

  const filtered = matched.filter((m) => !filter || m.element.toLowerCase().includes(filter));

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "style-note";
    empty.textContent = "No matching elements.";
    list.appendChild(empty);
  }

  for (const m of filtered) list.appendChild(createElementRow(m));

  const filteredOthers = others.filter((b) => !filter || b.prelude.toLowerCase().includes(filter));
  if (filteredOthers.length) {
    const row = document.createElement("div");
    row.className = "style-element";
    const head = document.createElement("button");
    head.className = "style-element-head";
    head.innerHTML = `<span class="style-sel">Other blocks</span><span class="style-count">${filteredOthers.length}</span>`;
    head.addEventListener("click", () => row.classList.toggle("open"));
    row.appendChild(head);
    const body = document.createElement("div");
    body.className = "style-element-body";
    for (const b of filteredOthers) body.appendChild(createRuleItem(b));
    row.appendChild(body);
    list.appendChild(row);
  }
}

function updateStyleSave() {
  document.getElementById("styleSaveBtn").disabled = !(styleDirty || pendingImageUploads.length);
}

async function saveStyle() {
  const btn = document.getElementById("styleSaveBtn");
  const status = document.getElementById("styleStatus");
  btn.disabled = true;
  const pushing = [];
  if (styleDirty) pushing.push("style.css");
  if (pendingImageUploads.length) pushing.push(`${pendingImageUploads.length} file${pendingImageUploads.length === 1 ? "" : "s"}`);
  status.textContent = `Pushing ${pushing.join(" + ")} to GitHub...`;
  status.className = "status-msg";
  try {
    if (styleDirty) {
      const content = generateCSS(styleBlocks);
      const res = await fetch("/api/style", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, sha: styleSha }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      styleSha = result.sha;
      styleDirty = false;
      styleBlocks.forEach((b) => { b.edited = false; });
      renderStyleList();
    }
    if (pendingImageUploads.length) {
      const res = await fetch("/api/upload", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: pendingImageUploads, message: "Replace images from manage page" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      pendingImageUploads.length = 0;
      status.textContent = `Saved ${result.files.length} file${result.files.length === 1 ? "" : "s"}!`;
      status.className = "status-msg success";
    } else {
      status.textContent = `style.css saved! SHA: ${styleSha ? styleSha.slice(0, 7) : "?"}`;
      status.className = "status-msg success";
    }
    updateStyleSave();
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.className = "status-msg error";
    updateStyleSave();
  }
}

// ── Style tab: preview, inspector, paste ──

let inspected = null;
let pastedElements = [];
let selectedPreviewEl = null;
let inspectedElRef = null;
let showStyleValues = false;
let styleMotionEnabled = false;
let pendingImageUploads = [];
const visualControls = [];
let colorPopoverCb = null;
let colorWheelH = 0;
let colorWheelS = 0;
let colorWheelV = 1;
let colorWheelA = 1;

function getPreviewDoc() {
  const frame = document.getElementById("sitePreview");
  return frame && frame.contentDocument ? frame.contentDocument : null;
}

// ── Color helpers (CSS strings ↔ rgb/hsl) ──

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function toHex(c) {
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + ch(c.r) + ch(c.g) + ch(c.b);
}

function cssColorStr(c) {
  const a = c.a === undefined ? 1 : c.a;
  return a >= 1 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(a * 100) / 100})`;
}

function parseCssColor(str) {
  if (!str) return null;
  str = String(str).trim();
  if (!str || str === "none") return null;
  if (str === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (str.startsWith("#")) {
    let h = str.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  let m = /^rgba?\(\s*([\d.]+)\s*[, ]+\s*([\d.]+)\s*[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(str);
  if (m) {
    const a = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[4].trim().endsWith("%") ? 100 : 1);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  m = /^hsla?\(\s*([\d.]+)\s*[, ]+\s*([\d.]+)%\s*[, ]+\s*([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(str);
  if (m) {
    const { r, g, b } = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
    const a = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[4].trim().endsWith("%") ? 100 : 1);
    return { r, g, b, a };
  }
  return null;
}

function parseShadow(str) {
  str = String(str || "").trim();
  if (!str || str === "none") return null;
  const lengths = [];
  const lenRe = /-?[\d.]+px/g;
  let m;
  while ((m = lenRe.exec(str)) && lengths.length < 4) lengths.push(parseFloat(m[0]));
  let color = "rgba(0, 0, 0, 0.35)";
  const parts = str.split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const c = parseCssColor(parts.slice(i).join(" "));
    if (c) { color = cssColorStr(c); break; }
  }
  return { x: lengths[0] || 0, y: lengths[1] || 0, blur: lengths[2] || 0, color };
}

function numValue(raw, fallback) {
  const n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}

// ── Icons (inline SVG, currentColor) ──

const ICONS = {
  text: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 20l6-15h4l6 15h-3.2l-1.2-3H8.4l-1.2 3H4zm5.2-6h5.6l-2.8-7z" fill="currentColor"/></svg>',
  bg: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="8" r="1.6" fill="currentColor"/></svg>',
  border: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  fsize: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 4v14M3 7h12M3 13h12M13 9l4-3 4 3M17 6v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fweight: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 4h6.5a3.5 3.5 0 010 7H7zm0 7h7.5a3.5 3.5 0 010 7H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  lspace: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 20V4M12 4L9 7M12 4l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lheight: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 4l-3 3M12 4l3 3M12 20l-3-3M12 20l3-3M5 6h14M5 18h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  radius: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 4h-4a2 2 0 00-2 2v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  bwidth: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="8.5" y="8.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  opacity: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 000 16z" fill="currentColor"/></svg>',
  shadow: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="5" y="7" width="12" height="12" rx="2" fill="rgba(255,255,255,.35)" stroke="currentColor" stroke-width="1"/><rect x="3" y="3" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  tshadow: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 17l5-11h3l5 11h-2.7l-1-2.4H7.7l-1 2.4H4zm3.4-4.8h5.2l-2.6-6z" fill="rgba(255,255,255,.35)"/><path d="M7 20l5-11h3l5 11h-2.7l-1-2.4h-5.6l-1 2.4H7zm3.4-4.8h5.2l-2.6-6z" fill="currentColor"/></svg>',
  alignLeft: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 5h16M4 10h16M4 15h10M4 20h13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  alignCenter: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 5h16M4 10h16M7 15h10M4 20h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  alignRight: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 5h16M4 10h16M10 15h10M7 20h13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  alignJustify: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 5h16M4 10h16M4 15h16M4 20h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  img: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="10" r="2" fill="currentColor"/><path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  glow: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" fill="currentColor"/><path d="M18 15l.9 2.6L21 18.5l-2.1.9L18 22l-.9-2.6-2.1-.9 2.1-.9L18 15z" fill="currentColor" opacity=".55"/></svg>',
};

function elementData(el) {
  const tag = el.tagName ? el.tagName.toLowerCase() : "element";
  const id = el.id || "";
  const classes =
    el.classList && typeof el.classList.contains === "function"
      ? Array.from(el.classList).filter((c) => !/^si-/.test(c))
      : el.className && typeof el.className === "string"
        ? el.className.trim().split(/\s+/).filter(Boolean).filter((c) => !/^si-/.test(c))
        : [];
  const primary = id ? `#${id}` : classes[0] ? `.${classes[0]}` : tag;
  const attrs = {};
  if (tag === "img") {
    for (const a of ["src", "srcset", "alt"]) {
      const v = el.getAttribute(a);
      if (v != null) attrs[a] = v;
    }
    if (!attrs.src) {
      const cs = el.currentSrc;
      if (cs) attrs.src = cs;
    }
  }
  return { tag, id, classes, primary, attrs };
}

function selectorPath(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const t = node.tagName.toLowerCase();
    if (t === "html") break;
    if (t === "body") {
      parts.unshift("body");
      break;
    }
    const id = node.id ? `#${node.id}` : "";
    const cls =
      node.classList && node.classList.length
        ? "." + Array.from(node.classList).filter((c) => !/^si-/.test(c)).join(".")
        : "";
    parts.unshift(t + id + cls);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function ensurePreviewStyles(doc) {
  if (doc.getElementById("si-styles")) return;
  const s = doc.createElement("style");
  s.id = "si-styles";
  const rotSvg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path fill='white' stroke='%230990f7' stroke-width='2' d='M6 14.5A8 8 0 0 1 17 6.5L20 6.5M20.5 3v4h-4'/><path fill='white' stroke='%230990f7' stroke-width='2' d='M18 14.5A8 8 0 0 1 7 18L4 18M3.5 21v-4h4'/></svg>";
  s.textContent =
    ".si-hover{outline:2px dashed #4dc9f6 !important;outline-offset:-2px}.si-selected{outline:2px solid #0990f7 !important;outline-offset:-2px;box-shadow:0 0 0 9999px rgba(9,144,247,.10) inset}" +
    "#si-paste-stage{position:fixed;left:8px;bottom:8px;z-index:9999;display:flex;flex-wrap:wrap;gap:10px;max-width:70vw;background:rgba(0,0,0,.28);padding:10px;border-radius:10px;backdrop-filter:blur(2px)}" +
    ".si-paste-item{outline:1px dashed rgba(255,255,255,.55);padding:6px;max-width:200px;max-height:150px;overflow:auto;background:rgba(255,255,255,.05);cursor:pointer}" +
    "#si-transform-box{position:fixed;z-index:2147483646;border:1.5px solid #0990f7;box-shadow:0 0 0 1px rgba(255,255,255,.35);pointer-events:none;padding:0;margin:0;box-sizing:border-box}" +
    "#si-transform-box .si-tf-move{position:absolute;left:0;top:0;right:0;bottom:0;cursor:move;pointer-events:auto;touch-action:none;background:rgba(9,144,247,.05);border:0;margin:0;padding:0;z-index:1;border-radius:1px}" +
    "#si-transform-box .si-tf-handle{position:absolute;width:11px;height:11px;background:#fff;border:1.5px solid #0990f7;border-radius:2px;pointer-events:auto;touch-action:none;box-shadow:0 1px 3px rgba(0,0,0,.35);padding:0;margin:0;z-index:2}" +
    "#si-transform-box .si-tf-handle:hover,#si-transform-box .si-tf-handle:focus-visible{background:#4dc9f6;outline:2px solid #4dc9f6;outline-offset:2px}" +
    "#si-transform-box .si-tf-corner{cursor:nwse-resize}" +
    "#si-transform-box .si-tf-corner[data-c='ne'],#si-transform-box .si-tf-corner[data-c='sw']{cursor:nesw-resize}" +
    "#si-transform-box .si-tf-edge-l,#si-transform-box .si-tf-edge-r{cursor:ew-resize}" +
    "#si-transform-box .si-tf-edge-t,#si-transform-box .si-tf-edge-b{cursor:ns-resize}" +
    "#si-transform-box .si-tf-nw{left:-5px;top:-5px}" +
    "#si-transform-box .si-tf-ne{right:-5px;top:-5px}" +
    "#si-transform-box .si-tf-sw{left:-5px;bottom:-5px}" +
    "#si-transform-box .si-tf-se{right:-5px;bottom:-5px}" +
    "#si-transform-box .si-tf-t{left:50%;top:-5px;transform:translateX(-50%)}" +
    "#si-transform-box .si-tf-b{left:50%;bottom:-5px;transform:translateX(-50%)}" +
    "#si-transform-box .si-tf-l{left:-5px;top:50%;transform:translateY(-50%)}" +
    "#si-transform-box .si-tf-r{right:-5px;top:50%;transform:translateY(-50%)}" +
    "#si-transform-box .si-tf-arm{position:absolute;left:50%;top:-28px;width:1.5px;height:23px;margin-left:-1px;background:#0990f7}" +
    "#si-transform-box .si-tf-rotate{position:absolute;left:50%;top:-28px;width:15px;height:15px;transform:translate(-50%,-50%);border-radius:50%;background:#fff center/13px 13px no-repeat url(\"data:image/svg+xml;utf8," + rotSvg + "\");border:1.5px solid #0990f7;pointer-events:auto;touch-action:none;cursor:url(\"data:image/svg+xml;utf8," + rotSvg + "\") 11 11,alias;box-shadow:0 1px 3px rgba(0,0,0,.35);padding:0;margin:0;z-index:2}" +
    "#si-transform-box .si-tf-rotate:hover,#si-transform-box .si-tf-rotate:focus-visible{background-color:#4dc9f6;outline:2px solid #4dc9f6;outline-offset:2px}" +
    "#si-transform-box .si-tf-pivot{position:absolute;left:50%;top:50%;width:9px;height:9px;transform:translate(-50%,-50%);border-radius:50%;background:#fff;border:1.5px solid #0990f7;pointer-events:none}" +
    "#si-transform-box:focus-visible{outline:1px solid #4dc9f6}" +
    "#si-tf-tip{position:fixed;z-index:2147483647;font:12px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;background:rgba(0,0,0,.78);padding:3px 8px;border-radius:6px;pointer-events:none;white-space:nowrap}";
  (doc.head || doc.documentElement).appendChild(s);
}

function clearPreviewSelection(doc) {
  if (!doc) return;
  doc.querySelectorAll(".si-selected").forEach((el) => el.classList.remove("si-selected"));
  selectedPreviewEl = null;
  removeTransformWidget(doc);
}

const NO_MOTION_CSS =
  "*{transition-duration:0s !important;transition-delay:0s !important;animation-duration:0s !important;animation-delay:0s !important;animation-iteration-count:1 !important;scroll-behavior:auto !important}";

function injectNoMotionStyle(doc) {
  if (!doc) return;
  let s = doc.getElementById("si-no-motion");
  if (!s) {
    s = doc.createElement("style");
    s.id = "si-no-motion";
    (doc.head || doc.documentElement).appendChild(s);
  }
  s.textContent = NO_MOTION_CSS;
}

function toggleStyleMotion() {
  styleMotionEnabled = !styleMotionEnabled;
  const btn = document.getElementById("styleMotionBtn");
  if (btn) {
    btn.classList.toggle("active", styleMotionEnabled);
    btn.textContent = styleMotionEnabled ? "Anims: off" : "Anims: on";
  }
  const doc = getPreviewDoc();
  if (styleMotionEnabled) injectNoMotionStyle(doc);
  else {
    const s = doc && doc.getElementById("si-no-motion");
    if (s) s.remove();
  }
}

// ── Object hierarchy / outliner ──

let outlinerCollapsed = false;
let outlinerTreeDoc = null;
const outlinerExpanded = new Set();

function outlinerTag(el) {
  const tag = ((el.tagName || "").toLowerCase()) || "?";
  if (el.id) return `${tag}#${el.id}`;
  const cls = Array.from(el.classList || []).filter((c) => c && !/^si-/.test(c));
  if (cls.length) return `${tag}.${cls[0]}` + (cls.length > 1 ? `+${cls.length - 1}` : "");
  return tag;
}

function outlinerChildren(el) {
  return Array.from(el.children || []).filter((c) => c.nodeType === 1);
}

function buildOutlinerRows(container, el, depth) {
  const kids = outlinerChildren(el).slice(0, 500);
  const row = document.createElement("div");
  row.className = "outliner-row";
  row.__el = el;
  row.dataset.path = selectorPath(el);
  const toggle = document.createElement("button");
  toggle.className = "outliner-node";
  toggle.type = "button";
  toggle.disabled = kids.length === 0;
  const kidsWrap = document.createElement("div");
  kidsWrap.className = "outliner-children";
  const open = !kids.length || depth < 3 || outlinerExpanded.has(el);
  toggle.textContent = !kids.length ? "" : open ? "▾" : "▸";
  if (!open) kidsWrap.classList.add("hidden");
  for (const k of kids) buildOutlinerRows(kidsWrap, k, depth + 1);
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const nowOpen = !kidsWrap.classList.contains("hidden");
    if (nowOpen) { kidsWrap.classList.add("hidden"); toggle.textContent = "▸"; outlinerExpanded.delete(el); }
    else { kidsWrap.classList.remove("hidden"); toggle.textContent = "▾"; outlinerExpanded.add(el); }
  });
  const label = document.createElement("span");
  label.className = "outliner-label";
  label.textContent = outlinerTag(el);
  row.appendChild(toggle);
  row.appendChild(label);
  row.addEventListener("click", (e) => {
    if (e.target === toggle || toggle.contains(e.target)) return;
    const doc = getPreviewDoc();
    if (!doc) return;
    if (outlinerTreeDoc !== doc) renderOutliner(doc);
    let el = row.__el && row.__el.ownerDocument === doc ? row.__el : null;
    if (!el && row.dataset.path) {
      try { el = doc.querySelector(row.dataset.path); } catch (_) {}
    }
    if (el) selectPreviewElement(el);
  });
  container.appendChild(row);
  container.appendChild(kidsWrap);
}

function renderOutliner(doc) {
  const tree = document.getElementById("outlinerTree");
  if (!tree || outlinerCollapsed) return;
  outlinerTreeDoc = doc || null;
  outlinerExpanded.clear();
  tree.innerHTML = "";
  if (!doc || !doc.body) return;
  buildOutlinerRows(tree, doc.body, 0);
  const panel = document.getElementById("outliner");
  if (panel) panel.style.display = "";
}

function renderOutlinerSelection(doc, el) {
  const tree = document.getElementById("outlinerTree");
  if (!tree || outlinerCollapsed) return;
  let active = null;
  for (const row of tree.querySelectorAll(".outliner-row")) {
    const on = row.__el === el;
    row.classList.toggle("outliner-row--active", on);
    if (on) active = row;
  }
  if (active) {
    let p = active.parentElement;
    while (p && p !== tree) {
      if (p.classList && p.classList.contains("outliner-children")) p.classList.remove("hidden");
      p = p.parentElement;
    }
    active.scrollIntoView({ block: "nearest" });
  }
}

function injectEditorCss(doc) {
  if (!doc) return;
  let s = doc.getElementById("si-editor-css");
  if (!s) {
    s = doc.createElement("style");
    s.id = "si-editor-css";
    (doc.head || doc.documentElement).appendChild(s);
  }
  s.textContent = generateCSS(styleBlocks);
  if (selectedPreviewEl && selectedPreviewEl.ownerDocument === doc && !(tfState && tfState.active)) {
    scheduleTransformWidget();
  }
}

function wirePreviewInspectorDoc(doc, frame) {
  const pageKey = currentPageKey();
  if (pageKey && doc.body) doc.body.setAttribute("data-page", pageKey);
  ensurePreviewStyles(doc);
  injectEditorCss(doc);
  if (styleMotionEnabled) injectNoMotionStyle(doc);
  if (pastedElements.length) renderPastedIntoPreview();
}

function selectPreviewElement(el) {
  if (!el || el.nodeType !== 1) return;
  const doc = getPreviewDoc();
  if (!doc) return;
  if (outlinerTreeDoc !== doc) renderOutliner(doc);
  if (el.closest("#si-paste-stage")) return;
  if (selectedPreviewEl) selectedPreviewEl.classList.remove("si-selected");
  selectedPreviewEl = el;
  inspectedElRef = el;
  el.classList.add("si-selected");
  const data = elementData(el);
  data.path = selectorPath(el);
  renderInspector(data);
  renderOutlinerSelection(doc, el);
  scheduleTransformWidget();
}

// ── Visual transform widget ──
// Selecting an element shows a Photoshop-style transform box: 8 scale handles,
// a rotate handle, a centered pivot and a move area. Dragging scales from the
// centered pivot (the element stays put while it grows), rotates about that
// pivot, or translates the element. Every change is written into the matching
// shared CSS rule (transform + transform-origin), so it applies to every
// instance of the element and is visible in real time.
// Accessibility: the box is focusable — arrow keys translate (Shift = 8px),
// [ / ] rotate, - / = scale, Home or double-click the rotate handle resets,
// Escape closes. Changes are announced via an aria-live readout and are one
// Undo step each (per gesture / per keystroke).

let tfState = null;
let tfRaf = 0;

function tfEligible(el) {
  if (!el || el.nodeType !== 1) return false;
  const t = el.tagName.toLowerCase();
  if (t === "html" || t === "body") return false;
  if (el.closest && el.closest("#si-paste-stage")) return false;
  return true;
}

// The rule a transform writes to — always the normal-state rule for the
// element's selector, honoring the inspector's "this page only" / "all pages"
// scope, so the change applies to every instance covered by that rule.
function tfRuleFor(data) {
  const scope = editScopeNow();
  const key = currentPageKey();
  const cands = styleBlocks.filter(
    (b) => b.type === "rule" && blockMatchesElementData(b, data) && stateSuffixOf(b) === ""
  );
  if (scope === "all") {
    const shared = cands.find((b) => !isScopedRule(b));
    return shared || createRuleFor(data, null, "");
  }
  const paged = cands.find((b) => isScopedRule(b) && pageScopeOfRule(b) === key);
  if (paged) return paged;
  if (!key) return cands[0] || createRuleFor(data, null, "");
  return createRuleFor(data, key, "");
}

function tfRound1(v) {
  return Math.round(v * 10) / 10;
}

function tfParse(css) {
  const s = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
  if (!css || css === "none") return s;
  const tr = /translate3d\(([^)]+)\)|translate\(([^)]+)\)/.exec(css);
  if (tr) {
    const parts = (tr[1] || tr[2]).split(",").map((x) => parseFloat(x));
    if (isFinite(parts[0])) s.dx = parts[0];
    if (isFinite(parts[1])) s.dy = parts[1];
  }
  const rm = /rotate(?:Z)?\(([^)]+)\)/.exec(css);
  if (rm) {
    const r = parseFloat(rm[1]);
    if (isFinite(r)) s.rot = r;
  }
  const sm = /scale(?:X|Y|3d)?\(([^)]+)\)/.exec(css);
  if (sm) {
    const p = sm[1].split(",").map((x) => parseFloat(x));
    if (isFinite(p[0])) s.sx = p[0];
    if (isFinite(p[1])) s.sy = p[1];
  }
  const mm = /matrix\(([^)]+)\)/.exec(css);
  if (mm) {
    const p = mm[1].split(",").map((x) => parseFloat(x));
    if (p.length >= 6 && isFinite(p[0]) && isFinite(p[1])) {
      const sx = Math.hypot(p[0], p[1]);
      const sy = Math.hypot(p[2], p[3]);
      if (sx > 0.0001) s.sx = sx;
      if (sy > 0.0001) s.sy = sy;
      s.rot = (Math.atan2(p[1], p[0]) * 180) / Math.PI;
      if (isFinite(p[4])) s.dx = p[4];
      if (isFinite(p[5])) s.dy = p[5];
    }
  }
  return s;
}

function tfSerialize(s) {
  return (
    `translate(${tfRound1(s.dx)}px, ${tfRound1(s.dy)}px) ` +
    `rotate(${tfRound1(s.rot)}deg) ` +
    `scale(${s.sx.toFixed(3)}, ${s.sy.toFixed(3)})`
  );
}

function ensureTransformWidget(doc) {
  let box = doc.getElementById("si-transform-box");
  if (!box) {
    box = doc.createElement("div");
    box.id = "si-transform-box";
    box.setAttribute("role", "application");
    box.setAttribute("tabindex", "0");
    box.setAttribute(
      "aria-label",
      "Transform selected element. Drag a corner to scale from the center, an edge to stretch, the round handle to rotate, or the box to move. Arrow keys translate (Shift = 8px), [ and ] rotate, - and = scale, Home or double-click the rotate handle resets, Escape closes."
    );
    box.innerHTML =
      `<button class="si-tf-handle si-tf-corner si-tf-nw" data-c="nw" type="button" tabindex="-1" aria-label="Scale from top-left"></button>` +
      `<button class="si-tf-handle si-tf-corner si-tf-ne" data-c="ne" type="button" tabindex="-1" aria-label="Scale from top-right"></button>` +
      `<button class="si-tf-handle si-tf-corner si-tf-sw" data-c="sw" type="button" tabindex="-1" aria-label="Scale from bottom-left"></button>` +
      `<button class="si-tf-handle si-tf-corner si-tf-se" data-c="se" type="button" tabindex="-1" aria-label="Scale from bottom-right"></button>` +
      `<button class="si-tf-handle si-tf-edge si-tf-t" data-e="t" type="button" tabindex="-1" aria-label="Scale height from the top edge"></button>` +
      `<button class="si-tf-handle si-tf-edge si-tf-b" data-e="b" type="button" tabindex="-1" aria-label="Scale height from the bottom edge"></button>` +
      `<button class="si-tf-handle si-tf-edge si-tf-l" data-e="l" type="button" tabindex="-1" aria-label="Scale width from the left edge"></button>` +
      `<button class="si-tf-handle si-tf-edge si-tf-r" data-e="r" type="button" tabindex="-1" aria-label="Scale width from the right edge"></button>` +
      `<div class="si-tf-arm"></div>` +
      `<button class="si-tf-rotate" type="button" tabindex="-1" aria-label="Rotate around the center pivot. Drag or use [ and ]"></button>` +
      `<div class="si-tf-pivot"></div>` +
      `<button class="si-tf-move" type="button" tabindex="-1" aria-label="Move the element. Drag or use arrow keys"></button>`;
    box.style.display = "none";
    box.addEventListener("pointerdown", tfPointerDown);
    box.addEventListener("pointermove", tfPointerMove);
    box.addEventListener("pointerup", tfPointerEnd);
    box.addEventListener("pointercancel", tfPointerCancel);
    box.addEventListener("dblclick", tfDoubleClick);
    box.addEventListener("keydown", tfKeyDown);
    const tip = doc.createElement("div");
    tip.id = "si-tf-tip";
    tip.setAttribute("role", "status");
    tip.setAttribute("aria-live", "polite");
    tip.style.display = "none";
    (doc.body || doc.documentElement).appendChild(box);
    (doc.body || doc.documentElement).appendChild(tip);
  }
  return box;
}

function removeTransformWidget(doc) {
  if (!doc) doc = getPreviewDoc();
  if (doc) {
    const box = doc.getElementById("si-transform-box");
    if (box) box.remove();
    const tip = doc.getElementById("si-tf-tip");
    if (tip) tip.remove();
  }
  tfState = null;
  tfRaf = 0;
}

function scheduleTransformWidget() {
  if (tfRaf) return;
  tfRaf = requestAnimationFrame(() => {
    tfRaf = 0;
    renderTransformWidget();
  });
}

function renderTransformWidget() {
  const doc = getPreviewDoc();
  if (!doc) {
    removeTransformWidget();
    return;
  }
  const el = selectedPreviewEl;
  if (!el || el.ownerDocument !== doc || !tfEligible(el)) {
    const box = doc.getElementById("si-transform-box");
    if (box) box.style.display = "none";
    return;
  }
  const box = ensureTransformWidget(doc);
  const s = ensureTfState(doc);
  if (!s) {
    box.style.display = "none";
    return;
  }
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || !isFinite(r.left)) {
    box.style.display = "none";
    return;
  }
  const cx = r.left + r.width / 2 - s.dx;
  const cy = r.top + r.height / 2 - s.dy;
  const visW = Math.max(2, s.baseW * s.sx);
  const visH = Math.max(2, s.baseH * s.sy);
  box.style.left = cx + s.dx + "px";
  box.style.top = cy + s.dy + "px";
  box.style.width = visW + "px";
  box.style.height = visH + "px";
  box.style.transform = `translate(-50%, -50%) rotate(${s.rot}deg)`;
  box.style.display = "block";
}

function ensureTfState(doc) {
  const el = selectedPreviewEl;
  if (!doc || !el || el.ownerDocument !== doc || !tfEligible(el)) return null;
  if (tfState && tfState.el === el && tfState.doc === doc) {
    const cur = getBlockProp(tfState.block, "transform") || "";
    if (cur && cur !== tfSerialize(tfState)) {
      tfState = buildTfState(doc, el, tfState.data, tfState.block);
    }
    return tfState;
  }
  const data = elementData(el);
  data.path = selectorPath(el);
  const block = tfRuleFor(data);
  tfState = buildTfState(doc, el, data, block);
  return tfState;
}

function buildTfState(doc, el, data, block) {
  const init = tfParse(getBlockProp(block, "transform") || "");
  return {
    active: false,
    gesture: null,
    doc,
    el,
    data,
    block,
    created: block.__justCreated === true,
    dx: init.dx,
    dy: init.dy,
    rot: init.rot,
    sx: init.sx,
    sy: init.sy,
    baseW: Math.max(1, el.offsetWidth || 1),
    baseH: Math.max(1, el.offsetHeight || 1),
    moved: false,
    prevTransform: null,
    prevOrigin: null,
  };
}

function showTfTip(s, text) {
  if (!s || !s.doc) return;
  const tip = s.doc.getElementById("si-tf-tip");
  if (!tip) return;
  tip.textContent = text;
  const box = s.doc.getElementById("si-transform-box");
  if (box) {
    const br = box.getBoundingClientRect();
    tip.style.left = Math.max(4, br.left) + "px";
    tip.style.top = Math.max(4, br.top - 24) + "px";
  }
  tip.style.display = "block";
}

function writeTfCss() {
  const s = tfState;
  if (!s || !s.doc) return;
  setBlockProp(s.block, "transform", tfSerialize(s));
  setBlockProp(s.block, "transform-origin", "center");
  s.block.edited = true;
  styleDirty = true;
  updateStyleSave();
  injectEditorCss(s.doc);
  renderTransformWidget();
  showTfTip(
    s,
    `${Math.round(s.sx * 100)}% × ${Math.round(s.sy * 100)}% · ${tfRound1(s.rot)}° · X${tfRound1(s.dx)} Y${tfRound1(s.dy)}`
  );
}

function tfPointerDown(e) {
  const target = e.target && e.target.closest ? e.target.closest(".si-tf-handle, .si-tf-rotate, .si-tf-move") : null;
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  const box = e.currentTarget;
  const doc = box.ownerDocument;
  const s = ensureTfState(doc);
  if (!s || !s.doc) return;
  try { box.setPointerCapture(e.pointerId); } catch (_) {}
  const r = s.el.getBoundingClientRect();
  const c = (target.dataset.c || "").slice();
  const ed = target.dataset.e || "";
  let mode = "move";
  let kw = 0, kh = 0;
  if (target.classList.contains("si-tf-rotate")) {
    mode = "rotate";
  } else if (target.classList.contains("si-tf-corner")) {
    mode = "scale";
    kw = c && c[1] === "w" ? -1 : 1;
    kh = c && c[0] === "n" ? -1 : 1;
  } else if (target.classList.contains("si-tf-edge")) {
    mode = "scale";
    if (ed === "l") { kw = -1; kh = 0; }
    else if (ed === "r") { kw = 1; kh = 0; }
    else if (ed === "t") { kw = 0; kh = -1; }
    else { kw = 0; kh = 1; }
  }
  const cx = r.left + r.width / 2 - s.dx;
  const cy = r.top + r.height / 2 - s.dy;
  s.gesture = {
    mode,
    kw,
    kh,
    x: e.clientX,
    y: e.clientY,
    dx: s.dx,
    dy: s.dy,
    rot: s.rot,
    sx: s.sx,
    sy: s.sy,
    cx,
    cy,
    vw0: Math.max(2, s.baseW * s.sx) / 2,
    vh0: Math.max(2, s.baseH * s.sy) / 2,
    px0: e.clientX - cx,
    py0: e.clientY - cy,
  };
  s.prevTransform = getBlockProp(s.block, "transform") || "";
  s.prevOrigin = getBlockProp(s.block, "transform-origin") || "";
  s.moved = false;
  s.active = true;
}

function clampTf(f) {
  return Math.max(0.05, Math.min(20, f));
}

function tfPointerMove(e) {
  const s = tfState;
  if (!s || !s.gesture || !s.active) return;
  e.preventDefault();
  e.stopPropagation();
  const g = s.gesture;
  if (g.mode === "move") {
    s.dx = g.dx + (e.clientX - g.x);
    s.dy = g.dy + (e.clientY - g.y);
  } else if (g.mode === "rotate") {
    const ax = e.clientX - g.cx;
    const ay = e.clientY - g.cy;
    if (Math.hypot(ax, ay) < 6) return;
    const ang = Math.atan2(ay, ax);
    const base = Math.atan2(g.py0, g.px0);
    s.rot = g.rot + ((ang - base) * 180) / Math.PI;
  } else {
    const th = (-g.rot * Math.PI) / 180;
    const px = e.clientX - g.cx;
    const py = e.clientY - g.cy;
    const lx = px * Math.cos(th) - py * Math.sin(th);
    const ly = px * Math.sin(th) + py * Math.cos(th);
    if (g.kw && g.kh) {
      const f = Math.hypot(lx, ly) / Math.hypot(g.vw0, g.vh0);
      s.sx = clampTf(f);
      s.sy = clampTf(f);
    } else if (g.kw) {
      s.sx = clampTf(Math.abs(lx) / g.vw0);
    } else if (g.kh) {
      s.sy = clampTf(Math.abs(ly) / g.vh0);
    }
  }
  s.moved = true;
  writeTfCss();
}

function tfPointerEnd(e) {
  const s = tfState;
  if (!s || !s.active) return;
  s.active = false;
  const box = e.currentTarget || (s.doc && s.doc.getElementById("si-transform-box"));
  if (box && typeof e.pointerId === "number") {
    try { box.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  tfFinalize();
}

function tfPointerCancel() {
  const s = tfState;
  if (!s || !s.active) return;
  s.active = false;
  if (s.gesture) {
    removePropDecl(s.block, "transform");
    removePropDecl(s.block, "transform-origin");
    if (s.prevTransform) setBlockProp(s.block, "transform", s.prevTransform);
    if (s.prevOrigin) setBlockProp(s.block, "transform-origin", s.prevOrigin);
    s.dx = s.gesture.dx;
    s.dy = s.gesture.dy;
    s.rot = s.gesture.rot;
    s.sx = s.gesture.sx;
    s.sy = s.gesture.sy;
    s.gesture = null;
    s.moved = false;
    styleDirty = true;
    updateStyleSave();
    injectEditorCss(s.doc);
  }
}

function captureBefore(s) {
  s.prevTransform = getBlockProp(s.block, "transform") || "";
  s.prevOrigin = getBlockProp(s.block, "transform-origin") || "";
}

function commitTfKey(s) {
  pushStyleUndo({
    type: "tf-transform",
    block: s.block,
    created: false,
    before: s.prevTransform || "",
    beforeOrigin: s.prevOrigin || "",
    after: tfSerialize(s),
    afterOrigin: "center",
  });
  renderStyleList();
  refreshVisualControls(s.data);
  renderInspectorMatches(s.data);
}

function tfKeyDown(e) {
  const box = e.currentTarget;
  if (!box) return;
  const doc = box.ownerDocument;
  const s = ensureTfState(doc);
  if (!s) return;
  const k = e.key;
  let changed = false;
  if (k === "ArrowRight" || k === "ArrowLeft" || k === "ArrowUp" || k === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    captureBefore(s);
    const step = e.shiftKey ? 8 : 1;
    if (k === "ArrowRight") s.dx += step;
    else if (k === "ArrowLeft") s.dx -= step;
    else if (k === "ArrowUp") s.dy -= step;
    else s.dy += step;
    changed = true;
  } else if (k === "[" || k === "]" || k === "{" || k === "}") {
    e.preventDefault();
    e.stopPropagation();
    captureBefore(s);
    const d = k === "[" || k === "{" ? -1 : 1;
    s.rot = s.rot + d * (e.shiftKey ? 5 : 1);
    changed = true;
  } else if (k === "-" || k === "_" || k === "=" || k === "+") {
    e.preventDefault();
    e.stopPropagation();
    captureBefore(s);
    const d = k === "-" || k === "_" ? -1 : 1;
    const p = (e.shiftKey ? 5 : 1) / 100;
    s.sx = clampTf(s.sx + d * p);
    s.sy = clampTf(s.sy + d * p);
    changed = true;
  } else if (k === "Home") {
    e.preventDefault();
    e.stopPropagation();
    tfReset();
    return;
  } else if (k === "Escape" || k === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    removeTransformWidget();
    return;
  }
  if (changed) {
    s.moved = true;
    writeTfCss();
    commitTfKey(s);
    s.moved = false;
    scheduleTransformWidget();
  }
}

function tfDoubleClick(e) {
  if (e.target && e.target.closest && e.target.closest(".si-tf-rotate")) {
    e.preventDefault();
    e.stopPropagation();
    tfReset();
  }
}

function tfReset() {
  const s = tfState;
  if (!s || !s.doc) return;
  const block = s.block;
  const before = getBlockProp(block, "transform") || "";
  const beforeOrigin = getBlockProp(block, "transform-origin") || "";
  if (!before && !beforeOrigin) return;
  removePropDecl(block, "transform");
  removePropDecl(block, "transform-origin");
  block.edited = true;
  styleDirty = true;
  updateStyleSave();
  injectEditorCss(s.doc);
  pushStyleUndo({
    type: "tf-transform",
    block,
    created: s.created,
    before,
    beforeOrigin,
    after: "",
    afterOrigin: "",
  });
  showTfTip(s, "Transform reset");
  setTimeout(() => {
    const tip = s.doc.getElementById("si-tf-tip");
    if (tip) tip.style.display = "none";
  }, 1400);
  s.dx = 0;
  s.dy = 0;
  s.rot = 0;
  s.sx = 1;
  s.sy = 1;
  s.moved = false;
  renderTransformWidget();
}

function tfFinalize() {
  const s = tfState;
  if (!s) return;
  const tip = s.doc && s.doc.getElementById("si-tf-tip");
  if (tip && !s.moved) tip.style.display = "none";
  if (s.moved) {
    const after = tfSerialize(s);
    const changed = s.prevTransform !== after || (s.prevOrigin || "") !== "center";
    if (changed) {
      pushStyleUndo({
        type: "tf-transform",
        block: s.block,
        created: s.created,
        before: s.prevTransform || "",
        beforeOrigin: s.prevOrigin || "",
        after,
        afterOrigin: "center",
      });
    }
    renderStyleList();
    refreshVisualControls(s.data);
    renderInspectorMatches(s.data);
    const status = document.getElementById("styleStatus");
    if (status) {
      status.textContent = `Transform updated (scale ${Math.round(s.sx * 100)}% × ${Math.round(s.sy * 100)}%, rotate ${tfRound1(s.rot)}°, X${tfRound1(s.dx)} Y${tfRound1(s.dy)}) for ${s.data.primary} — applies to every instance.`;
      status.className = "status-msg success";
    }
  }
  s.active = false;
  s.gesture = null;
  s.moved = false;
  scheduleTransformWidget();
}

function wirePreviewInspector() {
  const frame = document.getElementById("sitePreview");
  if (!frame || !frame.contentDocument) return;
  const doc = frame.contentDocument;
  if (pipetteActive) endPipette();
  wirePreviewInspectorDoc(doc, frame);
  renderOutliner(doc);

  doc.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (ignoreNextPreviewClick) { ignoreNextPreviewClick = false; return; }
      if (tfState && tfState.active) return;
      if (e.target && e.target.closest && e.target.closest("#si-transform-box")) return;
      selectPreviewElement(e.target);
    },
    true
  );

  doc.addEventListener(
    "mouseover",
    (e) => {
      const el = e.target;
      if (!el || el.nodeType !== 1) return;
      if ((el.closest && el.closest("#si-transform-box")) || (tfState && tfState.active)) return;
      doc.querySelectorAll(".si-hover").forEach((n) => n !== el && n.classList.remove("si-hover"));
      el.classList.add("si-hover");
    },
    true
  );

  doc.addEventListener("mouseout", (e) => {
    const el = e.target;
    if (el && el.nodeType === 1) el.classList.remove("si-hover");
  });

  const dw = doc.defaultView;
  if (dw) {
    dw.addEventListener("resize", scheduleTransformWidget);
    dw.addEventListener("scroll", scheduleTransformWidget, true);
  }

  doc.addEventListener("submit", (e) => e.preventDefault());
}

function switchInspectorTab(name) {
  document.querySelectorAll(".inspector-tab").forEach((t) => {
    t.classList.toggle("inspector-tab--active", t.dataset.itab === name);
  });
  document.getElementById("inspectorInspect").classList.toggle("inspector-body--active", name === "inspect");
  document.getElementById("inspectorElements").classList.toggle("inspector-body--active", name === "elements");
}

function blockMatchesElementData(block, data) {
  if (block.type !== "rule") return false;
  const scope = pageScopeOfRule(block);
  if (scope && scope !== currentPageKey()) return false;
  const { classes, ids, tags } = selectorTokens(block.prelude);
  if (data.id && ids.has(`#${data.id}`)) return true;
  if (tags.has(data.tag)) return true;
  return data.classes.some((c) => classes.has(`.${c}`));
}

function getMatchPriority(block, data) {
  if (block.prelude.trim() === data.primary) return 0;
  const { classes, ids, tags } = selectorTokens(block.prelude);
  if (data.id && ids.has(`#${data.id}`)) return 1;
  return 2;
}

function populateAttachSelect(selectedValue) {
  const sel = document.getElementById("attachSelect");
  sel.innerHTML = "";
  const seen = new Set();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Choose a rule to link this element to...";
  sel.appendChild(empty);
  for (const b of styleBlocks) {
    if (b.type !== "rule") continue;
    const pre = b.prelude.trim();
    if (!pre || seen.has(pre)) continue;
    seen.add(pre);
    const opt = document.createElement("option");
    opt.value = pre;
    opt.textContent = pre.length > 80 ? pre.slice(0, 77) + "..." : pre;
    sel.appendChild(opt);
  }
  sel.value = selectedValue || "";
}

function findMatchBlock(data) {
  let best = null, bestP = Infinity;
  for (const b of styleBlocks) {
    if (b.type !== "rule") continue;
    if (blockMatchesElementData(b, data)) {
      const p = getMatchPriority(b, data);
      if (p < bestP) { best = b; bestP = p; }
    }
  }
  return best;
}

function createRuleFor(data, pageKey, pseudo) {
  const sel = (data.primary || "body") + (pseudo || "");
  const prelude = pageKey ? pageSelector(pageKey, sel) : sel;
  const block = { type: "rule", prelude, inner: "\n", raw: "", edited: true, decls: [], __justCreated: true };
  styleBlocks.push(block);
  styleDirty = true;
  updateStyleSave();
  return block;
}

// The best rule that matches `data` with the requested scope AND element
// state. Returns null when there is nothing to read from, in which case the
// caller falls back to the computed style / best-match rule.
function findEditableBlock(data, scope, pseudo) {
  const key = currentPageKey();
  const cands = styleBlocks.filter((b) => b.type === "rule" && blockMatchesElementData(b, data));
  const wantScope = (b) =>
    scope === "all" ? !isScopedRule(b) : isScopedRule(b) && pageScopeOfRule(b) === key;
  const samePseudo = (b) => stateSuffixOf(b) === pseudo;
  let hit = cands.find((b) => wantScope(b) && samePseudo(b));
  if (hit) return hit;
  if (!pseudo) return null;
  return cands.find((b) => b.type === "rule" && samePseudo(b)) || null;
}

// Returns the rule a visual edit should write to, honoring the inspector's
// "This page only" / "All pages" scope and the selected element state.
// Page-scoped edits target (or create) a body[data-page="..."] override;
// "All pages" edits target the shared rule. State edits append the pseudo
// class (e.g. .root-wrap:hover) so hover/active/focus get their own values.
function ruleToEdit(data) {
  const scope = editScopeNow();
  const key = currentPageKey();
  const pseudo = statePseudoOf(editStatePref);
  const candidates = styleBlocks.filter((b) => b.type === "rule" && blockMatchesElementData(b, data));
  const wantPseudo = (b) => stateSuffixOf(b) === pseudo;
  if (scope === "all") {
    const global = candidates.find((b) => !isScopedRule(b) && wantPseudo(b));
    if (global) return global;
    return createRuleFor(data, null, pseudo);
  }
  const paged = candidates.find((b) => isScopedRule(b) && pageScopeOfRule(b) === key && wantPseudo(b));
  if (paged) return paged;
  if (!key) return candidates.find(wantPseudo) || createRuleFor(data, null, pseudo);
  return createRuleFor(data, key, pseudo);
}

// The current value for a property: exact value written in a matching rule if
// present, otherwise the live computed value of the inspected element.
function readValue(data, cssProp) {
  const block = findEditableBlock(data, editScopeNow(), statePseudoOf(editStatePref)) || findMatchBlock(data);
  if (block) {
    const v = getBlockProp(block, cssProp);
    if (v != null && v !== "") return v;
  }
  const el = inspectedElRef;
  if (el) {
    const doc = getPreviewDoc();
    if (doc) {
      const cs = doc.defaultView.getComputedStyle(el);
      const raw = cs.getPropertyValue(cssProp);
      if (raw) return raw;
    }
  }
  return null;
}

// Removes a rule block entirely. Restoreable via Undo, so an accidental
// deletion is never lost before saving.
function removeStyleBlock(b, activeData) {
  const idx = styleBlocks.indexOf(b);
  if (idx === -1) return;
  pushStyleUndo({ type: "rule-removed", index: idx, block: b });
  styleBlocks.splice(idx, 1);
  if (b.decls) b.decls = [];
  styleDirty = true;
  updateStyleSave();
  injectEditorCss(getPreviewDoc());
  renderStyleList();
  if (activeData) renderInspector(activeData);
  else if (inspected) refreshVisualControls(inspected);
}

function applyVisualProp(data, cssProp, cssVal) {
  const block = ruleToEdit(data);
  const created = block.__justCreated === true;
  if (created) block.__justCreated = false;
  const before = readPropState(block, cssProp);
  if (styleUndoActive) {
    if (!styleUndoPending) {
      styleUndoPending = { block, prop: cssProp, before: before.value, hadDecl: before.hadDecl, created };
    }
  } else {
    pushStyleUndo({ block, prop: cssProp, before: before.value, after: cssVal, hadDecl: before.hadDecl, created });
  }
  setBlockProp(block, cssProp, cssVal);
  styleDirty = true;
  updateStyleSave();
  injectEditorCss(getPreviewDoc());
  renderStyleList();
  refreshVisualControls(data);
  renderInspectorMatches(data);
}

function readPropState(block, prop) {
  const d = declsOf(block).find((i) => i.kind === "decl" && i.prop === prop);
  return { value: d ? d.value : "", hadDecl: !!d };
}

// A drag / color-wheel interaction is a single undo step: begin before the
// first change, end when the interaction finishes. Only the final value is
// recorded, so intermediate colors never pollute the history.
function beginStyleUndo() {
  if (!styleUndoActive) {
    styleUndoActive = true;
    styleUndoPending = null;
  }
}

function endStyleUndo() {
  styleUndoActive = false;
  if (styleUndoPending) {
    const p = styleUndoPending;
    const after = readPropState(p.block, p.prop).value;
    styleUndoPending = null;
    pushStyleUndo({ block: p.block, prop: p.prop, before: p.before, after, hadDecl: p.hadDecl, created: p.created });
  }
}

function pushStyleUndo(entry) {
  if (entry.type !== "rule-removed" && entry.type !== "scale-resize" && entry.before === entry.after) return;
  styleUndoStack.push(entry);
  if (styleUndoStack.length > 200) styleUndoStack.shift();
  updateStyleUndoUI();
}

function clearStyleUndo() {
  styleUndoStack.length = 0;
  styleUndoActive = false;
  styleUndoPending = null;
  updateStyleUndoUI();
}

function removePropDecl(block, prop) {
  const decls = declsOf(block);
  const i = decls.findIndex((d) => d.kind === "decl" && d.prop === prop);
  if (i >= 0) decls.splice(i, 1);
  block.inner = serializeDecls(decls);
}

function applySize(block, w, h) {
  const set = (prop, val) => {
    if (val == null || val === "") removePropDecl(block, prop);
    else setBlockProp(block, prop, String(val).trim());
  };
  set("width", w);
  set("height", h);
}

function undoStyle() {
  endStyleUndo();
  while (styleUndoStack.length) {
    const entry = styleUndoStack.pop();
    if (entry.type === "rule-removed") {
      styleBlocks.splice(Math.min(entry.index, styleBlocks.length), 0, entry.block);
    } else if (entry.type === "scale-resize") {
      const block = entry.block;
      const idx = styleBlocks.indexOf(block);
      if (idx === -1) continue;
      applySize(block, entry.w, entry.h);
      if (entry.created && !declsOf(block).some((i) => i.kind === "decl")) styleBlocks.splice(idx, 1);
      block.edited = true;
    } else if (entry.type === "tf-transform") {
      const block = entry.block;
      const idx = styleBlocks.indexOf(block);
      if (idx === -1) continue;
      removePropDecl(block, "transform");
      removePropDecl(block, "transform-origin");
      if (entry.before) setBlockProp(block, "transform", entry.before);
      if (entry.beforeOrigin) setBlockProp(block, "transform-origin", entry.beforeOrigin);
      if (entry.created && !declsOf(block).some((i) => i.kind === "decl")) styleBlocks.splice(idx, 1);
      block.edited = true;
    } else {
      const block = entry.block;
      const idx = styleBlocks.indexOf(block);
      if (idx === -1) continue;
      if (entry.created) {
        removePropDecl(block, entry.prop);
        if (!declsOf(block).some((i) => i.kind === "decl")) styleBlocks.splice(idx, 1);
      } else if (!entry.hadDecl) {
        removePropDecl(block, entry.prop);
      } else {
        setBlockProp(block, entry.prop, entry.before);
      }
      block.edited = true;
    }
    styleDirty = true;
    updateStyleSave();
    injectEditorCss(getPreviewDoc());
    renderStyleList();
    refreshVisualControls(inspected);
    updateStyleUndoUI();
    return true;
  }
  updateStyleUndoUI();
  return false;
}

function updateStyleUndoUI() {
  const btn = document.getElementById("styleUndoBtn");
  if (!btn) return;
  const n = styleUndoStack.length;
  btn.disabled = n === 0;
  btn.textContent = n ? `Undo (${n})` : "Undo";
  btn.title = n
    ? `Undo last change (${n} step${n === 1 ? "" : "s"} in history) — Ctrl/Cmd+Z`
    : "No style changes to undo — Ctrl/Cmd+Z";
}

function refreshVisualControls(data) {
  if (!data) return;
  for (const ctl of visualControls) {
    if (ctl.refresh) ctl.refresh();
  }
}

// ── Visual control builders ──

const VISUAL_GROUPS = [
  {
    name: "Colors", id: "propColors", props: [
      { key: "textColor", css: "color", kind: "color", label: "Text", icon: "text" },
      { key: "bgColor", css: "background-color", kind: "color", label: "Background", icon: "bg" },
      { key: "borderColor", css: "border-color", kind: "color", label: "Border", icon: "border" },
      { key: "glow", css: "--glow", kind: "color", label: "Glow", icon: "glow" },
    ],
  },
  {
    name: "Text", id: "propText", props: [
      { key: "fontSize", css: "font-size", kind: "slider", label: "Font size", icon: "fsize", min: 8, max: 120, step: 1, unit: "px", fmt: (v) => Math.round(v) + "px", fallback: 16 },
      { key: "fontWeight", css: "font-weight", kind: "slider", label: "Boldness", icon: "fweight", min: 100, max: 900, step: 100, fmt: (v) => String(Math.round(v)), fallback: 400 },
      { key: "letterSpacing", css: "letter-spacing", kind: "slider", label: "Spacing", icon: "lspace", min: -5, max: 20, step: 0.5, unit: "px", fmt: (v) => (v > 0 ? "+" : "") + v + "px", fallback: 0 },
      { key: "lineHeight", css: "line-height", kind: "slider", label: "Line height", icon: "lheight", min: 0.8, max: 3, step: 0.05, fmt: (v) => v.toFixed(2), fallback: 1.2, toCss: (v) => String(v) },
      { key: "textAlign", css: "text-align", kind: "align", label: "Align", align: ["left", "center", "right", "justify"] },
    ],
  },
  {
    name: "Shape", id: "propShape", props: [
      { key: "radius", css: "border-radius", kind: "slider", label: "Corners", icon: "radius", min: 0, max: 100, step: 1, unit: "px", fmt: (v) => Math.round(v) + "px", fallback: 0 },
      { key: "borderWidth", css: "border-width", kind: "slider", label: "Border width", icon: "bwidth", min: 0, max: 24, step: 1, unit: "px", fmt: (v) => Math.round(v) + "px", fallback: 0 },
      { key: "opacity", css: "opacity", kind: "slider", label: "Opacity", icon: "opacity", min: 0, max: 100, step: 1, unit: "%", fmt: (v) => Math.round(v) + "%", fallback: 100, fromCss: (raw) => Math.round((numValue(raw, 1)) * 100), toCss: (v) => String(v / 100) },
      { key: "boxShadow", css: "box-shadow", kind: "shadow", label: "Shadow", icon: "shadow" },
      { key: "textShadow", css: "text-shadow", kind: "shadow", label: "Text shadow", icon: "tshadow" },
    ],
  },
  {
    name: "Image", id: "propImage", props: [
      { key: "transform", css: "transform", kind: "imageTransform", label: "Scale & position", icon: "img", tags: ["img"] },
    ],
  },
];

function sliderNumber(raw, def) {
  if (def.fromCss) return def.fromCss(raw);
  const n = parseFloat(raw);
  return isNaN(n) ? def.fallback : n;
}

function makeSliderControl(data, def) {
  const root = document.createElement("div");
  root.className = "vc vc-slider";
  root.innerHTML =
    `<div class="vc-head">${def.icon ? `<span class="vc-icon">${ICONS[def.icon] || ""}</span>` : ""}<span class="vc-label">${def.label}</span><span class="vc-value"></span></div>` +
    `<div class="vc-track" tabindex="0" role="slider" aria-label="${def.label}"><div class="vc-fill"></div><div class="vc-knob"></div></div>`;
  const track = root.querySelector(".vc-track");
  const fill = root.querySelector(".vc-fill");
  const knob = root.querySelector(".vc-knob");
  const valEl = root.querySelector(".vc-value");
  let current = Math.max(def.min, Math.min(def.max, sliderNumber(readValue(data, def.css), def)));
  const pct = (v) => ((v - def.min) / (def.max - def.min)) * 100;
  function setDisplay(v) {
    current = Math.max(def.min, Math.min(def.max, v));
    const p = pct(current);
    knob.style.left = p + "%";
    fill.style.width = p + "%";
    valEl.textContent = def.fmt(current);
  }
  function toCssVal(v) {
    if (def.toCss) return def.toCss(v);
    return def.unit ? `${v}${def.unit}` : String(v);
  }
  function commit(v) {
    setDisplay(v);
    applyVisualProp(data, def.css, toCssVal(v));
  }
  function fromEvent(e) {
    const r = track.getBoundingClientRect();
    const v = def.min + ((e.clientX - r.left) / Math.max(r.width, 1)) * (def.max - def.min);
    return def.min + Math.round((Math.max(def.min, Math.min(def.max, v)) - def.min) / def.step) * def.step;
  }
  track.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    beginStyleUndo();
    commit(fromEvent(e));
    const mv = (ev) => commit(fromEvent(ev));
    const up = (ev) => {
      track.releasePointerCapture(ev.pointerId);
      track.removeEventListener("pointermove", mv);
      track.removeEventListener("pointerup", up);
      track.removeEventListener("pointercancel", up);
      endStyleUndo();
    };
    track.addEventListener("pointermove", mv);
    track.addEventListener("pointerup", up);
    track.addEventListener("pointercancel", up);
  });
  track.addEventListener("keydown", (e) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    commit(Math.max(def.min, Math.min(def.max, current + dir * def.step)));
  });
  setDisplay(current);
  return {
    el: root,
    refresh: () => setDisplay(Math.max(def.min, Math.min(def.max, sliderNumber(readValue(data, def.css), def)))),
  };
}

function makeColorControl(data, def) {
  const root = document.createElement("div");
  root.className = "vc vc-color";
  root.innerHTML =
    `<div class="vc-head">${def.icon ? `<span class="vc-icon">${ICONS[def.icon] || ""}</span>` : ""}<span class="vc-label">${def.label}</span><span class="vc-value"></span></div>` +
    `<button type="button" class="vc-swatch" title="${def.label}"><span class="vc-swatch-checker"></span><span class="vc-swatch-fill"></span></button>`;
  const fill = root.querySelector(".vc-swatch-fill");
  const valEl = root.querySelector(".vc-value");
  function setDisplay(v) {
    const c = parseCssColor(v);
    if (c) {
      fill.style.background = c.a <= 0 ? "transparent" : cssColorStr(c);
      valEl.textContent = toHex(c);
    } else {
      fill.style.background = "transparent";
      valEl.textContent = v || "transparent";
    }
  }
  root.querySelector(".vc-swatch").addEventListener("click", (e) => {
    e.stopPropagation();
    beginStyleUndo();
    openColorPopover(root.querySelector(".vc-swatch"), readValue(data, def.css) || "transparent", (css) => {
      applyVisualProp(data, def.css, css);
    });
  });
  setDisplay(readValue(data, def.css));
  return { el: root, refresh: () => setDisplay(readValue(data, def.css)) };
}

function makeAlignControl(data, def) {
  const root = document.createElement("div");
  root.className = "vc vc-align";
  root.innerHTML = `<div class="vc-head"><span class="vc-label">Align</span></div><div class="vc-align-group"></div>`;
  const group = root.querySelector(".vc-align-group");
  let current = (readValue(data, def.css) || "left").toLowerCase();
  const btns = {};
  for (const a of def.align) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vc-align-btn";
    b.title = a;
    b.innerHTML = ICONS["align" + a[0].toUpperCase() + a.slice(1)] || a;
    b.addEventListener("click", () => {
      current = a;
      applyVisualProp(data, def.css, a);
      sync();
    });
    group.appendChild(b);
    btns[a] = b;
  }
  function sync() {
    for (const a of def.align) btns[a].classList.toggle("active", a === current);
  }
  sync();
  return { el: root, refresh: () => { current = (readValue(data, def.css) || "left").toLowerCase(); sync(); } };
}

function makeShadowControl(data, def) {
  const root = document.createElement("div");
  root.className = "vc vc-shadow";
  root.innerHTML =
    `<div class="vc-head"><span class="vc-icon">${ICONS[def.icon] || ""}</span><span class="vc-label">${def.label}</span>` +
    `<label class="switch vc-shadow-switch"><input type="checkbox"><span class="slider"></span></label></div>` +
    `<div class="vc-shadow-body">` +
    ["X", "Y", "Blur"].map((k, i) => `<div class="vc-shadow-row"><span class="vc-shadow-name">${k}</span><div class="vc-track vc-track--sm" data-ax="${i}"><div class="vc-fill"></div><div class="vc-knob"></div></div></div>`).join("") +
    `<div class="vc-shadow-row"><span class="vc-shadow-name">Color</span><button type="button" class="vc-swatch vc-swatch--sm"><span class="vc-swatch-checker"></span><span class="vc-swatch-fill"></span></button></div>` +
    `</div>`;
  const onInput = root.querySelector("input");
  const body = root.querySelector(".vc-shadow-body");
  const colorFill = root.querySelector(".vc-swatch--sm .vc-swatch-fill");
  const RANGE = { 0: [-40, 40], 1: [-40, 40], 2: [0, 80] };
  const state = { on: false, x: 0, y: 4, blur: 8, color: "rgba(0, 0, 0, 0.35)" };
  function parseRaw() {
    const ps = parseShadow(readValue(data, def.css));
    if (ps) {
      state.on = true;
      state.x = ps.x; state.y = ps.y; state.blur = ps.blur; state.color = ps.color;
    } else {
      state.on = false;
    }
  }
  function emit() {
    applyVisualProp(data, def.css, state.on ? `${state.x}px ${state.y}px ${state.blur}px ${state.color}` : "none");
  }
  function valOf(i) { return i === 0 ? state.x : i === 1 ? state.y : state.blur; }
  function setOf(i) { return (v) => { if (i === 0) state.x = v; else if (i === 1) state.y = v; else state.blur = v; }; }
  root.querySelectorAll(".vc-track--sm").forEach((tr) => {
    const i = +tr.dataset.ax;
    const fill = tr.querySelector(".vc-fill"), knob = tr.querySelector(".vc-knob");
    const min = RANGE[i][0], max = RANGE[i][1];
    function setPct() {
      const p = ((valOf(i) - min) / (max - min)) * 100;
      knob.style.left = p + "%";
      fill.style.width = p + "%";
    }
    function fromEvent(e) {
      const r = tr.getBoundingClientRect();
      const v = min + ((e.clientX - r.left) / Math.max(r.width, 1)) * (max - min);
      return Math.round(Math.max(min, Math.min(max, v)));
    }
    tr.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      tr.setPointerCapture(e.pointerId);
      beginStyleUndo();
      setOf(i)(fromEvent(e)); setPct(); emit();
      const mv = (ev) => { setOf(i)(fromEvent(ev)); setPct(); emit(); };
      const up = (ev) => {
        tr.releasePointerCapture(ev.pointerId);
        tr.removeEventListener("pointermove", mv);
        tr.removeEventListener("pointerup", up);
        tr.removeEventListener("pointercancel", up);
        endStyleUndo();
      };
      tr.addEventListener("pointermove", mv);
      tr.addEventListener("pointerup", up);
      tr.addEventListener("pointercancel", up);
    });
  });
  onInput.addEventListener("change", () => {
    state.on = onInput.checked;
    body.style.display = state.on ? "block" : "none";
    emit();
  });
  root.querySelector(".vc-swatch--sm").addEventListener("click", (e) => {
    e.stopPropagation();
    beginStyleUndo();
    openColorPopover(root.querySelector(".vc-swatch--sm"), state.color, (css) => {
      state.color = css;
      colorFill.style.background = css;
      emit();
    });
  });
  function setDisplay() {
    parseRaw();
    onInput.checked = state.on;
    body.style.display = state.on ? "block" : "none";
    colorFill.style.background = state.color;
    root.querySelectorAll(".vc-track--sm").forEach((tr) => {
      const i = +tr.dataset.ax;
      const min = RANGE[i][0], max = RANGE[i][1];
      const p = ((valOf(i) - min) / (max - min)) * 100;
      tr.querySelector(".vc-knob").style.left = p + "%";
      tr.querySelector(".vc-fill").style.width = p + "%";
    });
  }
  setDisplay();
  return { el: root, refresh: () => setDisplay() };
}

function makeVisualControl(data, def) {
  if (def.kind === "color") return makeColorControl(data, def);
  if (def.kind === "align") return makeAlignControl(data, def);
  if (def.kind === "shadow") return makeShadowControl(data, def);
  if (def.kind === "imageTransform") return makeImageTransformControl(data, def);
  return makeSliderControl(data, def);
}

// ── Image controls (Style editor) ──
// Scale & position sliders write a single `transform` value so the image rule
// stays one declaration. `none`, "translate(...) scale(...)" strings and
// computed "matrix(...)" values are all understood.

function parseTransformCss(css) {
  const state = { x: 0, y: 0, scale: 100, rot: 0, hasRot: false };
  if (!css || css === "none") return state;
  const trm = /translate3d\(([^)]+)\)|translate\(([^)]+)\)/.exec(css);
  if (trm) {
    const parts = (trm[1] || trm[2]).split(",").map((s) => parseFloat(s));
    state.x = isFinite(parts[0]) ? parts[0] : 0;
    state.y = isFinite(parts[1]) ? parts[1] : 0;
  }
  const sm = /scale(?:X|Y|3d)?\(([^)]+)\)/.exec(css);
  if (sm) {
    const sx = parseFloat(sm[1].split(",")[0]);
    if (isFinite(sx)) state.scale = sx * 100;
  }
  const rm = /rotate(?:Z)?\(([^)]+)\)/.exec(css);
  if (rm) {
    const r = parseFloat(rm[1]);
    if (isFinite(r)) { state.rot = r; state.hasRot = true; }
  }
  const m = /matrix\(([^)]+)\)/.exec(css);
  if (m) {
    const p = m[1].split(",").map((s) => parseFloat(s));
    if (p.length >= 6) {
      state.x = p[4] || 0;
      state.y = p[5] || 0;
      const sx = Math.hypot(p[0], p[1]);
      if (sx > 0.001) state.scale = sx * 100;
    }
  }
  return state;
}

function makeImageTransformControl(data, def) {
  const ROWS = [
    { name: "Scale", min: 10, max: 300, step: 1, fmt: (v) => Math.round(v) + "%", get: (s) => s.scale, set: (s, v) => { s.scale = v; } },
    { name: "X", min: -400, max: 400, step: 1, fmt: (v) => Math.round(v) + "px", get: (s) => s.x, set: (s, v) => { s.x = v; } },
    { name: "Y", min: -400, max: 400, step: 1, fmt: (v) => Math.round(v) + "px", get: (s) => s.y, set: (s, v) => { s.y = v; } },
  ];
  const root = document.createElement("div");
  root.className = "vc vc-image-transform";
  root.innerHTML =
    `<div class="vc-head"><span class="vc-icon">${ICONS[def.icon] || ""}</span><span class="vc-label">${def.label}</span><span class="vc-value"></span></div>` +
    `<div class="vc-shadow-body">` +
    ROWS.map((r, i) => `<div class="vc-shadow-row"><span class="vc-shadow-name">${r.name}</span><div class="vc-track vc-track--sm" data-ax="${i}"><div class="vc-fill"></div><div class="vc-knob"></div></div><span class="vc-shadow-val" data-val="${i}"></span></div>`).join("") +
    `</div>`;
  const valEl = root.querySelector(".vc-value");
  const state = parseTransformCss(readValue(data, def.css));
  let current = { ...state };
  function rend() {
    ROWS.forEach((r, i) => {
      const tr = root.querySelector(`.vc-track--sm[data-ax="${i}"]`);
      const v = Math.max(r.min, Math.min(r.max, r.get(state)));
      const p = ((v - r.min) / (r.max - r.min)) * 100;
      tr.querySelector(".vc-knob").style.left = p + "%";
      tr.querySelector(".vc-fill").style.width = p + "%";
      const vl = root.querySelector(`.vc-shadow-val[data-val="${i}"]`);
      vl.textContent = r.fmt(v);
    });
    valEl.textContent = `${Math.round(state.scale)}% · x${state.x} · y${state.y}`;
  }
  function emit() {
    let t = `translate(${Math.round(state.x)}px, ${Math.round(state.y)}px)`;
    if (state.hasRot) t += ` rotate(${state.rot}deg)`;
    t += ` scale(${(state.scale / 100).toFixed(4)})`;
    applyVisualProp(data, def.css, t);
    rend();
  }
  root.querySelectorAll(".vc-track--sm").forEach((tr) => {
    const i = +tr.dataset.ax;
    const r = ROWS[i];
    function fromEvent(e) {
      const rect = tr.getBoundingClientRect();
      const v = r.min + ((e.clientX - rect.left) / Math.max(rect.width, 1)) * (r.max - r.min);
      return r.min + Math.round((Math.max(r.min, Math.min(r.max, v)) - r.min) / r.step) * r.step;
    }
    tr.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      current = { ...state };
      tr.setPointerCapture(e.pointerId);
      beginStyleUndo();
      r.set(state, fromEvent(e));
      emit();
      const mv = (ev) => { r.set(state, fromEvent(ev)); emit(); };
      const up = (ev) => {
        tr.releasePointerCapture(ev.pointerId);
        tr.removeEventListener("pointermove", mv);
        tr.removeEventListener("pointerup", up);
        tr.removeEventListener("pointercancel", up);
        endStyleUndo();
      };
      tr.addEventListener("pointermove", mv);
      tr.addEventListener("pointerup", up);
      tr.addEventListener("pointercancel", up);
    });
  });
  rend();
  return {
    el: root,
    refresh: () => {
      const next = parseTransformCss(readValue(data, def.css));
      state.x = next.x; state.y = next.y; state.scale = next.scale; state.rot = next.rot; state.hasRot = next.hasRot;
      rend();
    },
  };
}

// Map a preview <img> src back to its repo-relative path. Null when the image
// is not a repo asset (external URL, data:/blob:, /api/...).
function repoPathFromSrc(src) {
  if (!src || typeof src !== "string") return null;
  if (/^(data:|blob:)/.test(src)) return null;
  if (/^https?:\/\//i.test(src)) return null;
  let p = src;
  if (p.startsWith("/repo/")) {
    p = p.slice("/repo/".length);
  } else if (p.startsWith("/api/")) {
    return null;
  } else if (!p.startsWith("/")) {
    return null;
  } else {
    p = p.slice(1);
  }
  p = p.split("?")[0].split("#")[0];
  if (!p || p.split("/").some((s) => s === "..")) return null;
  return p;
}

// Gallery art lives under art-like paths; those are managed by the Art Data
// tab, so surface them as not replaceable here rather than overwriting them.
function isArtImagePath(path) {
  return /(^|\/)(art|projects|details)(\/|$)/.test(path) || /(\/large\/|\/thumbs\/|\/full\/)/.test(path);
}

// Reads a picked file for upload. When the file's format differs from the
// target path's extension, it is re-encoded via canvas so the repo file keeps
// a matching extension (otherwise GitHub would serve the wrong MIME type).
function fileToUploadBytes(file, targetExt) {
  return new Promise((resolve, reject) => {
    const direct = targetExt === "jpg" ? "jpeg" : targetExt;
    const fileExt = (file.type || "").toLowerCase().replace("image/", "");
    const sameType = fileExt === targetExt || (fileExt === "jpg" && targetExt === "jpeg");
    if (sameType || !["png", "jpeg", "webp"].includes(direct)) {
      const fr = new FileReader();
      fr.onload = () => resolve({ dataURL: fr.result, preview: fr.result, converted: false });
      fr.onerror = () => reject(new Error("Could not read the selected file"));
      fr.readAsDataURL(file);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        const mime = direct === "png" ? "image/png" : direct === "webp" ? "image/webp" : "image/jpeg";
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) return reject(new Error("Could not convert the image"));
          const fr = new FileReader();
          fr.onload = () => resolve({ dataURL: fr.result, preview: canvas.toDataURL(), converted: true });
          fr.onerror = () => reject(new Error("Could not read the converted image"));
          fr.readAsDataURL(blob);
        }, mime, 0.92);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not convert the image"));
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read the selected file")); };
    img.src = url;
  });
}

function safeText(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A deterministic per-page file name for an image copy, e.g.
// personal/pfp.png on Home -> img/pfp-home.png. Copies live in the site's
// img/ directory so every page can keep — and later replace — its own image.
function perPageImagePath(repoPath, pageKey) {
  const ext = (repoPath.split(".").pop() || "").toLowerCase();
  const stem = (repoPath.split("/").pop() || "image").replace(/\.[^.]+$/, "");
  const clean = stem.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^\.+/, "") || "image";
  return `img/${clean}-${pageKey}.${ext}`;
}

// Replacing an image that already has a per-page copy targets that same copy,
// so replacing one page's image again overwrites its own file rather than
// piling up new files.
function perPageReplaceTarget(repoPath, pageKey) {
  if (repoPath.startsWith("img/")) {
    const re = new RegExp(`^img/(.+-${escapeRegExp(pageKey)})\\.[a-z0-9]+$`);
    if (re.test(repoPath)) return repoPath;
  }
  return perPageImagePath(repoPath, pageKey);
}

async function fetchRawPage(path) {
  const res = await fetch("/api/raw?path=" + encodeURIComponent(path));
  if (!res.ok) return null;
  const blob = await res.json();
  if (!blob || typeof blob.content !== "string") return null;
  try {
    const bytes = Uint8Array.from(atob(blob.content), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch (e) {
    return null;
  }
}

// Rewrites every reference to repoPath inside a page's HTML so it points at
// the per-page copy. Handles absolute (/img/x.png), relative (img/x.png) and
// ../-prefixed references, preserving any query/hash that follows the path.
// Returns the updated HTML (or the original unchanged if nothing matched).
function rewriteRepoSrc(html, repoPath, newPath) {
  const esc = escapeRegExp(repoPath);
  const re = new RegExp("((?:src|href|poster|data-src)\\s*=\\s*[\"'])((?:/|\\.\\./)*)" + esc + "([^\"'\\s]*)([\"'])", "g");
  return html.replace(re, (m, pre, lead, rest, q) => `${pre}/${newPath}${rest}${q}`);
}

// Stages a replacement so it is pushed with the normal Save button:
//  - the new image goes to a deterministic per-page copy under img/ (or
//    overwrites in place when there is no page context), and
//  - the current page's own HTML is rewritten to reference that copy, so
//    other pages keep their original image untouched.
async function stageImageReplacement({ repoPath, dataURL, converted, targetExt, pageKey, page }) {
  const data64 = dataURL.split(",")[1];
  if (!page || !pageKey) {
    pendingImageUploads = pendingImageUploads.filter((f) => f.path !== repoPath);
    pendingImageUploads.push({ kind: "img", path: repoPath, content: data64, encoding: "base64" });
    return {
      note: converted
        ? `Image staged to replace ${repoPath} (re-encoded to ${targetExt.toUpperCase()}).`
        : `Image staged to replace ${repoPath}.`,
      pageEdited: false,
    };
  }
  const newPath = perPageReplaceTarget(repoPath, pageKey);
  pendingImageUploads = pendingImageUploads.filter((f) => f.kind === "img" && f.path !== newPath);
  pendingImageUploads.push({ kind: "img", path: newPath, content: data64, encoding: "base64" });

  let pageEdited = false;
  const pagePath = page.path;
  try {
    const idx = pendingImageUploads.findIndex((f) => f.kind === "page" && f.path === pagePath);
    let html = idx >= 0 ? pendingImageUploads[idx].content : await fetchRawPage(pagePath);
    if (html == null) throw new Error("could not read page HTML");
    const next = rewriteRepoSrc(html, repoPath, newPath);
    if (next !== html) {
      pendingImageUploads[idx >= 0 ? idx : pendingImageUploads.length] = {
        kind: "page",
        path: pagePath,
        content: next,
        encoding: "utf8",
      };
      pageEdited = true;
    }
  } catch (e) {
    // The image is still staged; the page HTML just won't be rewritten.
  }
  const isCopy = repoPath !== newPath;
  let note = converted
    ? `Image staged (re-encoded to ${targetExt.toUpperCase()}).`
    : `Image staged.`;
  if (pageEdited) {
    note = isCopy
      ? `Image staged as copy for ${page.label} only → ${newPath}. Page HTML updated; other pages keep their image.`
      : `Image staged as replacement for this page's copy (${newPath}).`;
  } else if (isCopy) {
    note = `Image staged as copy for ${page.label} only → ${newPath}. Page HTML wasn't updated — this image may be added by script or referenced elsewhere.`;
  } else {
    note = `Image staged as replacement for this page's copy (${newPath}).`;
  }
  return { note, pageEdited };
}

// "Replace image" card shown under the scale & position sliders for any <img>
// element. Staging the file enables the normal Save to GitHub button, which
// pushes a per-page copy into img/ and rewrites this page's HTML so the other
// pages keep their current image.
function renderImageReplace(data, container) {
  let src = data.attrs && data.attrs.src;
  const stored = selectedPreviewEl && selectedPreviewEl.getAttribute("data-si-src");
  if (stored && !repoPathFromSrc(src)) src = stored;
  const repoPath = repoPathFromSrc(src);
  const art = repoPath ? isArtImagePath(repoPath) : false;
  const el = document.createElement("div");
  el.className = "img-replace";
  let inner;
  if (src) {
    const note = art
      ? "Art gallery image — manage it in the Art Data tab."
      : repoPath
        ? "Save will copy this image into the site's img/ folder for this page only — other pages keep the current image."
        : "This image is external — replace via its source URL.";
    inner =
      `<div class="img-replace-thumb"><img src="${safeText(src)}" alt="" /></div>` +
      `<div class="img-replace-meta">` +
      `<div class="img-replace-path">${repoPath ? "/" + safeText(repoPath) : safeText(src)}</div>` +
      `<div class="img-replace-note">${note}</div>` +
      `</div>` +
      `<div class="img-replace-btn-wrap"><button type="button" class="secondary-btn img-replace-btn">Replace…</button></div>`;
  } else {
    inner = `<div class="img-replace-meta"><div class="img-replace-note">No image source.</div></div>`;
  }
  el.innerHTML = `<div class="img-replace-head">${inner}</div><input type="file" class="img-replace-file" accept="image/*" hidden />`;
  container.appendChild(el);

  const btn = el.querySelector(".img-replace-btn");
  const fileInput = el.querySelector(".img-replace-file");
  if (!fileInput) return;
  if (art || !repoPath) {
    if (btn) {
      btn.disabled = true;
      btn.title = art ? "Gallery images are managed in the Art Data tab" : "This image is not stored in the site repo";
    }
    return;
  }

  btn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    const status = document.getElementById("styleStatus");
    const pristine = inspectedElRef ? inspectedElRef.getAttribute("src") : null;
    btn.disabled = true;
    try {
      const targetExt = (repoPath.split(".").pop() || "").toLowerCase();
      const { dataURL, preview, converted } = await fileToUploadBytes(file, targetExt);
      const pageKey = currentPageKey();
      const page = PAGES.find((p) => p.key === pageKey);
      const staged = await stageImageReplacement({ repoPath, dataURL, converted, targetExt, pageKey, page });
      if (inspectedElRef) {
        inspectedElRef.src = preview;
        inspectedElRef.setAttribute("data-si-src", "/" + repoPath);
      }
      const thumb = el.querySelector(".img-replace-thumb img");
      if (thumb) thumb.src = preview;
      updateStyleSave();
      status.textContent = staged.note + " Press Save to GitHub.";
      status.className = "status-msg success";
    } catch (e) {
      if (inspectedElRef && pristine) inspectedElRef.src = pristine;
      status.textContent = `Error: ${e.message}`;
      status.className = "status-msg error";
    } finally {
      btn.disabled = false;
    }
  });
}

function buildVisualControls(data) {
  for (const g of VISUAL_GROUPS) {
    document.getElementById(g.id).innerHTML = "";
  }
  visualControls.length = 0;
  for (const g of VISUAL_GROUPS) {
    for (const def of g.props) {
      if (def.tags && def.tags.indexOf(data.tag) === -1) continue;
      const ctl = makeVisualControl(data, def);
      visualControls.push(ctl);
      document.getElementById(g.id).appendChild(ctl.el);
    }
  }
  if (data.tag === "img") {
    renderImageReplace(data, document.getElementById("propImage"));
  }
  refreshVisualControls(data);
}

function renderInspectorMatches(data) {
  const matches = styleBlocks
    .filter((b) => blockMatchesElementData(b, data))
    .sort((a, b) => getMatchPriority(a, data) - getMatchPriority(b, data));

  const matchBox = document.getElementById("inspectorMatches");
  if (!matchBox) return;
  matchBox.innerHTML = "";
  if (!matches.length) {
    const note = document.createElement("div");
    note.className = "inspector-note";
    note.textContent = "No rules apply yet — changes below create a new rule.";
    matchBox.appendChild(note);
  }
  for (const b of matches) {
    const chip = document.createElement("div");
    chip.className = "style-rule-prelude apply-chip";
    const label = document.createElement("span");
    label.className = "apply-chip-label";
    const scopedPage = pageScopeOfRule(b);
    label.textContent = scopedPage
      ? `${b.prelude}  ·  ${PAGES.find((p) => p.key === scopedPage) ? PAGES.find((p) => p.key === scopedPage).label : scopedPage} only`
      : b.prelude;
    label.title = "Open in Rules & Code";
    label.addEventListener("click", () => {
      switchInspectorTab("elements");
      const filter = document.getElementById("styleFilter");
      filter.value = data.primary;
      renderStyleList();
    });
    chip.appendChild(label);
    const del = document.createElement("button");
    del.className = "apply-chip-del";
    del.textContent = "×";
    del.title = "Remove this rule (restoreable via Undo)";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removeStyleBlock(b, data);
    });
    chip.appendChild(del);
    matchBox.appendChild(chip);
  }
}

function renderInspector(data) {
  inspected = data;
  document.getElementById("inspectorEmpty").style.display = "none";
  document.getElementById("inspectorContent").hidden = false;

  const summary = document.getElementById("inspectorSummary");
  summary.innerHTML = "";
  const tag = document.createElement("span");
  tag.className = "inspector-tag";
  tag.textContent = data.tag;
  summary.appendChild(tag);
  if (data.id) {
    const id = document.createElement("span");
    id.className = "inspector-chip";
    id.textContent = `#${data.id}`;
    summary.appendChild(id);
  }
  for (const c of data.classes) {
    const chip = document.createElement("span");
    chip.className = "inspector-chip";
    chip.textContent = `.${c}`;
    summary.appendChild(chip);
  }
  const path = document.createElement("div");
  path.className = "inspector-path";
  path.textContent = data.path || "";
  summary.appendChild(path);

  const scopeSel = document.getElementById("editScope");
  if (scopeSel) scopeSel.value = editScopePref;
  const scopeNote = document.querySelector(".inspector-scope-note");
  if (scopeNote) {
    scopeNote.textContent = editScopePref === "page"
      ? `Changes below add a scoped rule for ${currentPageLabel()} only, so other pages keep their own look.`
      : "Changes below edit the shared rule, so they apply on every page.";
  }
  const stateSel = document.getElementById("editState");
  if (stateSel) stateSel.value = editStatePref;
  const stateNote = document.getElementById("inspectorStateNote");
  if (stateNote) {
    const pseudo = statePseudoOf(editStatePref);
    stateNote.textContent = pseudo
      ? `Editing the ${ELEMENT_STATES.find((s) => s.key === editStatePref).label.toLowerCase()} state — changes write a "${pseudo}" rule that applies only while that state is active.`
      : "Editing the normal state — these are the element's default styles.";
  }

  renderInspectorMatches(data);

  populateAttachSelect("");
  document.getElementById("newRuleSel").value = data.primary + (statePseudoOf(editStatePref) || "");
  const imageTitle = document.getElementById("inspectorImageTitle");
  if (imageTitle) imageTitle.style.display = data.tag === "img" ? "" : "none";
  buildVisualControls(data);
}

function attachToRule(data) {
  const sel = document.getElementById("attachSelect").value;
  if (!sel) return;
  const block = styleBlocks.find((b) => b.type === "rule" && b.prelude.trim() === sel);
  if (!block) return;
  const blockPage = pageScopeOfRule(block);
  if (blockPage && blockPage !== currentPageKey()) {
    const pg = PAGES.find((p) => p.key === blockPage);
    const status = document.getElementById("styleStatus");
    status.textContent = `That rule only applies on ${pg ? pg.label : blockPage}. Switch to that page first (or use "This page only" to make a new one).`;
    status.className = "status-msg error";
    return;
  }
  const tokens = selectorTokens(block.prelude);
  const target = data.primary;
  if (target.startsWith("#") ? tokens.ids.has(target) : target.startsWith(".") ? tokens.classes.has(target) : tokens.tags.has(target)) {
    const status = document.getElementById("styleStatus");
    status.textContent = `Element already covered by ${sel}`;
    status.className = "status-msg error";
    return;
  }
  block.prelude = block.prelude.trim() + ", " + target;
  block.edited = true;
  styleDirty = true;
  updateStyleSave();
  injectEditorCss(getPreviewDoc());
  renderInspector(data);
  renderStyleList();
}

function addNewRule(data) {
  const raw = document.getElementById("newRuleSel").value.trim() || data.primary;
  let target = raw;
  const pseudo = statePseudoOf(editStatePref);
  if (pseudo && !target.endsWith(pseudo)) target = target + pseudo;
  const sel = editScopeNow() === "all" ? target : scopedSelector(target);
  const exists = styleBlocks.some((b) => b.type === "rule" && b.prelude.trim() === sel);
  if (exists) {
    const status = document.getElementById("styleStatus");
    status.textContent = `A rule for ${sel} already exists`;
    status.className = "status-msg error";
    return;
  }
  styleBlocks.push({
    type: "rule",
    prelude: sel,
    inner: "\n",
    raw: "",
    edited: true,
    decls: [],
  });
  styleDirty = true;
  updateStyleSave();
  injectEditorCss(getPreviewDoc());
  renderInspector(data);
  renderStyleList();
}

function openPasteModal() {
  document.getElementById("pasteInput").value = "";
  document.getElementById("pasteOverlay").style.display = "flex";
  document.getElementById("pasteInput").focus();
}

function closePasteModal() {
  document.getElementById("pasteOverlay").style.display = "none";
}

function parsePastedHtml() {
  const raw = document.getElementById("pasteInput").value;
  if (!raw.trim()) return;
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, "text/html");
  const els = doc.body ? doc.body.querySelectorAll("*") : [];
  const added = new Set();
  let count = 0;
  let firstIdx = pastedElements.length;
  for (const el of els) {
    const data = elementData(el);
    data.path = selectorPath(el);
    data.html = el.outerHTML;
    const sig = data.tag + (data.id ? "#" + data.id : "") + data.classes.map((c) => "." + c).join("");
    if (added.has(sig)) continue;
    added.add(sig);
    pastedElements.push(data);
    count++;
  }
  if (!count) {
    const status = document.getElementById("styleStatus");
    status.textContent = "No elements found in pasted HTML";
    status.className = "status-msg error";
    return;
  }
  closePasteModal();
  document.getElementById("pastedStrip").hidden = false;
  renderPasted();
  renderPastedIntoPreview();
  switchInspectorTab("inspect");
  inspectPasted(pastedElements[firstIdx]);
  const status = document.getElementById("styleStatus");
  status.textContent = `${count} elements added from pasted HTML (temporary)`;
  status.className = "status-msg success";
}

function inspectPasted(data) {
  switchInspectorTab("inspect");
  const doc = getPreviewDoc();
  if (doc) {
    doc.querySelectorAll(".si-selected").forEach((n) => n.classList.remove("si-selected"));
  }
  if (selectedPreviewEl) selectedPreviewEl.classList.remove("si-selected");
  selectedPreviewEl = null;
  inspectedElRef = data.elNode || null;
  if (data.elNode) data.elNode.classList.add("si-selected");
  renderInspector(data);
}

function renderPastedIntoPreview() {
  const doc = getPreviewDoc();
  if (!doc) return;
  let stage = doc.getElementById("si-paste-stage");
  if (!stage) {
    stage = doc.createElement("div");
    stage.id = "si-paste-stage";
    doc.body.appendChild(stage);
  }
  stage.innerHTML = "";
  for (const p of pastedElements) {
    const wrap = doc.createElement("div");
    wrap.className = "si-paste-item";
    const tpl = doc.createElement("template");
    tpl.innerHTML = p.html || "";
    const node = tpl.content.firstElementChild;
    wrap.appendChild(node || doc.createTextNode(""));
    p.elNode = node && node.nodeType === 1 ? node : null;
    if (p.elNode) {
      p.elNode.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        inspectPasted(p);
      }, true);
    }
    stage.appendChild(wrap);
  }
}

function renderPasted() {
  const chips = document.getElementById("pastedChips");
  chips.innerHTML = "";
  pastedElements.forEach((data, i) => {
    const chip = document.createElement("button");
    chip.className = "pasted-chip";
    chip.innerHTML = `<span class="inspector-tag">${escapeHtml(data.tag)}</span>${data.id ? `<span class="inspector-chip">#${escapeHtml(data.id)}</span>` : ""}${data.classes.length ? `<span class="inspector-chip">.${escapeHtml(data.classes.join("."))}</span>` : ""}`;
    chip.title = data.path || "";
    chip.addEventListener("click", () => inspectPasted(data));
    chips.appendChild(chip);
  });
}

function loadPreviewPage(path) {
  const frame = document.getElementById("sitePreview");
  if (!frame) return;
  clearPreviewSelection(frame.contentDocument);
  inspected = null;
  inspectedElRef = null;
  document.getElementById("inspectorContent").hidden = true;
  document.getElementById("inspectorEmpty").style.display = "block";
  frame.src = `/repo/${path}`;
}

// ── Radial color picker ──

function wheelRgb() {
  return hslToRgb(colorWheelH, colorWheelS, colorWheelV * 0.5);
}

function renderColorWheel() {
  const cv = document.getElementById("colorWheel");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, R = W / 2;
  const img = ctx.createImageData(W, W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - R + 0.5, dy = y - R + 0.5;
      const r = Math.hypot(dx, dy);
      const i = (y * W + x) * 4;
      if (r > R) { img.data[i + 3] = 0; continue; }
      const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const s = Math.min(r / R, 1);
      const { r: rr, g: gg, b: bb } = hslToRgb(h, s, colorWheelV * 0.5);
      img.data[i] = rr; img.data[i + 1] = gg; img.data[i + 2] = bb; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const bright = document.getElementById("colorBright");
  if (bright) {
    const { h, s } = { h: colorWheelH, s: colorWheelS };
    bright.style.background = `linear-gradient(to right, #000, hsl(${h}, ${Math.round(s * 100)}%, 50%))`;
  }
  renderAlphaTrack();
}

function emitWheelColor() {
  const { r, g, b } = wheelRgb();
  const a = Math.max(0, Math.min(1, colorWheelA));
  const label = document.getElementById("colorHexLabel");
  if (label) {
    label.textContent = toHex({ r, g, b }) + (a < 1 ? `  ${Math.round(a * 100)}% alpha` : "");
  }
  if (colorPopoverCb) colorPopoverCb(cssColorStr({ r, g, b, a }));
}

function renderAlphaTrack() {
  const track = document.getElementById("colorAlpha");
  if (!track) return;
  const a = Math.max(0, Math.min(1, colorWheelA));
  const { r, g, b } = wheelRgb();
  track.querySelector(".color-alpha-fill").style.width = a * 100 + "%";
  track.querySelector(".color-alpha-knob").style.left = a * 100 + "%";
  track.querySelector(".color-alpha-bg").style.background =
    `linear-gradient(to right, rgba(${r}, ${g}, ${b}, 0), rgba(${r}, ${g}, ${b}, 1))`;
  const val = document.getElementById("colorAlphaVal");
  if (val) val.textContent = Math.round(a * 100) + "%";
}

function openColorPopover(anchor, currentCss, onChange) {
  const pop = document.getElementById("colorPopover");
  if (!pop) return;
  const parsed = parseCssColor(currentCss);
  colorWheelH = 0; colorWheelS = 0; colorWheelV = 1; colorWheelA = 1;
  if (parsed && parsed.a > 0) {
    const { h, s, l } = rgbToHsl(parsed.r, parsed.g, parsed.b);
    colorWheelH = h;
    colorWheelS = s;
    colorWheelV = Math.min(1, l / 0.5);
  }
  if (parsed) colorWheelA = Math.max(0, Math.min(1, parsed.a));
  renderColorWheel();
  const r = anchor.getBoundingClientRect();
  const pw = 216;
  let left = r.left - pw / 2 + r.width / 2;
  let top = r.bottom + 8;
  if (left < 8) left = 8;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + 316 > window.innerHeight) top = r.top - 324;
  pop.style.left = left + "px";
  pop.style.top = top + "px";
  pop.hidden = false;
  colorPopoverCb = onChange;
  emitWheelColor();
}

function closeColorPopover() {
  const pop = document.getElementById("colorPopover");
  if (pop) pop.hidden = true;
  colorPopoverCb = null;
  endStyleUndo();
}

function initColorPopover() {
  const cv = document.getElementById("colorWheel");
  const bright = document.getElementById("colorBright");
  const alpha = document.getElementById("colorAlpha");
  const pop = document.getElementById("colorPopover");
  const hex = document.getElementById("colorHexLabel");
  const clearBtn = document.getElementById("colorClearBtn");

  function wheelFromEvent(e) {
    const r = cv.getBoundingClientRect();
    const R = cv.width / 2;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    colorWheelH = (Math.atan2(y - R, x - R) * 180 / Math.PI + 360) % 360;
    colorWheelS = Math.min(Math.hypot(x - R, y - R) / R, 1);
  }
  cv.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    wheelFromEvent(e);
    renderColorWheel();
    emitWheelColor();
    const mv = (ev) => { wheelFromEvent(ev); renderColorWheel(); emitWheelColor(); };
    const up = (ev) => {
      cv.releasePointerCapture(ev.pointerId);
      cv.removeEventListener("pointermove", mv);
      cv.removeEventListener("pointerup", up);
    };
    cv.addEventListener("pointermove", mv);
    cv.addEventListener("pointerup", up);
  });

  function brightFromEvent(e) {
    const r = bright.getBoundingClientRect();
    colorWheelV = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(r.width, 1)));
  }
  bright.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    bright.setPointerCapture(e.pointerId);
    brightFromEvent(e);
    renderColorWheel();
    emitWheelColor();
    const mv = (ev) => { brightFromEvent(ev); renderColorWheel(); emitWheelColor(); };
    const up = (ev) => {
      bright.releasePointerCapture(ev.pointerId);
      bright.removeEventListener("pointermove", mv);
      bright.removeEventListener("pointerup", up);
    };
    bright.addEventListener("pointermove", mv);
    bright.addEventListener("pointerup", up);
  });

  function alphaFromEvent(e) {
    const r = alpha.getBoundingClientRect();
    colorWheelA = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(r.width, 1)));
  }
  alpha.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    alpha.setPointerCapture(e.pointerId);
    alphaFromEvent(e);
    renderAlphaTrack();
    emitWheelColor();
    const mv = (ev) => { alphaFromEvent(ev); renderAlphaTrack(); emitWheelColor(); };
    const up = (ev) => {
      alpha.releasePointerCapture(ev.pointerId);
      alpha.removeEventListener("pointermove", mv);
      alpha.removeEventListener("pointerup", up);
    };
    alpha.addEventListener("pointermove", mv);
    alpha.addEventListener("pointerup", up);
  });

  clearBtn.addEventListener("click", () => {
    if (colorPopoverCb) colorPopoverCb("transparent");
    closeColorPopover();
  });

  const eyedropBtn = document.getElementById("colorEyedropBtn");
  if (eyedropBtn) {
    eyedropBtn.addEventListener("click", () => {
      try {
        if (window.EyeDropper && !navigator.webdriver) {
          const ed = new window.EyeDropper();
          ed.open()
            .then((res) => {
              if (res && res.sRGBHex) {
                applyPickedColor(res.sRGBHex);
                eyedropBtn.classList.remove("active");
              }
            })
            .catch(() => {});
          return;
        }
      } catch (_) {}
      beginPipette();
    });
  }

  document.addEventListener("mousedown", (e) => {
    if (pipetteActive) endPipette();
    if (pop.hidden) return;
    if (!pop.contains(e.target)) closeColorPopover();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) closeColorPopover();
  });
  if (hex) hex.hidden = true;
}

// ── Screen color eyedropper ──

let pipetteActive = false;
let pipetteHandlers = null;
let pipetteDoc = null;
let ignoreNextPreviewClick = false;

function applyPickedColor(cssStr) {
  const parsed = parseCssColor(cssStr);
  if (parsed) {
    const { h, s, l } = rgbToHsl(parsed.r, parsed.g, parsed.b);
    colorWheelH = h;
    colorWheelS = s;
    colorWheelV = Math.min(1, l / 0.5);
    colorWheelA = Math.max(0, Math.min(1, parsed.a));
    renderColorWheel();
    renderAlphaTrack();
    emitWheelColor();
  }
}

function samplePreviewColor(doc, x, y) {
  const win = doc.defaultView;
  let node = null;
  try { node = doc.elementFromPoint(x, y); } catch (_) {}
  while (node && node.nodeType === 1) {
    const cs = win.getComputedStyle(node);
    const bg = cs.backgroundColor;
    const parsed = parseCssColor(bg);
    if (parsed && parsed.a > 0.001) return bg;
    if (node === doc.documentElement || node === doc.body) break;
    node = node.parentElement;
  }
  const bodyBg = win.getComputedStyle(doc.body || doc.documentElement).backgroundColor;
  if (parseCssColor(bodyBg) && parseCssColor(bodyBg).a > 0.001) return bodyBg;
  return "rgb(0, 0, 0)";
}

const PIPETTE_CSS =
  "html.si-pipette-active{cursor:crosshair!important}" +
  "#si-pipette{position:fixed;z-index:2147483000;width:36px;height:36px;border-radius:50%;" +
  "border:2px solid rgba(255,255,255,.9);box-shadow:0 0 0 1px rgba(0,0,0,.5),0 0 14px rgba(0,0,0,.55);" +
  "pointer-events:none;transform:translate(-50%,-50%)}" +
  "#si-pipette .si-pipette-inner{position:absolute;inset:2px;border-radius:50%}";

function beginPipette() {
  const doc = getPreviewDoc();
  if (!doc || pipetteActive) return;
  pipetteActive = true;
  pipetteDoc = doc;
  if (!doc.getElementById("si-pipette-css")) {
    const st = doc.createElement("style");
    st.id = "si-pipette-css";
    st.textContent = PIPETTE_CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }
  let ring = doc.getElementById("si-pipette");
  if (!ring) {
    ring = doc.createElement("div");
    ring.id = "si-pipette";
    ring.innerHTML = '<div class="si-pipette-inner"></div>';
    (doc.body || doc.documentElement).appendChild(ring);
  }
  ring.style.left = "-100px";
  ring.style.top = "-100px";
  ring.style.display = "block";
  ring.querySelector(".si-pipette-inner").style.background = "";
  if (doc.documentElement) doc.documentElement.classList.add("si-pipette-active");
  const btn = document.getElementById("colorEyedropBtn");
  if (btn) btn.classList.add("active");

  function move(e) {
    e.stopPropagation();
    ring.style.left = e.clientX + "px";
    ring.style.top = e.clientY + "px";
    try {
      ring.querySelector(".si-pipette-inner").style.background = samplePreviewColor(doc, e.clientX, e.clientY);
    } catch (_) {}
  }
  function pick(e) {
    if (e.button === 2) { endPipette(); return; }
    e.preventDefault();
    e.stopPropagation();
    ignoreNextPreviewClick = true;
    applyPickedColor(samplePreviewColor(doc, e.clientX, e.clientY));
    endPipette();
  }
  function cancel(e) {
    if (e.type === "keydown" || e.button === 2) endPipette();
  }
  doc.addEventListener("pointermove", move, true);
  doc.addEventListener("pointerdown", pick, true);
  doc.addEventListener("contextmenu", cancel);
  doc.addEventListener("keydown", cancel);
  pipetteHandlers = { move, pick, cancel };
}

function endPipette() {
  if (!pipetteActive) return;
  pipetteActive = false;
  const doc = pipetteDoc;
  pipetteDoc = null;
  if (pipetteHandlers) {
    doc.removeEventListener("pointermove", pipetteHandlers.move, true);
    doc.removeEventListener("pointerdown", pipetteHandlers.pick, true);
    doc.removeEventListener("contextmenu", pipetteHandlers.cancel);
    doc.removeEventListener("keydown", pipetteHandlers.cancel);
    pipetteHandlers = null;
  }
  if (doc) {
    if (doc.documentElement) doc.documentElement.classList.remove("si-pipette-active");
    const ring = doc.getElementById("si-pipette");
    if (ring) ring.style.display = "none";
  }
  const btn = document.getElementById("colorEyedropBtn");
  if (btn) btn.classList.remove("active");
}

function toggleStyleValues() {
  showStyleValues = !showStyleValues;
  document.body.classList.toggle("show-values", showStyleValues);
  document.getElementById("styleValuesBtn").classList.toggle("active", showStyleValues);
  refreshVisualControls(inspected);
}

function initStyleTab() {
  document.querySelectorAll(".app-tab").forEach((t) => {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  });
  document.getElementById("styleSaveBtn").addEventListener("click", saveStyle);
  document.getElementById("styleUndoBtn").addEventListener("click", undoStyle);
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
    const t = e.target;
    if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT")) return;
    if (!document.getElementById("panel-style").classList.contains("tab-panel--active")) return;
    e.preventDefault();
    undoStyle();
  });
  document.getElementById("styleFilter").addEventListener("input", renderStyleList);
  document.getElementById("styleValuesBtn").addEventListener("click", toggleStyleValues);
  document.getElementById("refreshElementsBtn").addEventListener("click", async () => {
    const status = document.getElementById("styleStatus");
    status.textContent = "Rescanning site elements...";
    status.className = "status-msg";
    try {
      await loadStyleElements();
      renderStyleList();
      status.textContent = `${getStyleElements().length} elements scanned`;
      status.className = "status-msg success";
    } catch (e) {
      status.textContent = `Error: ${e.message}`;
      status.className = "status-msg error";
    }
  });

  const preview = document.getElementById("sitePreview");
  preview.addEventListener("load", wirePreviewInspector);
  window.addEventListener("resize", scheduleTransformWidget);
  if (preview.contentDocument && preview.contentDocument.readyState === "complete") wirePreviewInspector();
  document.getElementById("previewPage").addEventListener("change", (e) => {
    loadPreviewPage(e.target.value);
    renderStyleList();
  });
  const editScope = document.getElementById("editScope");
  if (editScope) {
    editScope.value = editScopePref;
    editScope.addEventListener("change", () => {
      editScopePref = editScope.value;
      if (inspected) {
        renderInspector(inspected);
        injectEditorCss(getPreviewDoc());
      }
    });
  }
  const editState = document.getElementById("editState");
  if (editState) {
    editState.value = editStatePref;
    editState.addEventListener("change", () => {
      editStatePref = editState.value;
      if (inspected) renderInspector(inspected);
    });
  }
  const pageFilter = document.getElementById("stylePageFilter");
  if (pageFilter) pageFilter.addEventListener("change", renderStyleList);

  document.querySelectorAll(".inspector-tab").forEach((t) => {
    t.addEventListener("click", () => switchInspectorTab(t.dataset.itab));
  });
  document.getElementById("attachBtn").addEventListener("click", () => inspected && attachToRule(inspected));
  document.getElementById("newRuleBtn").addEventListener("click", () => inspected && addNewRule(inspected));

  document.getElementById("pasteHtmlBtn").addEventListener("click", openPasteModal);
  document.getElementById("pasteCloseBtn").addEventListener("click", closePasteModal);
  document.getElementById("pasteOverlayBg").addEventListener("click", closePasteModal);
  document.getElementById("pasteParseBtn").addEventListener("click", parsePastedHtml);

  const styleMotionBtn = document.getElementById("styleMotionBtn");
  if (styleMotionBtn) styleMotionBtn.addEventListener("click", toggleStyleMotion);
  const outlinerCollapseBtn = document.getElementById("outlinerCollapseBtn");
  const outlinerPanel = document.getElementById("outliner");
  if (outlinerCollapseBtn && outlinerPanel) {
    outlinerCollapseBtn.addEventListener("click", () => {
      outlinerCollapsed = !outlinerCollapsed;
      outlinerPanel.classList.toggle("collapsed", outlinerCollapsed);
      outlinerCollapseBtn.textContent = outlinerCollapsed ? "+" : "–";
      if (!outlinerCollapsed) renderOutliner(getPreviewDoc());
    });
  }

  initPreviewSplitter();
  initColorPopover();
}

// ── Preview splitter (resize preview to emulate mobile widths) ──

function initPreviewSplitter() {
  const splitter = document.getElementById("previewSplitter");
  const previewCol = document.querySelector(".style-workspace .preview-col");
  const workspace = document.querySelector(".style-workspace");
  const badge = document.getElementById("previewWidthBadge");
  if (!splitter || !previewCol || !workspace) return;
  const KEY = "manager.previewWidth";

  const updateBadge = (w) => {
    if (!badge) return;
    badge.hidden = false;
    badge.textContent = w >= 768 ? `${w}px · desktop` : w >= 480 ? `${w}px · tablet` : `${w}px · mobile`;
  };

  const saved = parseInt(localStorage.getItem(KEY) || "", 10);
  if (saved > 0 && Number.isFinite(saved)) {
    previewCol.style.setProperty("--preview-w", saved + "px");
    updateBadge(saved);
  }

  splitter.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { splitter.setPointerCapture(e.pointerId); } catch (_) {}
    splitter.classList.add("preview-splitter--active");
    const workspaceRect = workspace.getBoundingClientRect();
    const maxW = workspaceRect.width - 340;
    const minW = 220;
    const move = (ev) => {
      const w = Math.round(ev.clientX - workspaceRect.left);
      const clamped = Math.max(minW, Math.min(maxW, w));
      previewCol.style.setProperty("--preview-w", clamped + "px");
      updateBadge(clamped);
    };
    const up = () => {
      splitter.classList.remove("preview-splitter--active");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const w = parseInt(previewCol.style.getPropertyValue("--preview-w"), 10);
      if (Number.isFinite(w) && w > 0) localStorage.setItem(KEY, String(w));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
}

// ── Mobile preview tab (QR + LAN URL for viewing the site on a phone) ──

let mobileTabLoaded = false;
let mobileTabData = null;
const MOBILE_PAGES = [
  ["Home", "home/index.html"],
  ["About", "about/index.html"],
  ["Portfolio", "personal/index.html"],
  ["Game Art", "game-art/index.html"],
];

async function loadMobileUrl() {
  if (mobileTabData) return mobileTabData;
  try {
    const res = await fetch("/api/mobile-url");
    if (res.ok) {
      mobileTabData = await res.json();
      return mobileTabData;
    }
  } catch (_) {}
  mobileTabData = { url: location.origin, ip: location.hostname, port: location.port };
  return mobileTabData;
}

async function renderMobileTab() {
  if (mobileTabLoaded) return;
  const host = document.getElementById("mobileUrl");
  const qrBox = document.getElementById("mobileQr");
  const pages = document.getElementById("mobilePages");
  if (!host || !qrBox || !pages) return;
  mobileTabLoaded = true;

  const info = await loadMobileUrl();
  const base = String(info.url || "").replace(/\/$/, "");
  host.textContent = base;

  const qrUrl = `${base}/repo/home/index.html`;
  if (window.qrcode) {
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(qrUrl);
      qr.make();
      const img = new Image();
      img.style.width = "190px";
      img.style.height = "190px";
      img.alt = "QR code for the live site preview";
      img.src = qr.createDataURL(4, 8);
      img.addEventListener("load", () => { qrBox.textContent = ""; qrBox.appendChild(img); });
    } catch (e) {
      qrBox.textContent = qrUrl;
    }
  } else {
    qrBox.textContent = qrUrl;
  }

  pages.innerHTML = "";
  for (const [label, path] of MOBILE_PAGES) {
    const a = document.createElement("a");
    a.className = "mobile-page-link";
    a.href = `${base}/repo/${path}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = label;
    pages.appendChild(a);
  }

  const copyBtn = document.getElementById("mobileCopyBtn");
  if (copyBtn && !copyBtn.dataset.wired) {
    copyBtn.dataset.wired = "1";
    copyBtn.addEventListener("click", async () => {
      const url = host.textContent;
      try {
        await navigator.clipboard.writeText(url);
      } catch (_) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(host);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("copy");
        sel.removeAllRanges();
      }
      const prev = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => { copyBtn.textContent = prev; }, 1200);
    });
  }
}

// ── Background editor ──

const BG_INDEX_HTML =
`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Background</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<canvas id="water" aria-hidden="true"></canvas>
<script type="module" src="main.js"></script>
</body>
</html>
`;

const BG_STYLE_CSS =
`#water {
  position: fixed;
  inset: 0;
  z-index: -1;
  width: 100vw;
  height: 100vh;
  display: block;
  pointer-events: none;
}
`;

// Runtime engine saved to background/main.js. Must match the editor's preview
// math (renderBgFrame). No backticks or ${} here so it embeds cleanly.
const BG_RUNTIME_JS =
`const canvas = document.getElementById("water");
if (!canvas) throw new Error("water canvas missing");
const ctx = canvas.getContext("2d");
const dpr = Math.min(window.devicePixelRatio || 1, 2);
let width = 0;
let height = 0;
let config = null;
let images = [];
let start = 0;
let last = 0;
let readySent = false;

function resize() {
  width = window.innerWidth * dpr;
  height = window.innerHeight * dpr;
  canvas.width = width;
  canvas.height = height;
}
window.addEventListener("resize", resize);

function valueAt(kf, t) {
  if (!kf || !kf.length) return undefined;
  if (kf.length === 1) return kf[0].v;
  if (t <= kf[0].t) return kf[0].v;
  const n = kf.length - 1;
  if (t >= kf[n].t) return kf[n].v;
  for (let i = 0; i < n; i++) {
    const a = kf[i], b = kf[i + 1];
    if (t >= a.t && t <= b.t) {
      const p = (t - a.t) / Math.max(b.t - a.t, 0.0001);
      return a.v + (b.v - a.v) * p;
    }
  }
  return kf[n].v;
}

function frame(ts) {
  requestAnimationFrame(frame);
  if (!config) return;
  if (!start) start = ts;
  if (!last) last = ts;
  const dt = Math.min((ts - last) / 1000, 0.05);
  last = ts;
  const elapsed = (ts - start) / 1000;
  const dur = Math.max(config.duration || 10, 0.1);
  const t = config.loop === false ? Math.min(elapsed, dur) : elapsed % dur;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = config.color || "#000000";
  ctx.fillRect(0, 0, width, height);
  const layers = config.layers || [];
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    const img = images[li];
    if (L.visible === false || !img || !img.naturalWidth) continue;
    const tracks = L.tracks || {};
    const sx = tracks.x ? (valueAt(tracks.x, t) || 0) : 0;
    const sy = tracks.y ? (valueAt(tracks.y, t) || 0) : 0;
    const sc = (tracks.scale ? (valueAt(tracks.scale, t) || 100) : 100) / 100;
    const rot = ((tracks.rot ? (valueAt(tracks.rot, t) || 0) : 0) * Math.PI) / 180;
    const op = (tracks.op ? valueAt(tracks.op, t) : 100) ?? 100;
    const cover = Math.max(width / img.naturalWidth, height / img.naturalHeight);
    const dw = img.naturalWidth * cover * sc;
    const dh = img.naturalHeight * cover * sc;
    ctx.save();
    ctx.translate(width / 2 + (sx / 100) * width, height / 2 + (sy / 100) * height);
    ctx.rotate(rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, op / 100));
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (!readySent) {
    readySent = true;
    window.dispatchEvent(new Event("waterready"));
  }
}

async function load() {
  const bgPath = document.body.dataset.background || "background.json";
  try {
    const res = await fetch(new URL(bgPath, import.meta.url));
    config = await res.json();
  } catch (e) {
    if (bgPath !== "background.json") {
      try {
        const res = await fetch(new URL("background.json", import.meta.url));
        config = await res.json();
      } catch (e2) {
        config = { color: "#000000", layers: [] };
      }
    } else {
      config = { color: "#000000", layers: [] };
    }
  }
  const layers = config.layers || [];
  images = new Array(layers.length);
  await Promise.all(layers.map((L, i) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { images[i] = img; resolve(); };
    img.onerror = () => resolve();
    img.src = new URL(L.file, import.meta.url).href;
  })));
  resize();
  requestAnimationFrame(frame);
}

load();
`;

const BG_TRACKS = [
  { key: "x", label: "Move X", color: "#4dc9f6", min: -100, max: 100, step: 1, fmt: (v) => Math.round(v) + "%" },
  { key: "y", label: "Move Y", color: "#9b6bf7", min: -100, max: 100, step: 1, fmt: (v) => Math.round(v) + "%" },
  { key: "scale", label: "Size", color: "#f7b04d", min: 10, max: 300, step: 1, fmt: (v) => Math.round(v) + "%" },
  { key: "rot", label: "Spin", color: "#f76b6b", min: -180, max: 180, step: 1, fmt: (v) => Math.round(v) + "°" },
  { key: "op", label: "Fade", color: "#4cf07e", min: 0, max: 100, step: 1, fmt: (v) => Math.round(v) + "%" },
];

const ICON_EYE = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>';
const ICON_EYEOFF = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M3 3l18 18M10.6 6.2A10 10 0 0122 12s-1.6 2.7-4.4 4.6M6.5 7.8A12 12 0 002 12s3.5 6 10 6c1.4 0 2.7-.3 3.8-.8M14.5 9.5a2.5 2.5 0 00-3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_UP = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let bgState = null;
let bgTarget = "main";
let bgImages = {};
let bgPlaying = false;
let bgTime = 0;
let bgLastTs = null;
let bgSelectedLayerId = null;
let bgSelectedKey = null;
let bgDirty = false;
let bgRaf = 0;
let bgShowValues = false;
let bgInitPromise = null;
let bgSuppressClickUntil = 0;

function defaultBgState() {
  return { version: 1, duration: 12, fps: 30, loop: true, color: "#05141f", layers: [] };
}

function defaultTracks() {
  return {
    x: [{ t: 0, v: 0, uid: Math.random().toString(36).slice(2, 10) }],
    y: [{ t: 0, v: 0, uid: Math.random().toString(36).slice(2, 10) }],
    scale: [{ t: 0, v: 100, uid: Math.random().toString(36).slice(2, 10) }],
    rot: [{ t: 0, v: 0, uid: Math.random().toString(36).slice(2, 10) }],
    op: [{ t: 0, v: 100, uid: Math.random().toString(36).slice(2, 10) }],
  };
}

function normalizeBgConfig(c) {
  const s = { version: 1, duration: numValue(c.duration, 12), fps: numValue(c.fps, 30), loop: c.loop !== false, color: c.color || "#05141f", layers: [] };
  for (const L of (c.layers || [])) {
    const layer = {
      id: L.id || "l" + Math.random().toString(36).slice(2, 8),
      name: L.name || "Layer",
      file: L.file || "",
      visible: L.visible !== false,
      dataURL: null,
      tracks: {},
    };
    for (const tr of BG_TRACKS) {
      const kf = Array.isArray(L.tracks && L.tracks[tr.key])
        ? L.tracks[tr.key].map((k) => ({ t: numValue(k.t, 0), v: numValue(k.v, tr.key === "scale" || tr.key === "op" ? 100 : 0), uid: k.uid || Math.random().toString(36).slice(2, 10) }))
        : [];
      layer.tracks[tr.key] = kf.length ? kf : defaultTracks()[tr.key];
    }
    s.layers.push(layer);
  }
  return s;
}

function selectedLayer() {
  return bgState.layers.find((L) => L.id === bgSelectedLayerId) || null;
}

function trackValueAt(kf, t) {
  if (!kf || !kf.length) return 0;
  if (kf.length === 1) return kf[0].v;
  if (t <= kf[0].t) return kf[0].v;
  const n = kf.length - 1;
  if (t >= kf[n].t) return kf[n].v;
  for (let i = 0; i < n; i++) {
    const a = kf[i], b = kf[i + 1];
    if (t >= a.t && t <= b.t) {
      const p = (t - a.t) / Math.max(b.t - a.t, 0.0001);
      return a.v + (b.v - a.v) * p;
    }
  }
  return kf[n].v;
}

function bgPct(t) {
  return (t / Math.max(bgState.duration, 0.1)) * 100;
}

function renderBgFrame(ctx, w, h) {
  if (!bgState) return;
  const dur = Math.max(bgState.duration || 10, 0.1);
  const t = bgState.loop === false ? Math.min(bgTime, dur) : bgTime % dur;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bgState.color || "#000";
  ctx.fillRect(0, 0, w, h);
  for (const L of bgState.layers) {
    if (L.visible === false) continue;
    const im = bgImages[L.id];
    if (!im || !im.img || !im.img.naturalWidth) continue;
    const img = im.img;
    const sx = trackValueAt(L.tracks.x, t);
    const sy = trackValueAt(L.tracks.y, t);
    const sc = (trackValueAt(L.tracks.scale, t) || 100) / 100;
    const rot = ((trackValueAt(L.tracks.rot, t) || 0) * Math.PI) / 180;
    const op = (trackValueAt(L.tracks.op, t) ?? 100) / 100;
    const cover = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * cover * sc;
    const dh = img.naturalHeight * cover * sc;
    ctx.save();
    ctx.translate(w / 2 + (sx / 100) * w, h / 2 + (sy / 100) * h);
    ctx.rotate(rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, op));
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawBg() {
  const cv = document.getElementById("bgPreview");
  if (!cv || !cv.clientWidth) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext("2d");
  ctx.save();
  ctx.scale(dpr, dpr);
  renderBgFrame(ctx, w, h);
  ctx.restore();
}

function bgSetPlaying(on) {
  bgPlaying = on;
  bgLastTs = null;
  const btn = document.getElementById("bgPlayBtn");
  if (btn) btn.innerHTML = on ? "&#10074;&#10074;" : "&#9654;";
  if (on) {
    if (bgRaf) cancelAnimationFrame(bgRaf);
    bgRaf = requestAnimationFrame(bgTick);
  }
}

function bgTick() {
  if (!bgPlaying) return;
  const now = performance.now();
  if (bgLastTs == null) bgLastTs = now;
  const dt = (now - bgLastTs) / 1000;
  bgLastTs = now;
  bgTime += dt;
  const dur = Math.max(bgState.duration || 10, 0.1);
  if (bgState.loop === false) {
    if (bgTime >= dur) {
      bgTime = dur;
      bgSetPlaying(false);
    }
  } else {
    bgTime = bgTime % dur;
  }
  drawBg();
  updateBgPlayheadUI();
  updateBgTimeLabel();
  bgRaf = requestAnimationFrame(bgTick);
}

function updateBgSave() {
  const btn = document.getElementById("bgSaveBtn");
  if (btn) btn.disabled = !bgDirty;
}

function updateBgTimeLabel() {
  const lbl = document.getElementById("bgTimeLabel");
  if (!lbl || !bgState) return;
  lbl.textContent = `${bgTime.toFixed(1)}s / ${bgState.duration.toFixed(1)}s`;
}

function bgRulerRect() {
  const ruler = document.getElementById("bgRuler");
  return ruler ? ruler.getBoundingClientRect() : null;
}

function bgTimeFromX(clientX) {
  const r = bgRulerRect();
  if (!r) return bgTime;
  const dur = Math.max(bgState.duration, 0.1);
  return Math.max(0, Math.min(dur, ((clientX - r.left) / Math.max(r.width, 1)) * dur));
}

function bgScrubTo(clientX) {
  bgTime = bgTimeFromX(clientX);
  updateBgPlayheadUI();
  updateBgTimeLabel();
  drawBg();
}

function initBgPlayhead() {
  const ruler = document.getElementById("bgRuler");
  const handle = document.getElementById("bgPlayhead");
  if (!ruler || !handle || ruler.dataset.bgScrub) return;
  ruler.dataset.bgScrub = "1";
  const scrubDrag = (e) => {
    e.preventDefault();
    ruler.setPointerCapture(e.pointerId);
    bgScrubTo(e.clientX);
    const mv = (ev) => bgScrubTo(ev.clientX);
    const up = (ev) => {
      if (ruler.hasPointerCapture(ev.pointerId)) ruler.releasePointerCapture(ev.pointerId);
      ruler.removeEventListener("pointermove", mv);
      ruler.removeEventListener("pointerup", up);
    };
    ruler.addEventListener("pointermove", mv);
    ruler.addEventListener("pointerup", up);
  };
  ruler.addEventListener("pointerdown", scrubDrag);
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    bgScrubTo(e.clientX);
    const mv = (ev) => bgScrubTo(ev.clientX);
    const up = (ev) => {
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", mv);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", mv);
    handle.addEventListener("pointerup", up);
  };
  handle.addEventListener("pointerdown", handleDrag);
}

function updateBgPlayheadUI() {
  const ph = document.getElementById("bgPlayhead");
  if (ph) {
    const r = bgRulerRect();
    if (r) {
      const pct = bgPct(bgTime);
      ph.style.left = r.left - ph.offsetParent.getBoundingClientRect().left + (r.width * pct) / 100 + "px";
    }
  }
  const delBtn = document.getElementById("bgDelKeyBtn");
  if (delBtn) delBtn.disabled = !(bgSelectedKey && selectedLayer() && selectedLayer().tracks[bgSelectedKey.track] && selectedLayer().tracks[bgSelectedKey.track][bgSelectedKey.index] !== undefined);
}

function updateBgCanvasEmpty() {
  const el = document.getElementById("bgCanvasEmpty");
  if (el) el.style.display = bgState && bgState.layers.length ? "none" : "block";
}

function buildBgSlider(min, max, step, value, onChange) {
  const root = document.createElement("div");
  root.className = "vc vc-slider";
  root.innerHTML = `<div class="vc-track" tabindex="0" role="slider"><div class="vc-fill"></div><div class="vc-knob"></div></div>`;
  const track = root.querySelector(".vc-track"), fill = root.querySelector(".vc-fill"), knob = root.querySelector(".vc-knob");
  let current = Math.max(min, Math.min(max, value));
  const pct = (v) => ((v - min) / (max - min)) * 100;
  function setDisplay(v) {
    current = Math.max(min, Math.min(max, v));
    knob.style.left = pct(current) + "%";
    fill.style.width = pct(current) + "%";
  }
  function fromEvent(e) {
    const r = track.getBoundingClientRect();
    const v = min + ((e.clientX - r.left) / Math.max(r.width, 1)) * (max - min);
    return min + Math.round((Math.max(min, Math.min(max, v)) - min) / step) * step;
  }
  function commit(v) { setDisplay(v); onChange(v); }
  track.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    commit(fromEvent(e));
    const mv = (ev) => commit(fromEvent(ev));
    const up = (ev) => {
      track.releasePointerCapture(ev.pointerId);
      track.removeEventListener("pointermove", mv);
      track.removeEventListener("pointerup", up);
    };
    track.addEventListener("pointermove", mv);
    track.addEventListener("pointerup", up);
  });
  setDisplay(current);
  return { el: root, set: setDisplay };
}

function renderBgKeyEditor() {
  const wrap = document.getElementById("bgKeySliderWrap");
  const editor = document.getElementById("bgKeyEditor");
  const L = selectedLayer();
  const sk = bgSelectedKey;
  if (!L || !sk || !L.tracks[sk.track] || L.tracks[sk.track][sk.index] === undefined) {
    editor.hidden = true;
    return;
  }
  editor.hidden = false;
  const tr = BG_TRACKS.find((t) => t.key === sk.track);
  const kf = L.tracks[sk.track][sk.index];
  wrap.innerHTML = "";
  const label = document.createElement("div");
  label.className = "bg-key-label";
  label.innerHTML = `<span class="bg-dot" style="background:${tr.color}"></span>${tr.label} <span class="bg-key-time">${kf.t.toFixed(2)}s</span>`;
  wrap.appendChild(label);
  const slider = buildBgSlider(tr.min, tr.max, tr.step, kf.v, (v) => {
    kf.v = v;
    bgDirty = true;
    updateBgSave();
    drawBg();
  });
  wrap.appendChild(slider.el);
  const valEl = document.createElement("span");
  valEl.className = "vc-value bg-key-value";
  valEl.textContent = tr.fmt(kf.v);
  wrap.appendChild(valEl);
}

function renderBgTimeline() {
  const tracksEl = document.getElementById("bgTracks");
  const rulerEl = document.getElementById("bgRuler");
  if (!tracksEl || !rulerEl) return;
  tracksEl.innerHTML = "";
  rulerEl.innerHTML = "";
  const L = selectedLayer();
  const dur = Math.max(bgState.duration, 0.1);
  const tickEvery = dur <= 5 ? 0.5 : dur <= 15 ? 1 : 2;
  for (let t = 0; t <= dur + 1e-6; t += tickEvery) {
    const tick = document.createElement("div");
    tick.className = "bg-ruler-tick";
    tick.style.left = bgPct(t) + "%";
    tick.textContent = t.toFixed(tickEvery < 1 ? 1 : 0);
    rulerEl.appendChild(tick);
  }
  if (!L) {
    updateBgPlayheadUI();
    updateBgTimeLabel();
    return;
  }
  for (const tr of BG_TRACKS) {
    const row = document.createElement("div");
    row.className = "bg-track-row";
    const label = document.createElement("div");
    label.className = "bg-track-label";
    label.innerHTML = `<span class="bg-dot" style="background:${tr.color}"></span>${tr.label}`;
    const strip = document.createElement("div");
    strip.className = "bg-track-strip";
    const kf = L.tracks[tr.key];
    for (let i = 0; i < kf.length; i++) {
      const d = document.createElement("button");
      d.type = "button";
      d.className = "bg-key";
      d.id = "bgKey_" + kf[i].uid;
      d.style.left = bgPct(kf[i].t) + "%";
      d.style.background = tr.color;
      const isSel = bgSelectedKey && bgSelectedKey.layerId === L.id && bgSelectedKey.track === tr.key && bgSelectedKey.index === i;
      if (isSel) d.classList.add("active");
      const dragStart = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = kf[i];
        let moved = false;
        bgSelectedKey = { layerId: L.id, track: tr.key, index: i };
        bgTime = key.t;
        tracksEl.querySelectorAll(".bg-key.active").forEach((el) => el.classList.remove("active"));
        d.classList.add("active");
        renderBgKeyEditor();
        updateBgPlayheadUI();
        updateBgTimeLabel();
        drawBg();
        const r = rulerEl.getBoundingClientRect();
        const mv = (ev) => {
          let nt = ((ev.clientX - r.left) / Math.max(r.width, 1)) * dur;
          nt = Math.max(0, Math.min(dur, Math.round(nt * bgState.fps) / bgState.fps));
          if (Math.abs(nt - key.t) > 1e-6) moved = true;
          key.t = nt;
          bgDirty = true;
          updateBgSave();
          const nd = document.getElementById("bgKey_" + key.uid);
          if (nd) nd.style.left = bgPct(nt) + "%";
          bgTime = nt;
          renderBgKeyEditor();
          updateBgPlayheadUI();
          updateBgTimeLabel();
        };
        const up = (ev) => {
          window.removeEventListener("pointermove", mv);
          window.removeEventListener("pointerup", up);
          kf.sort((a, b) => a.t - b.t);
          bgSelectedKey = { layerId: L.id, track: tr.key, index: kf.findIndex((k) => k.uid === key.uid) };
          if (moved) {
            bgSuppressClickUntil = performance.now() + 350;
            renderBgTimeline();
            renderBgKeyEditor();
            updateBgPlayheadUI();
            updateBgTimeLabel();
            drawBg();
          }
        };
        window.addEventListener("pointermove", mv);
        window.addEventListener("pointerup", up);
      };
      d.addEventListener("pointerdown", dragStart);
      d.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = bgSelectedKey && bgSelectedKey.layerId === L.id && bgSelectedKey.track === tr.key ? bgSelectedKey.index : i;
        kf.splice(idx, 1);
        if (!kf.length) kf.push({ t: 0, v: tr.key === "scale" || tr.key === "op" ? 100 : 0, uid: Math.random().toString(36).slice(2, 10) });
        bgSelectedKey = null;
        bgDirty = true;
        updateBgSave();
        renderBgTimeline();
        renderBgKeyEditor();
        drawBg();
      });
      strip.appendChild(d);
    }
    strip.addEventListener("click", (e) => {
      if (e.target.classList.contains("bg-key")) return;
      if (performance.now() < bgSuppressClickUntil) return;
      bgScrubTo(e.clientX);
    });
    strip.addEventListener("dblclick", (e) => {
      if (e.target.classList.contains("bg-key")) return;
      const r = rulerEl.getBoundingClientRect();
      let nt = bgTimeFromX(e.clientX);
      nt = Math.max(0, Math.min(dur, Math.round(nt * bgState.fps) / bgState.fps));
      const kf2 = L.tracks[tr.key];
      const v = Math.round(trackValueAt(kf2, nt));
      kf2.push({ t: nt, v, uid: Math.random().toString(36).slice(2, 10) });
      kf2.sort((a, b) => a.t - b.t);
      const index = kf2.findIndex((k) => Math.abs(k.t - nt) < 0.0001);
      bgSelectedKey = { layerId: L.id, track: tr.key, index };
      bgTime = nt;
      bgDirty = true;
      updateBgSave();
      renderBgTimeline();
      renderBgKeyEditor();
      updateBgPlayheadUI();
      updateBgTimeLabel();
      drawBg();
    });
    row.appendChild(label);
    row.appendChild(strip);
    tracksEl.appendChild(row);
  }
  updateBgPlayheadUI();
}

function renderBgLayers() {
  const list = document.getElementById("bgLayerList");
  if (!list) return;
  list.innerHTML = "";
  for (const L of bgState.layers) {
    const row = document.createElement("div");
    row.className = "bg-layer" + (L.id === bgSelectedLayerId ? " bg-layer--selected" : "");
    const thumb = document.createElement("div");
    thumb.className = "bg-layer-thumb";
    const im = bgImages[L.id];
    if (im && im.img && im.img.naturalWidth) {
      const c = document.createElement("canvas");
      c.width = 42; c.height = 24;
      const ctx = c.getContext("2d");
      const img = im.img;
      const cover = Math.max(42 / img.naturalWidth, 24 / img.naturalHeight);
      const dw = img.naturalWidth * cover, dh = img.naturalHeight * cover;
      ctx.drawImage(img, (42 - dw) / 2, (24 - dh) / 2, dw, dh);
      thumb.appendChild(c);
    } else {
      thumb.textContent = "?";
    }
    const name = document.createElement("input");
    name.className = "bg-layer-name";
    name.value = L.name;
    name.placeholder = "Layer";
    name.addEventListener("input", () => { L.name = name.value || "Layer"; bgDirty = true; updateBgSave(); });
    const eye = document.createElement("button");
    eye.className = "icon-btn bg-layer-eye";
    eye.innerHTML = L.visible ? ICON_EYE : ICON_EYEOFF;
    eye.title = L.visible ? "Hide layer" : "Show layer";
    eye.addEventListener("click", () => { L.visible = !L.visible; bgDirty = true; updateBgSave(); renderBgLayers(); drawBg(); });
    const up = document.createElement("button");
    up.className = "icon-btn";
    up.innerHTML = ICON_UP;
    up.title = "Move up";
    up.addEventListener("click", () => {
      const i = bgState.layers.indexOf(L);
      if (i > 0) { [bgState.layers[i - 1], bgState.layers[i]] = [bgState.layers[i], bgState.layers[i - 1]]; bgDirty = true; updateBgSave(); renderBgLayers(); drawBg(); }
    });
    const down = document.createElement("button");
    down.className = "icon-btn";
    down.innerHTML = ICON_DOWN;
    down.title = "Move down";
    down.addEventListener("click", () => {
      const i = bgState.layers.indexOf(L);
      if (i < bgState.layers.length - 1) { [bgState.layers[i], bgState.layers[i + 1]] = [bgState.layers[i + 1], bgState.layers[i]]; bgDirty = true; updateBgSave(); renderBgLayers(); drawBg(); }
    });
    const del = document.createElement("button");
    del.className = "icon-btn bg-layer-del";
    del.innerHTML = ICON_TRASH;
    del.title = "Delete layer";
    del.addEventListener("click", () => {
      bgState.layers = bgState.layers.filter((x) => x.id !== L.id);
      delete bgImages[L.id];
      if (bgSelectedLayerId === L.id) {
        bgSelectedLayerId = bgState.layers.length ? bgState.layers[0].id : null;
        bgSelectedKey = null;
      }
      bgDirty = true;
      updateBgSave();
      renderBgLayers();
      renderBgTimeline();
      renderBgKeyEditor();
      updateBgCanvasEmpty();
      drawBg();
    });
    const ctl = document.createElement("div");
    ctl.className = "bg-layer-controls";
    ctl.append(eye, up, down, del);
    row.addEventListener("click", (e) => {
      if (e.target.closest("button,input")) return;
      bgSelectedLayerId = L.id;
      bgSelectedKey = null;
      renderBgLayers();
      renderBgTimeline();
      renderBgKeyEditor();
    });
    row.append(thumb, name, ctl);
    list.appendChild(row);
  }
  updateBgSave();
}

function bgAddLayerFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataURL = reader.result;
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const L = {
      id: "l" + Math.random().toString(36).slice(2, 8),
      name: (file.name || "Layer").replace(/\.[^.]+$/, "") || "Layer",
      file: "image-" + (bgState.layers.length + 1) + "." + ext,
      visible: true,
      dataURL,
      tracks: defaultTracks(),
    };
    bgState.layers.push(L);
    const img = new Image();
    img.onload = () => {
      bgImages[L.id] = { img, dataURL };
      bgSelectedLayerId = L.id;
      bgSelectedKey = null;
      bgDirty = true;
      updateBgSave();
      renderBgLayers();
      renderBgTimeline();
      renderBgKeyEditor();
      updateBgCanvasEmpty();
      updateBgPlayheadUI();
      drawBg();
    };
    img.src = dataURL;
  };
  reader.readAsDataURL(file);
}

async function loadBgImages() {
  for (const L of bgState.layers) {
    if (!L.file) continue;
    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = `/repo/background/${L.file}`;
    });
    bgImages[L.id] = { img: img.naturalWidth ? img : null, dataURL: null };
  }
}

function buildBgConfig() {
  const cfg = { version: 1, duration: bgState.duration, fps: bgState.fps, loop: bgState.loop, color: bgState.color, layers: [] };
  for (const L of bgState.layers) {
    cfg.layers.push({
      id: L.id,
      name: L.name,
      file: L.file,
      visible: L.visible,
      tracks: Object.fromEntries(BG_TRACKS.map((tr) => [tr.key, L.tracks[tr.key].slice().sort((a, b) => a.t - b.t).map((k) => ({ t: k.t, v: k.v }))])),
    });
  }
  return cfg;
}

async function saveBackground() {
  const btn = document.getElementById("bgSaveBtn");
  const status = document.getElementById("bgStatus");
  btn.disabled = true;
  status.textContent = "Pushing background to GitHub...";
  status.className = "status-msg";
  try {
    const files = [
      { path: `background/${bgTarget === "game-art" ? "game-art.json" : "background.json"}`, content: JSON.stringify(buildBgConfig(), null, 2), encoding: "utf8" },
      { path: "background/index.html", content: BG_INDEX_HTML, encoding: "utf8" },
      { path: "background/style.css", content: BG_STYLE_CSS, encoding: "utf8" },
      { path: "background/main.js", content: BG_RUNTIME_JS, encoding: "utf8" },
    ];
    for (const L of bgState.layers) {
      if (L.dataURL) files.push({ path: "background/" + L.file, content: L.dataURL.split(",")[1], encoding: "base64" });
    }
    const res = await fetch("/api/background/save", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files, message: "Update background from manage page" }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const result = await res.json();
    for (const L of bgState.layers) {
      if (L.dataURL) L.dataURL = null;
    }
    bgDirty = false;
    updateBgSave();
    status.textContent = `Saved ${result.files.length} files to GitHub`;
    status.className = "status-msg success";
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.className = "status-msg error";
    updateBgSave();
  }
}

function renderBgColor() {
  const wrap = document.getElementById("bgColorWrap");
  if (!wrap) return;
  wrap.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "vc-swatch bg-color-swatch";
  btn.title = "Background color";
  btn.innerHTML = `<span class="vc-swatch-checker"></span><span class="vc-swatch-fill"></span>`;
  const fill = btn.querySelector(".vc-swatch-fill");
  function paint() { fill.style.background = bgState.color; }
  paint();
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openColorPopover(btn, bgState.color, (css) => {
      bgState.color = css;
      bgDirty = true;
      updateBgSave();
      paint();
      drawBg();
    });
  });
  wrap.appendChild(btn);
}

function toggleBgLoop() {
  bgState.loop = !bgState.loop;
  document.getElementById("bgLoopBtn").classList.toggle("active", bgState.loop);
  bgDirty = true;
  updateBgSave();
  if (!bgState.loop && bgTime >= bgState.duration) {
    bgTime = 0;
    updateBgPlayheadUI();
    updateBgTimeLabel();
    drawBg();
  }
}

function toggleBgValues() {
  bgShowValues = !bgShowValues;
  document.body.classList.toggle("show-values", bgShowValues);
  document.getElementById("bgValuesBtn").classList.toggle("active", bgShowValues);
  document.getElementById("bgValueRow").hidden = !bgShowValues;
  renderBgKeyEditor();
}

function addBgKeyAtPlayhead() {
  const L = selectedLayer();
  if (!L) return;
  const track = bgSelectedKey ? bgSelectedKey.track : "x";
  const kf = L.tracks[track];
  const t = Math.min(bgState.duration, Math.round(bgTime * bgState.fps) / bgState.fps);
  if (kf.some((k) => Math.abs(k.t - t) < 0.0001)) {
    bgTime = t;
    updateBgPlayheadUI();
    return;
  }
  const v = Math.round(trackValueAt(kf, t));
  kf.push({ t, v });
  kf.sort((a, b) => a.t - b.t);
  const index = kf.findIndex((k) => Math.abs(k.t - t) < 0.0001);
  bgSelectedKey = { layerId: L.id, track, index };
  bgDirty = true;
  updateBgSave();
  renderBgTimeline();
  renderBgKeyEditor();
  updateBgPlayheadUI();
  updateBgTimeLabel();
  drawBg();
}

function delBgSelectedKey() {
  const L = selectedLayer();
  const sk = bgSelectedKey;
  if (!L || !sk) return;
  const kf = L.tracks[sk.track];
  if (!kf || kf[sk.index] === undefined) return;
  kf.splice(sk.index, 1);
  if (!kf.length) kf.push({ t: 0, v: sk.track === "scale" || sk.track === "op" ? 100 : 0 });
  bgSelectedKey = null;
  bgDirty = true;
  updateBgSave();
  renderBgTimeline();
  renderBgKeyEditor();
  drawBg();
}

function ensureBgInit() {
  if (!bgInitPromise) bgInitPromise = initBackgroundTab();
  return bgInitPromise;
}

async function initBackgroundTab() {
  document.getElementById("bgAddLayerBtn").addEventListener("click", () => document.getElementById("bgFileInput").click());
  document.getElementById("bgFileInput").addEventListener("change", (e) => {
    for (const f of e.target.files) bgAddLayerFromFile(f);
    e.target.value = "";
  });
  document.getElementById("bgPlayBtn").addEventListener("click", () => bgSetPlaying(!bgPlaying));
  document.getElementById("bgAddKeyBtn").addEventListener("click", addBgKeyAtPlayhead);
  document.getElementById("bgDelKeyBtn").addEventListener("click", delBgSelectedKey);
  document.getElementById("bgLoopBtn").addEventListener("click", toggleBgLoop);
  document.getElementById("bgValuesBtn").addEventListener("click", toggleBgValues);
  document.getElementById("bgDuration").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v > 0) {
      bgState.duration = Math.min(120, v);
      bgDirty = true;
      updateBgSave();
      renderBgTimeline();
      updateBgTimeLabel();
      drawBg();
    }
  });
  document.getElementById("bgFps").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v >= 1) {
      bgState.fps = Math.min(60, Math.max(1, v));
      bgDirty = true;
      updateBgSave();
    }
  });
  document.getElementById("bgSaveBtn").addEventListener("click", saveBackground);
  document.getElementById("bgTargetMain").addEventListener("click", () => switchBgTarget("main"));
  document.getElementById("bgTargetGameArt").addEventListener("click", () => switchBgTarget("game-art"));
  initBgPlayhead();

  await loadBgConfig();
}

async function loadBgConfig() {
  bgSetPlaying(false);
  bgTime = 0;
  try {
    const res = await fetch(`/api/background/config?target=${bgTarget}`);
    const data = await res.json();
    bgState = data && data.config && data.config.layers ? normalizeBgConfig(data.config) : defaultBgState();
  } catch (e) {
    console.warn("Could not load background config:", e);
    bgState = defaultBgState();
  }
  await loadBgImages();
  bgSelectedLayerId = bgState.layers.length ? bgState.layers[0].id : null;
  bgSelectedKey = null;
  document.getElementById("bgDuration").value = bgState.duration;
  document.getElementById("bgFps").value = bgState.fps;
  document.getElementById("bgLoopBtn").classList.toggle("active", bgState.loop);
  renderBgLayers();
  renderBgTimeline();
  renderBgKeyEditor();
  renderBgColor();
  updateBgTimeLabel();
  updateBgCanvasEmpty();
  requestAnimationFrame(() => drawBg());
  if (bgState.layers.length) bgSetPlaying(true);
  bgDirty = false;
  updateBgSave();
}

function switchBgTarget(target) {
  if (bgTarget === target) return;
  if (bgDirty && !window.confirm("Discard unsaved background changes?")) return;
  bgTarget = target;
  document.querySelectorAll(".bg-target-btn").forEach((b) => b.classList.toggle("active", b.dataset.target === target));
  loadBgConfig();
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
    try {
      await loadSiteConfig();
    } catch (e) {
      console.warn("Could not load site config:", e);
    }
    const styleStatus = document.getElementById("styleStatus");
    try {
      await loadStyle();
      styleStatus.textContent = `${getStyleElements().length} elements · ${styleBlocks.length} rules`;
      styleStatus.className = "status-msg success";
    } catch (e) {
      styleStatus.textContent = `Error: ${e.message}`;
      styleStatus.className = "status-msg error";
    }

  setupColumns();
  createContextMenu();
  initCropInteraction();
  initStyleTab();

  document.querySelectorAll("#editForm .toggle-group").forEach((group) => {
    const buttons = group.querySelectorAll(".toggle");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  });

  document.getElementById("addBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = document.getElementById("addMenu");
    menu.hidden = !menu.hidden;
  });

  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("addBtn").closest(".add-dropdown");
    if (wrap && !wrap.contains(e.target)) {
      document.getElementById("addMenu").hidden = true;
    }
  });

  document.getElementById("addNewItem").addEventListener("click", () => {
    document.getElementById("addMenu").hidden = true;
    openEdit(-1);
  });

  document.getElementById("addArtstationItem").addEventListener("click", () => {
    document.getElementById("addMenu").hidden = true;
    openArtstationOverlay();
  });

  document.getElementById("artstationOverlayBg").addEventListener("click", closeArtstationOverlay);
  document.getElementById("asCloseBtn").addEventListener("click", closeArtstationOverlay);
  document.getElementById("asFetchBtn").addEventListener("click", async () => {
    const input = document.getElementById("asUrlInput");
    const statusEl = document.getElementById("asStatus");
    const btn = document.getElementById("asFetchBtn");
    const url = input.value.trim();
    if (!url) {
      statusEl.textContent = "Paste an ArtStation artwork link first.";
      statusEl.className = "status-msg error";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Fetching...";
    statusEl.textContent = "Fetching artwork from ArtStation...";
    statusEl.className = "status-msg";
    try {
      const res = await fetch("/api/artstation/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (artData.some((e) => e.id && e.id === data.entry.id)) {
        statusEl.textContent = "That artwork is already in your data.";
        statusEl.className = "status-msg error";
        return;
      }
      closeArtstationOverlay();
      openEdit(-1, data.entry);
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
      statusEl.className = "status-msg error";
    } finally {
      btn.disabled = false;
      btn.textContent = "Fetch & Add";
    }
  });

  document.getElementById("addJsonItem").addEventListener("click", () => {
    document.getElementById("addMenu").hidden = true;
    openJsonOverlay();
  });

  document.getElementById("jsonOverlayBg").addEventListener("click", closeJsonOverlay);
  document.getElementById("jsonCloseBtn").addEventListener("click", closeJsonOverlay);
  document.getElementById("jsonFileBtn").addEventListener("click", () => document.getElementById("jsonFileInput").click());
  document.getElementById("jsonFileInput").addEventListener("change", () => {
    const f = document.getElementById("jsonFileInput").files[0];
    document.getElementById("jsonFileName").textContent = f ? f.name : "No file selected";
  });

  document.getElementById("jsonApplyBtn").addEventListener("click", async () => {
    const urlInput = document.getElementById("jsonUrlInput");
    const fileInput = document.getElementById("jsonFileInput");
    const statusEl = document.getElementById("jsonStatus");
    const btn = document.getElementById("jsonApplyBtn");
    const url = urlInput.value.trim();
    const file = fileInput.files[0];
    if (!url && !file) {
      statusEl.textContent = "Paste a URL or choose a projects.json file.";
      statusEl.className = "status-msg error";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Updating...";
    statusEl.textContent = "Parsing projects...";
    statusEl.className = "status-msg";
    try {
      const body = { currentArtData: artData };
      if (file) {
        let parsed;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          throw new Error("The selected file is not valid JSON.");
        }
        body.projects = parsed;
      } else {
        body.url = url;
      }
      statusEl.textContent = "Merging and fetching full images from each source link (this can take a minute)...";
      const res = await fetch("/api/artstation/projects-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      artData = data.artData || [];
      dirty = true;
      document.getElementById("saveBtn").disabled = false;
      renderAll();
      closeJsonOverlay();
      status.textContent = `Merged ${data.count} projects (${data.added} added, ${data.updated} updated).` +
        (typeof data.imagesFetched === "number"
          ? ` Fetched full images for ${data.imagesFetched} posts${data.imageErrors ? ` (${data.imageErrors} failed)` : ""}.`
          : "") +
        " Review and save.";
      status.className = "status-msg success";
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
      statusEl.className = "status-msg error";
    } finally {
      btn.disabled = false;
      btn.textContent = "Update Data";
    }
  });

  document.getElementById("overlayBg").addEventListener("click", closeEdit);
  document.getElementById("editCloseBtn").addEventListener("click", closeEdit);
  document.getElementById("editSaveBtn").addEventListener("click", saveEdit);

  document.getElementById("editIncludeEmbed").addEventListener("change", () => {
    const row = document.getElementById("editEmbedRow");
    row.style.display = document.getElementById("editIncludeEmbed").checked ? "block" : "none";
  });

  document.getElementById("siteConfigBtn").addEventListener("click", openSiteConfig);
  document.getElementById("scOverlayBg").addEventListener("click", closeSiteConfig);
  document.getElementById("scCloseBtn").addEventListener("click", closeSiteConfig);
  document.getElementById("scSaveBtn").addEventListener("click", async () => {
    const btn = document.getElementById("scSaveBtn");
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      await saveSiteConfig();
      closeSiteConfig();
      status.textContent = "Site config saved";
      status.className = "status-msg success";
    } catch (e) {
      status.textContent = `Error: ${e.message}`;
      status.className = "status-msg error";
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
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

  window.addEventListener("resize", () => {
    if (document.getElementById("panel-background").classList.contains("tab-panel--active")) {
      drawBg();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
