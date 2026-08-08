let artData = [];
let currentEditIdx = -1;
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
    artData.push({ type, is3D, isAvatar, title, description, tags, sourceLink, images, embed, thumbnail, thumbnailCrop });
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

function switchTab(name) {
  document.querySelectorAll(".app-tab").forEach((t) => {
    t.classList.toggle("app-tab--active", t.dataset.tab === name);
  });
  document.getElementById("panel-artdata").classList.toggle("tab-panel--active", name === "artdata");
  document.getElementById("panel-style").classList.toggle("tab-panel--active", name === "style");
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
  const parts = blocks.map((b) => {
    if (b.edited) return `${b.prelude} {\n${b.inner.trim()}\n}`;
    return b.raw.trim();
  });
  return parts.filter((p) => p).join("\n\n") + "\n";
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

async function loadStyle() {
  const res = await fetch("/api/style");
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  styleSha = data.sha;
  styleBlocks = parseCSS(data.content || "");
  try {
    await loadStyleElements();
  } catch (e) {
    console.warn("Could not scan site elements:", e);
  }
  renderStyleList();
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
  const label = document.createElement("div");
  label.className = "style-rule-prelude";
  label.textContent = b.prelude;
  label.title = b.prelude;
  item.appendChild(label);
  const ta = document.createElement("textarea");
  ta.className = "text-input style-rule-input";
  ta.spellcheck = false;
  ta.value = b.inner.replace(/^\n+/, "").replace(/\n+\s*$/, "");
  ta.addEventListener("input", () => {
    b.edited = true;
    b.inner = "\n" + ta.value + "\n";
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
  const elements = getStyleElements();

  const matchedSet = new Set();
  const matched = [];
  for (const element of elements) {
    const rules = styleBlocks.filter((b) => ruleMatchesElement(b, element));
    rules.forEach((b) => matchedSet.add(b));
    matched.push({ element, rules });
  }

  const isUniversalRule = (b) => {
    if (b.type !== "rule") return false;
    return b.prelude.replace(/\s+/g, "").split(",").every((s) => s === "*" || s === "*::before" || s === "*::after");
  };
  const others = styleBlocks.filter((b) => !matchedSet.has(b) && !isUniversalRule(b) && (b.type === "atrule" || b.type === "rule"));

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
  document.getElementById("styleSaveBtn").disabled = !styleDirty;
}

async function saveStyle() {
  const btn = document.getElementById("styleSaveBtn");
  const status = document.getElementById("styleStatus");
  btn.disabled = true;
  status.textContent = "Pushing style.css to GitHub...";
  status.className = "status-msg";
  try {
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
    status.textContent = `style.css saved! SHA: ${result.sha.slice(0, 7)}`;
    status.className = "status-msg success";
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

function elementData(el) {
  const tag = el.tagName ? el.tagName.toLowerCase() : "element";
  const id = el.id || "";
  const classes =
    el.classList && typeof el.classList.contains === "function"
      ? Array.from(el.classList)
      : el.className && typeof el.className === "string"
        ? el.className.trim().split(/\s+/).filter(Boolean)
        : [];
  const primary = id ? `#${id}` : classes[0] ? `.${classes[0]}` : tag;
  return { tag, id, classes, primary };
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
        ? "." + Array.from(node.classList).join(".")
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
  s.textContent =
    ".si-hover{outline:2px dashed #4dc9f6 !important;outline-offset:-2px}.si-selected{outline:2px solid #0990f7 !important;outline-offset:-2px;box-shadow:0 0 0 9999px rgba(9,144,247,.10) inset}";
  (doc.head || doc.documentElement).appendChild(s);
}

function clearPreviewSelection(doc) {
  if (!doc) return;
  doc.querySelectorAll(".si-selected").forEach((el) => el.classList.remove("si-selected"));
  selectedPreviewEl = null;
}

function wirePreviewInspector() {
  const frame = document.getElementById("sitePreview");
  if (!frame || !frame.contentDocument) return;
  const doc = frame.contentDocument;
  ensurePreviewStyles(doc);

  doc.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;
      if (!el || el.nodeType !== 1) return;
      if (selectedPreviewEl) selectedPreviewEl.classList.remove("si-selected");
      selectedPreviewEl = el;
      el.classList.add("si-selected");
      const data = elementData(el);
      data.path = selectorPath(el);
      renderInspector(data);
    },
    true
  );

  doc.addEventListener(
    "mouseover",
    (e) => {
      const el = e.target;
      if (!el || el.nodeType !== 1) return;
      doc.querySelectorAll(".si-hover").forEach((n) => n !== el && n.classList.remove("si-hover"));
      el.classList.add("si-hover");
    },
    true
  );

  doc.addEventListener("mouseout", (e) => {
    const el = e.target;
    if (el && el.nodeType === 1) el.classList.remove("si-hover");
  });

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

  const matches = styleBlocks
    .filter((b) => blockMatchesElementData(b, data))
    .sort((a, b) => getMatchPriority(a, data) - getMatchPriority(b, data));

  const matchBox = document.getElementById("inspectorMatches");
  matchBox.innerHTML = "";
  if (!matches.length) {
    const note = document.createElement("div");
    note.className = "inspector-note";
    note.textContent = "No existing rules match this element yet.";
    matchBox.appendChild(note);
  }
  for (const b of matches) matchBox.appendChild(createRuleItem(b));

  populateAttachSelect("");
  document.getElementById("newRuleSel").value = data.primary;
}

function attachToRule(data) {
  const sel = document.getElementById("attachSelect").value;
  if (!sel) return;
  const block = styleBlocks.find((b) => b.type === "rule" && b.prelude.trim() === sel);
  if (!block) return;
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
  renderInspector(data);
  renderStyleList();
}

function addNewRule(data) {
  const sel = document.getElementById("newRuleSel").value.trim() || data.primary;
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
    inner: "\n  /* style " + sel + " */\n",
    raw: "",
    edited: true,
  });
  styleDirty = true;
  updateStyleSave();
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
  switchInspectorTab("inspect");
  renderInspector(pastedElements[firstIdx]);
  const status = document.getElementById("styleStatus");
  status.textContent = `${count} elements added from pasted HTML (temporary)`;
  status.className = "status-msg success";
}

function renderPasted() {
  const chips = document.getElementById("pastedChips");
  chips.innerHTML = "";
  pastedElements.forEach((data, i) => {
    const chip = document.createElement("button");
    chip.className = "pasted-chip";
    chip.innerHTML = `<span class="inspector-tag">${escapeHtml(data.tag)}</span>${data.id ? `<span class="inspector-chip">#${escapeHtml(data.id)}</span>` : ""}${data.classes.length ? `<span class="inspector-chip">.${escapeHtml(data.classes.join("."))}</span>` : ""}`;
    chip.title = data.path || "";
    chip.addEventListener("click", () => {
      switchInspectorTab("inspect");
      renderInspector(data);
    });
    chips.appendChild(chip);
  });
}

function loadPreviewPage(path) {
  const frame = document.getElementById("sitePreview");
  if (!frame) return;
  clearPreviewSelection(frame.contentDocument);
  inspected = null;
  document.getElementById("inspectorContent").hidden = true;
  document.getElementById("inspectorEmpty").style.display = "block";
  frame.src = `/repo/${path}`;
}

function initStyleTab() {
  document.querySelectorAll(".app-tab").forEach((t) => {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  });
  document.getElementById("styleSaveBtn").addEventListener("click", saveStyle);
  document.getElementById("styleFilter").addEventListener("input", renderStyleList);
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
  document.getElementById("previewPage").addEventListener("change", (e) => {
    loadPreviewPage(e.target.value);
  });

  document.querySelectorAll(".inspector-tab").forEach((t) => {
    t.addEventListener("click", () => switchInspectorTab(t.dataset.itab));
  });
  document.getElementById("attachBtn").addEventListener("click", () => inspected && attachToRule(inspected));
  document.getElementById("newRuleBtn").addEventListener("click", () => inspected && addNewRule(inspected));

  document.getElementById("pasteHtmlBtn").addEventListener("click", openPasteModal);
  document.getElementById("pasteCloseBtn").addEventListener("click", closePasteModal);
  document.getElementById("pasteOverlayBg").addEventListener("click", closePasteModal);
  document.getElementById("pasteParseBtn").addEventListener("click", parsePastedHtml);
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

  document.getElementById("addBtn").addEventListener("click", () => openEdit(-1));

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
}

document.addEventListener("DOMContentLoaded", init);
