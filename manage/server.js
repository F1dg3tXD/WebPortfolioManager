import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "fs";
import { exec } from "child_process";
import { homedir } from "os";
import { join, dirname } from "path";
import express from "express";

function findPublicDir() {
  const candidates = [
    join(dirname(process.execPath), "public"),
    join(process.cwd(), "public"),
  ];
  for (const p of candidates) {
    try {
      if (statSync(p).isDirectory()) return p;
    } catch {}
  }
  return join(process.cwd(), "public");
}

const CONFIG_DIR = join(homedir(), ".manage-app");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

let config = {};

function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
      config = {};
    }
  }
  if (!config.githubToken && process.env.GITHUB_TOKEN) config.githubToken = process.env.GITHUB_TOKEN;
  if (!config.repo && process.env.REPO) config.repo = process.env.REPO;
  if (!config.dataPath && process.env.DATA_PATH) config.dataPath = process.env.DATA_PATH;
  config.repo ||= "Spewku/Spewku.github.io";
  config.dataPath ||= "artData.json";
}

function saveConfig(updates) {
  config = { ...config, ...updates };
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

loadConfig();

const app = express();
const publicDir = findPublicDir();

app.use(express.json({ limit: "60mb" }));
app.use(express.static(publicDir));

let currentSha = null;

function getAuthHeaders() {
  if (!config.githubToken) {
    return { Accept: "application/vnd.github.v3+json" };
  }
  return {
    Authorization: `token ${config.githubToken}`,
    Accept: "application/vnd.github.v3+json",
  };
}

// Fetch with unauthenticated fallback for read-only endpoints (public repo
// works without a token; a stale/dead token otherwise breaks reads).
async function ghFetch(url, opts = {}) {
  let res = await fetch(url, { ...opts, headers: { ...getAuthHeaders(), ...(opts.headers || {}) } });
  if (res.status === 401 && config.githubToken) {
    res = await fetch(url, { ...opts, headers: { Accept: "application/vnd.github.v3+json", ...(opts.headers || {}) } });
  }
  return res;
}

app.get("/api/settings", (req, res) => {
  res.json({
    repo: config.repo || "",
    dataPath: config.dataPath || "",
    hasToken: !!config.githubToken,
  });
});

app.put("/api/settings", (req, res) => {
  const { githubToken, repo, dataPath } = req.body;
  const updates = {};
  if (githubToken !== undefined) updates.githubToken = githubToken;
  if (repo !== undefined) updates.repo = repo;
  if (dataPath !== undefined) updates.dataPath = dataPath;
  saveConfig(updates);
  currentSha = null;
  res.json({ ok: true });
});

app.get("/api/data", async (req, res) => {
  try {
    const api = `https://api.github.com/repos/${config.repo}/contents/${config.dataPath}`;
    const response = await ghFetch(api);
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.message });
    }
    const { content, sha } = await response.json();
    currentSha = sha;
    const decoded = JSON.parse(Buffer.from(content, "base64").toString("utf-8"));
    res.json(decoded);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/siteconfig", async (req, res) => {
  try {
    const api = `https://api.github.com/repos/${config.repo}/contents/siteConfig.json`;
    const response = await ghFetch(api);
    if (!response.ok) {
      if (response.status === 404) {
        return res.json({ personal: {}, professional: {} });
      }
      const err = await response.json();
      return res.status(response.status).json({ error: err.message });
    }
    const { content, sha: fileSha } = await response.json();
    const decoded = JSON.parse(Buffer.from(content, "base64").toString("utf-8"));
    res.json({ data: decoded, sha: fileSha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/siteconfig", async (req, res) => {
  try {
    const { data, sha } = req.body;
    if (!data) return res.status(400).json({ error: "data is required" });
    const encoded = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    const api = `https://api.github.com/repos/${config.repo}/contents/siteConfig.json`;
    const body = {
      message: "Update siteConfig from manage page",
      content: encoded,
      sha: sha || undefined,
    };
    const response = await fetch(api, {
      method: "PUT",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.message });
    }
    const result = await response.json();
    res.json({ sha: result.content.sha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── style.css (Style tab) ──

app.get("/api/style", async (req, res) => {
  try {
    // Contents API gives the blob SHA needed for updates.
    const api = `https://api.github.com/repos/${config.repo}/contents/style.css`;
    const response = await fetch(api, { headers: getAuthHeaders() });
    if (response.ok) {
      const { content, sha } = await response.json();
      const decoded = Buffer.from(content, "base64").toString("utf-8");
      return res.json({ content: decoded, sha });
    }
    // 401 (bad token) / 403 (rate limit): fall back to raw content, sha null.
    // Raw does not consume API rate and works for public repos.
    if (response.status === 404) return res.json({ content: "", sha: null });
    const raw = await fetch(`https://raw.githubusercontent.com/${config.repo}/main/style.css`);
    if (raw.ok) return res.json({ content: await raw.text(), sha: null });
    if (raw.status === 404) return res.json({ content: "", sha: null });
    const err = await response.json();
    return res.status(response.status).json({ error: err.message || `HTTP ${response.status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/style", async (req, res) => {
  try {
    const { content, sha } = req.body;
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content is required" });
    }
    const encoded = Buffer.from(content, "utf-8").toString("base64");
    const api = `https://api.github.com/repos/${config.repo}/contents/style.css`;
    const body = {
      message: "Update style.css from manage page",
      content: encoded,
      sha: sha || undefined,
    };
    const response = await fetch(api, {
      method: "PUT",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.message });
    }
    const result = await response.json();
    res.json({ sha: result.content.sha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unique HTML elements used across the site (classes, ids, tags).
// Excludes pages that do not load /style.css (404.html, background/) and
// the pure-redirect pages (index.html, socials/index.html).
app.get("/api/style/elements", async (req, res) => {
  try {
    // The site has a small, fixed set of pages that load /style.css. Fetching
    // them via raw.githubusercontent avoids the contents API rate limit and
    // works with a stale token, keeping the element scan reliable.
    const htmlFiles = [
      "home/index.html",
      "about/index.html",
      "personal/index.html",
      "game-art/index.html",
    ];

    const classes = new Set();
    const ids = new Set();
    const tags = new Set();

    for (const path of htmlFiles) {
      const api = `https://raw.githubusercontent.com/${config.repo}/main/${path}`;
      let res = await fetch(api);
      if (res.status === 404) {
        res = await fetch(`https://raw.githubusercontent.com/${config.repo}/master/${path}`);
      }
      if (!res.ok) continue;
      const html = await res.text();

      let m;
      const classRe = /class="([^"]*)"/g;
      while ((m = classRe.exec(html))) {
        m[1].split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
      }

      const idRe = /id="([^"]*)"/g;
      while ((m = idRe.exec(html))) ids.add(m[1]);

      const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])/g;
      while ((m = tagRe.exec(html))) {
        const t = m[1].toLowerCase();
        if (t !== "div" && t !== "span") tags.add(t);
      }
    }

    res.json({
      classes: [...classes].sort().map((c) => `.${c}`),
      ids: [...ids].sort().map((i) => `#${i}`),
      tags: [...tags].sort(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Water background (from the repo's /background/) so the Style tab previews
// against the same background as the site. Serves the real background page
// with its URLs rewritten to the manager endpoints.
app.get("/api/background", async (req, res) => {
  try {
    const api = `https://raw.githubusercontent.com/${config.repo}/main/background/index.html`;
    const response = await fetch(api);
    if (!response.ok) {
      return res.status(response.status).json({ error: `HTTP ${response.status}` });
    }
    let html = await response.text();
    html = html.replace('href="style.css"', 'href="/api/background-style"');
    html = html.replace('src="main.js"', 'src="/api/background-main"');
    html = html.replace('type="module"', "");
    res.type("html").send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/background-style", async (req, res) => {
  try {
    const api = `https://raw.githubusercontent.com/${config.repo}/main/background/style.css`;
    const response = await fetch(api);
    if (!response.ok) {
      return res.status(response.status).json({ error: `HTTP ${response.status}` });
    }
    const css = await response.text();
    res.type("text/css").send(css);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/background-main", async (req, res) => {
  try {
    const api = `https://raw.githubusercontent.com/${config.repo}/main/background/main.js`;
    const response = await fetch(api);
    if (!response.ok) {
      return res.status(response.status).json({ error: `HTTP ${response.status}` });
    }
    let js = await response.text();
    js = js.replace('"/background/water.jpg"', '"/api/background-image"');
    res.type("application/javascript").send(js);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/background-image", async (req, res) => {
  try {
    const api = `https://raw.githubusercontent.com/${config.repo}/main/background/water.jpg`;
    const response = await fetch(api);
    if (!response.ok) return res.status(response.status).end();
    const buf = Buffer.from(await response.arrayBuffer());
    res.type("image/jpeg").send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Background editor ──

// Editor state for the background timeline. The generated background.json is
// what the site's background/main.js loads at runtime; the editor reads it
// back (via raw, no rate limit) so the client's animation is restored.
app.get("/api/background/config", async (req, res) => {
  try {
    const api = `https://raw.githubusercontent.com/${config.repo}/main/background/background.json`;
    let response = await fetch(api);
    if (response.status === 404) {
      response = await fetch(`https://raw.githubusercontent.com/${config.repo}/master/background/background.json`);
    }
    if (response.ok) {
      return res.json({ config: JSON.parse(await response.text()) });
    }
    if (response.status === 404) {
      return res.json({ config: null });
    }
    return res.status(response.status).json({ error: `HTTP ${response.status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pushes one or more files into the repo's background/ folder. Each entry is
// { path, content, encoding: "utf8" | "base64" }. The current blob SHA is
// fetched per file so updates replace, not conflict.
app.put("/api/background/save", async (req, res) => {
  try {
    const { files, message } = req.body || {};
    if (!Array.isArray(files) || !files.length) {
      return res.status(400).json({ error: "files array is required" });
    }
    const results = [];
    for (const f of files) {
      const path = String(f.path || "");
      if (!path.startsWith("background/")) {
        return res.status(400).json({ error: `path must be inside background/: ${path}` });
      }
      const enc = f.encoding === "base64" ? "base64" : "utf8";
      const content = enc === "base64"
        ? String(f.content || "")
        : Buffer.from(String(f.content || ""), "utf-8").toString("base64");

      const infoApi = `https://api.github.com/repos/${config.repo}/contents/${path}`;
      const infoRes = await fetch(infoApi, { headers: getAuthHeaders() });
      const sha = infoRes.ok ? (await infoRes.json()).sha : undefined;

      const body = {
        message: message || "Update background from manage page",
        content,
        sha,
      };
      const putRes = await fetch(infoApi, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!putRes.ok) {
        const err = await putRes.json();
        return res.status(putRes.status).json({ error: `${path}: ${err.message}` });
      }
      const result = await putRes.json();
      results.push({ path, sha: result.content.sha });
    }
    res.json({ files: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Site preview proxy ──
// Serves the repo's actual pages/assets same-origin so the preview iframe is
// inspectable. Absolute / paths in HTML and JS are rewritten to /repo/... so
// every asset (style.css, js, images, siteConfig.json, artData.json) resolves
// through this proxy. Binary files are served raw; text gets rewritten.
const REPO_MIME = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  mp4: "video/mp4",
  webm: "video/webm",
};

const TEXT_EXT = new Set(["html", "htm", "js", "mjs", "css", "json", "svg"]);

function rewriteRepoUrls(text) {
  return text.replace(/(['"])\/(?!repo\/|api\/)([^'"#\s)]*)/g, (m, q, rest) => {
    if (/^[a-z]+:\/\//i.test(rest)) return m;
    return q + "/repo/" + rest;
  });
}

function extOf(filePath) {
  const m = /\.([a-z0-9]+)$/i.exec(filePath);
  return m ? m[1].toLowerCase() : "";
}

app.get("/repo/*", async (req, res) => {
  try {
    let filePath = req.params[0];
    if (!filePath) filePath = "index.html";
    if (filePath.endsWith("/")) filePath += "index.html";

    // Raw.githubusercontent is used instead of the contents API: it does not
    // count against the API rate limit and works unauthenticated for public
    // repos, so the preview stays reliable even when the token is stale.
    const api = `https://raw.githubusercontent.com/${config.repo}/main/${filePath}`;
    let response = await fetch(api);
    if (response.status === 404) {
      response = await fetch(`https://raw.githubusercontent.com/${config.repo}/master/${filePath}`);
    }
    if (!response.ok) {
      return res.status(response.status).end();
    }
    const buf = Buffer.from(await response.arrayBuffer());
    const ext = extOf(filePath);
    res.type(REPO_MIME[ext] || "application/octet-stream");

    if (TEXT_EXT.has(ext)) {
      res.send(rewriteRepoUrls(buf.toString("utf-8")));
    } else {
      res.send(buf);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/commit", async (req, res) => {
  try {
    if (!currentSha) {
      return res.status(400).json({ error: "No SHA cached. Fetch /api/data first." });
    }
    const data = req.body;
    if (!data || !data.artData) {
      return res.status(400).json({ error: "Request body must contain artData array" });
    }
    const encoded = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
    const api = `https://api.github.com/repos/${config.repo}/contents/${config.dataPath}`;
    const body = {
      message: "Update artData from manage page",
      content: encoded,
      sha: currentSha,
    };
    const response = await fetch(api, {
      method: "PUT",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.message });
    }
    const result = await response.json();
    currentSha = result.content.sha;
    res.json({ sha: result.content.sha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3322;

// Opens the default browser. Uses plain child_process instead of an npm
// package so it works inside the packaged single-file executable (SEA) on
// Windows, where dynamic imports of external modules cannot be resolved.
function openBrowser(url) {
  const platform = process.platform;
  const onErr = () => {};
  if (platform === "win32") {
    exec(`start "" "${url}"`, { shell: "cmd.exe" }, onErr);
  } else if (platform === "darwin") {
    exec(`open "${url}"`, onErr);
  } else {
    exec(`xdg-open "${url}"`, onErr);
  }
}

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Manage app running at ${url}`);
  if (!config.githubToken) {
    console.log("No GitHub token configured. Open the app and click the gear icon to set it up.");
  }
  if (process.env.NO_OPEN !== "1") openBrowser(url);
});
