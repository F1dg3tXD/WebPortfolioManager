/* ── config ── *
 * These placeholders get replaced at deploy time via
 * the GitHub Actions workflow (.github/workflows/deploy.yml)
 * using the repository secrets of the same name.
 */
const UPLOADPASS = "secrets.UPLOADPASS";
const ACCTOKEN   = "secrets.ACCTOKEN";
const REPO       = "Spewku/Spewku.github.io";
const DATA_PATH  = "artData.json";

/* ── helpers ── */

function buildJson(data) {
  const entry = {
    type: data.isPersonal ? "personal" : "professional",
    is3D: data.is3D === "true",
    title: data.title,
    description: data.description,
    sourceLink: data.sourceLink,
    images: data.carouselImages.filter(url => url.trim().length > 0).map(url => url.trim()),
  };

  if (data.includeEmbed && data.embedCode.trim()) {
    entry.embed = data.embedCode;
  }

  return entry;
}

async function fetchCurrentData(token) {
  const url = `https://api.github.com/repos/${REPO}/contents/${DATA_PATH}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch current data (${res.status})`);
  return res.json();
}

async function commitToGithub(token, newEntry) {
  const { content: currentBase64, sha } = await fetchCurrentData(token);

  const decoded = atob(currentBase64);
  const current = JSON.parse(decoded);

  if (!current.artData) current.artData = [];
  current.artData.push(newEntry);

  const updated = JSON.stringify(current, null, 2);
  const newBase64 = btoa(unescape(encodeURIComponent(updated)));

  const body = {
    message: "Add new art post via upload",
    content: newBase64,
    sha,
  };

  const url = `https://api.github.com/repos/${REPO}/contents/${DATA_PATH}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub API error (${res.status}): ${err.message}`);
  }

  return res.json();
}

/* ── gate ── */
function initGate() {
  const gate = document.getElementById("gate");
  const app = document.getElementById("app");
  const gatePass = document.getElementById("gatePass");
  const gateBtn = document.getElementById("gateBtn");
  const gateError = document.getElementById("gateError");

  const unlock = () => {
    gate.style.display = "none";
    app.style.display = "grid";
  };

  gateBtn.addEventListener("click", () => {
    if (gatePass.value === UPLOADPASS) {
      gateError.textContent = "";
      unlock();
    } else {
      gateError.textContent = "Invalid password";
      gatePass.value = "";
      gatePass.focus();
    }
  });

  gatePass.addEventListener("keydown", (e) => {
    if (e.key === "Enter") gateBtn.click();
  });
}

/* ── main form ── */
function initForm() {
  const workTypeHidden = document.getElementById("workType");
  const dimensionHidden = document.getElementById("dimension");
  const toggleGroups = document.querySelectorAll(".toggle-group");
  const includeEmbedCheckbox = document.getElementById("includeEmbed");
  const embedRow = document.getElementById("embedRow");
  const generateBtn = document.getElementById("generateBtn");
  const commitBtn = document.getElementById("commitBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const output = document.getElementById("xmlOutput");
  const statusMsg = document.getElementById("statusMsg");

  toggleGroups.forEach((group) => {
    const buttons = group.querySelectorAll(".toggle");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const hidden = group.querySelector('input[type="hidden"]');
        if (hidden) hidden.value = btn.dataset.value;
      });
    });
  });

  const updateEmbedVisibility = () => {
    embedRow.style.display = includeEmbedCheckbox.checked ? "flex" : "none";
  };
  includeEmbedCheckbox.addEventListener("change", updateEmbedVisibility);
  updateEmbedVisibility();

  let lastJson = "";

  generateBtn.addEventListener("click", () => {
    const data = {
      isPersonal: workTypeHidden.value === "personal",
      is3D: dimensionHidden.value === "true",
      title: document.getElementById("title").value.trim(),
      description: document.getElementById("description").value.trim(),
      sourceLink: document.getElementById("sourceLink").value.trim(),
      carouselImages: document.getElementById("carouselImages").value.split(/\r?\n/),
      includeEmbed: includeEmbedCheckbox.checked,
      embedCode: document.getElementById("embedCode").value,
    };

    const entry = buildJson(data);
    const json = JSON.stringify(entry, null, 2);
    lastJson = json;
    output.textContent = json;
    downloadBtn.disabled = false;
    commitBtn.disabled = !ACCTOKEN;
    statusMsg.textContent = "";
  });

  downloadBtn.addEventListener("click", () => {
    if (!lastJson) return;
    const title = document.getElementById("title").value;
    const blob = new Blob([lastJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeTitle = title.trim().replace(/[^\w-]+/g, "_") || "art_post";
    a.href = url;
    a.download = `${safeTitle}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  commitBtn.addEventListener("click", async () => {
    if (!lastJson) return;
    if (!ACCTOKEN) {
      statusMsg.textContent = "ACCTOKEN not configured — set it in main.js";
      statusMsg.className = "status-msg error";
      return;
    }

    commitBtn.disabled = true;
    statusMsg.textContent = "Fetching current data from GitHub...";
    statusMsg.className = "status-msg";

    try {
      const entry = JSON.parse(lastJson);
      const result = await commitToGithub(ACCTOKEN, entry);
      statusMsg.textContent = `Committed! SHA: ${result.content.sha.slice(0, 7)}`;
      statusMsg.className = "status-msg success";
    } catch (e) {
      statusMsg.textContent = `Error: ${e.message}`;
      statusMsg.className = "status-msg error";
      commitBtn.disabled = true;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initGate();
  initForm();
});
