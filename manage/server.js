import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "fs";
import { exec } from "child_process";
import { homedir } from "os";
import { join, dirname } from "path";
import express from "express";
import puppeteer from "puppeteer-core";

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
// back (via raw, no rate limit) so the client's animation is restored. The
// Game Art page uses its own config (background/game-art.json), chosen with
// ?target=game-art.
app.get("/api/background/config", async (req, res) => {
  try {
    const target = String(req.query.target || "main");
    const file = target === "game-art" ? "background/game-art.json" : "background/background.json";
    const api = `https://raw.githubusercontent.com/${config.repo}/main/${file}`;
    let response = await fetch(api);
    if (response.status === 404) {
      response = await fetch(`https://raw.githubusercontent.com/${config.repo}/master/${file}`);
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

// Uploads one or more site images into the repo, overwriting each target path
// so existing references keep working. This is used by the Style editor to
// replace site images that are not art data (pfp, name logo, about image,
// etc.). Entries are { path, content (base64), encoding: "utf8" | "base64" }.
// The current blob SHA is fetched per file so updates replace, not conflict.
app.put("/api/upload", async (req, res) => {
  try {
    const { files, message } = req.body || {};
    if (!Array.isArray(files) || !files.length) {
      return res.status(400).json({ error: "files array is required" });
    }
    const ALLOWED_IMG = ["png", "jpg", "jpeg", "webp", "gif", "svg", "ico", "bmp", "avif"];
    const results = [];
    for (const f of files) {
      let filePath = String(f.path || "").replace(/^\/+/, "");
      if (!filePath) return res.status(400).json({ error: "path is required" });
      if (filePath.split("/").some((s) => s === "..")) {
        return res.status(400).json({ error: `invalid path: ${filePath}` });
      }
      if (!ALLOWED_IMG.includes(extOf(filePath))) {
        return res.status(400).json({ error: `path must be an image file: ${filePath}` });
      }
      const enc = f.encoding === "utf8" ? "utf8" : "base64";
      const content = enc === "utf8"
        ? Buffer.from(String(f.content || ""), "utf-8").toString("base64")
        : String(f.content || "");
      if (!content) return res.status(400).json({ error: `content is required for ${filePath}` });

      const infoApi = `https://api.github.com/repos/${config.repo}/contents/${filePath}`;
      const infoRes = await fetch(infoApi, { headers: getAuthHeaders() });
      const sha = infoRes.ok ? (await infoRes.json()).sha : undefined;

      const putRes = await fetch(infoApi, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ message: message || "Replace image from manage page", content, sha }),
      });
      if (!putRes.ok) {
        const err = await putRes.json();
        return res.status(putRes.status).json({ error: `${filePath}: ${err.message}` });
      }
      const result = await putRes.json();
      results.push({ path: filePath, sha: result.content.sha });
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

// ── ArtStation import ──

const AS_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.artstation.com/",
  Origin: "https://www.artstation.com",
  "Cache-Control": "no-cache",
};

function artstationHashFromUrl(url) {
  const m = String(url || "").match(/artstation\.com\/(?:projects|artwork)\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : "";
}

function cleanHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toLargeUrl(url) {
  return String(url || "").replace("/original/", "/large/");
}

// ── ArtStation fetch layer ──
// ArtStation sits behind Cloudflare, which challenges plain HTTP requests
// (403) unless a real browser runs its JS challenge. So fetches try a plain
// request first, then fall back to a shared headless Chromium browser that
// solves the challenge automatically. The browser executable is resolved
// from AS_BROWSER, config.artstationBrowser, or well-known installed paths.

let asBrowser = null;
let asBrowserLaunch = null;
let asPage = null;
let asFetchQueue = Promise.resolve();

function detectBrowserExecutable() {
  if (process.env.AS_BROWSER) return process.env.AS_BROWSER;
  if (config.artstationBrowser) return config.artstationBrowser;
  const platform = process.platform;
  const candidates =
    platform === "win32"
      ? [
          (process.env["ProgramFiles(x86)"] || "") + "\\Microsoft\\Edge\\Application\\msedge.exe",
          (process.env.ProgramFiles || "") + "\\Microsoft\\Edge\\Application\\msedge.exe",
          (process.env.ProgramFiles || "") + "\\Google\\Chrome\\Application\\chrome.exe",
          (process.env["ProgramFiles(x86)"] || "") + "\\Google\\Chrome\\Application\\chrome.exe",
        ]
      : platform === "darwin"
      ? [
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/snap/bin/chromium",
        ];
  for (const path of candidates) {
    if (path && existsSync(path)) return path;
  }
  return "";
}

async function getAsBrowser() {
  if (asBrowser) return asBrowser;
  if (asBrowserLaunch) return asBrowserLaunch;
  const executablePath = detectBrowserExecutable();
  if (!executablePath) {
    throw asHttpError(
      502,
      "No Chrome/Edge/Chromium browser found for ArtStation access. Set AS_BROWSER (or config.artstationBrowser) to a browser executable path."
    );
  }
  asBrowserLaunch = puppeteer
    .launch({
      executablePath,
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
    })
    .then((browser) => {
      asBrowser = browser;
      asBrowserLaunch = null;
      return browser;
    })
    .catch((err) => {
      asBrowserLaunch = null;
      throw err;
    });
  return asBrowserLaunch;
}

function resetAsBrowser() {
  const old = asBrowser;
  asBrowser = null;
  asBrowserLaunch = null;
  asPage = null;
  if (old) old.close().catch(() => {});
}

async function getAsPage() {
  if (asPage) return asPage;
  const browser = await getAsBrowser();
  asPage = await browser.newPage();
  asPage.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  );
  asPage.setDefaultTimeout(60000);
  return asPage;
}

function asHttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function asBrowserFetchText(url) {
  let attempts = 0;
  for (;;) {
    try {
      const page = await getAsPage();
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (resp.status() === 200 || resp.status() === 304) {
        return await page.evaluate(() => document.body.innerText);
      }
      throw asHttpError(resp.status(), `ArtStation responded with HTTP ${resp.status()}.`);
    } catch (err) {
      const transient = err && typeof err === "object" && !err.status;
      if (transient && attempts++ < 1) {
        await new Promise((r) => setTimeout(r, 2000));
        resetAsBrowser();
        continue;
      }
      throw err;
    }
  }
}

async function asBrowserFetchJson(url) {
  const text = await asBrowserFetchText(url);
  try {
    return JSON.parse(text);
  } catch {
    throw asHttpError(502, "ArtStation returned data that could not be parsed as JSON.");
  }
}

function asFetchJson(url) {
  const run = asFetchQueue.then(async () => {
    try {
      const response = await fetch(url, { headers: AS_HEADERS });
      if (response.ok) return await response.json();
    } catch {}
    return asBrowserFetchJson(url);
  });
  asFetchQueue = run.then(() => {}, () => {});
  return run;
}

async function fetchJsonUrl(url) {
  try {
    const response = await fetch(url);
    if (response.ok) return JSON.parse(await response.text());
  } catch {}
  try {
    return await asBrowserFetchJson(url);
  } catch (err) {
    if (err instanceof SyntaxError) throw asHttpError(400, "The URL did not return valid JSON.");
    throw err;
  }
}

// Fetches a projects list URL, following ArtStation's pagination when the
// list reports a total_count larger than what a single page returns.
async function fetchProjectsList(url) {
  const all = [];
  let page = 1;
  for (;;) {
    const pageUrl = page === 1 ? url : `${url}${url.includes("?") ? "&" : "?"}page=${page}`;
    const json = await fetchJsonUrl(pageUrl);
    const list = Array.isArray(json) ? json : json.data || json.projects || json.artData;
    if (!Array.isArray(list)) {
      throw asHttpError(400, "The URL did not return a projects list.");
    }
    all.push(...list);
    const total = Array.isArray(json) ? undefined : json.total_count;
    if (typeof total === "number" && all.length < total && list.length) {
      page++;
      continue;
    }
    break;
  }
  return all;
}

// Normalizes a detail JSON response into the fields the manager stores.
function detailToFullEntry(detail, hash) {
  const images = [];
  for (const asset of detail.assets || []) {
    if (!asset || typeof asset !== "object") continue;
    if (asset.type === "video" || asset.video_player) continue;
    if (asset.image_url) images.push(toLargeUrl(asset.image_url));
  }

  let embed = "";
  for (const asset of detail.assets || []) {
    if (asset && typeof asset === "object" && asset.video_player) {
      embed = asset.video_player;
      break;
    }
  }

  const tags = [];
  for (const t of detail.tags || []) {
    if (typeof t === "string") tags.push(t);
    else if (t && typeof t === "object" && t.name) tags.push(t.name);
  }

  return {
    images,
    embed,
    tags,
    sourceLink: detail.permalink || (hash ? `https://www.artstation.com/artwork/${hash}` : ""),
    description: cleanHtml(detail.description) || undefined,
    title: detail.title || undefined,
  };
}

app.post("/api/artstation/import", async (req, res) => {
  try {
    const hash = artstationHashFromUrl(req.body && req.body.url);
    if (!hash) {
      return res.status(400).json({ error: "That doesn't look like an ArtStation artwork link." });
    }

    const api = `https://www.artstation.com/projects/${hash}.json`;
    let detail;
    try {
      detail = await asFetchJson(api);
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: "ArtStation could not find that artwork." });
      }
      if (err.status === 403 || err.status === 401) {
        return res.status(502).json({
          error: "ArtStation blocked the request (403) even for the built-in browser. Check that it can open artstation.com, then retry.",
        });
      }
      return res.status(502).json({ error: err.message });
    }

    const full = detailToFullEntry(detail, hash);

    const lowerTags = full.tags.map((t) => t.toLowerCase());
    const entry = {
      type: lowerTags.includes("professional") ? "professional" : "personal",
      is3D: lowerTags.includes("3d"),
      isAvatar: lowerTags.includes("avatar"),
      title: full.title || "",
      description: full.description || "",
      sourceLink: full.sourceLink,
      images: full.images,
      embed: full.embed,
      thumbnail: "",
      thumbnailCrop: null,
      tags: full.tags,
      id: hash,
    };

    res.json({ entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update from JSON (ArtStation projects list) ──
// Mirrors DataParser's build_json() merge: matches projects to existing
// entries by id, backfills existing ones with what the raw project list
// provides (cover thumbnail, description, link), and creates entries for
// new projects. Afterwards each entry that still lacks full images is
// fetched from its ArtStation source link (through the headless browser)
// so the artwork's full image list and tags come in automatically.

function extractCoverUrl(project) {
  const cover = (project && project.cover) || {};
  return cover.thumb_url || cover.small_square_url || cover.micro_square_image_url || "";
}

function extractTags(project) {
  const raw = (project && (project.tags || project.tag_list)) || [];
  const names = [];
  for (const t of raw) {
    if (typeof t === "string") names.push(t);
    else if (t && typeof t === "object" && t.name) names.push(t.name);
  }
  return names;
}

function hasFullImages(images) {
  return (images || []).some((img) => /\/large\/|\/original\//.test(String(img)));
}

function convertProjectFromList(project) {
  const thumbnailUrl = extractCoverUrl(project);
  const rawTags = extractTags(project);
  return {
    type: "personal",
    is3D: false,
    title: (project && project.title) || "",
    description: cleanHtml(project && project.description),
    sourceLink: (project && (project.permalink || project.url)) || "",
    images: thumbnailUrl ? [thumbnailUrl] : [],
    embed: "",
    thumbnail: thumbnailUrl,
    thumbnailCrop: null,
    tags: rawTags,
    isAvatar: rawTags.some((t) => String(t).toLowerCase() === "avatar"),
  };
}

function buildIdLookup(entries) {
  const lookup = {};
  for (const entry of entries || []) {
    if (entry.id) {
      lookup[entry.id] = entry;
      continue;
    }
    const m = String(entry.sourceLink || "").match(/\/artwork\/([^?#]+)/);
    if (m) lookup[m[1]] = entry;
  }
  return lookup;
}

function expandEntries(entries) {
  const expanded = [];
  for (const entry of entries) {
    if (entry.type !== "personal" && entry.type !== "professional") entry.type = "personal";
    if (entry.isAvatar) {
      entry.type = "personal";
      expanded.push(entry);
      continue;
    }
    const tags = (entry.tags || []).map((t) => String(t).toLowerCase());
    const orgTypes = [...new Set(tags.filter((t) => t === "personal" || t === "professional"))];
    const orgDims = [...new Set(tags.map((t) => (t === "3d" ? true : t === "2d" ? false : null)).filter((d) => d !== null))];
    if (!orgTypes.length && !orgDims.length) {
      expanded.push(entry);
      continue;
    }
    const typeValues = orgTypes.length ? orgTypes : [entry.type || "personal"];
    const dimValues = orgDims.length ? orgDims : [!!entry.is3D];
    for (const t of typeValues) {
      for (const d of dimValues) {
        expanded.push({ ...entry, type: t, is3D: d });
      }
    }
  }
  return expanded;
}

function mergeProjects(cacheEntries, projects) {
  const existingById = buildIdLookup(cacheEntries);
  const merged = [];
  const seenIds = new Set();
  for (const entry of cacheEntries) {
    if (entry.id && !seenIds.has(entry.id)) {
      merged.push(entry);
      seenIds.add(entry.id);
    }
  }

  let added = 0;
  let updated = 0;
  for (const project of projects) {
    if (!project || typeof project !== "object") continue;
    const hashId = project.hash_id || project.hash || project.id;
    if (!hashId) continue;
    const existing = existingById[hashId];
    if (existing) {
      let changed = false;
      if (!existing.id) {
        existing.id = hashId;
        changed = true;
      }
      if (!(existing.images || []).length) {
        const coverUrl = extractCoverUrl(project);
        if (coverUrl) {
          existing.images = [coverUrl];
          existing.thumbnail = coverUrl;
          changed = true;
        }
      }
      if (!existing.description) {
        const listDesc = cleanHtml(project.description);
        if (listDesc) {
          existing.description = listDesc;
          changed = true;
        }
      }
      if (!existing.sourceLink) {
        existing.sourceLink = project.permalink || project.url || "";
        if (existing.sourceLink) changed = true;
      }
      if (changed) updated++;
    } else {
      const entry = convertProjectFromList(project);
      entry.id = hashId;
      merged.push(entry);
      added++;
    }
  }

  return { artData: expandEntries(merged), added, updated };
}

// Fetches each artwork's detail JSON from its source link to fill in the
// full image list, embed, and tags. Projects are fetched once per unique
// id (entries may be expanded into several rows) and failures are skipped.
async function backfillArtstationImages(entries) {
  const byId = new Map();
  for (const entry of entries) {
    if (!entry || !entry.id || /^\d+$/.test(String(entry.id))) continue;
    if (hasFullImages(entry.images)) continue;
    const id = String(entry.id);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(entry);
  }

  const fetchGroup = async (id, group) => {
    const api = `https://www.artstation.com/projects/${id}.json`;
    const detail = await asFetchJson(api);
    const full = detailToFullEntry(detail, id);
    for (const entry of group) {
      entry.images = full.images;
      if (full.embed && !entry.embed) entry.embed = full.embed;
      if (full.tags.length && !(entry.tags || []).length) entry.tags = full.tags;
      if (full.description && !entry.description) entry.description = full.description;
      if (full.title && !entry.title) entry.title = full.title;
      if (full.sourceLink && !entry.sourceLink) entry.sourceLink = full.sourceLink;
    }
  };

  let imagesFetched = 0;
  let imageErrors = 0;
  const pending = [];
  for (const [id, group] of byId) {
    try {
      await fetchGroup(id, group);
      imagesFetched++;
    } catch (err) {
      pending.push({ id, group });
    }
  }
  for (const { id, group } of pending) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      await fetchGroup(id, group);
      imagesFetched++;
    } catch (err) {
      console.warn(`ArtStation backfill failed for ${id}: ${err.message}`);
      imageErrors++;
    }
  }
  return { imagesFetched, imageErrors };
}

app.post("/api/artstation/projects-import", async (req, res) => {
  try {
    const { url, projects, currentArtData } = req.body || {};
    const cacheEntries = Array.isArray(currentArtData) ? currentArtData : [];

    let parsedProjects = projects;
    if (parsedProjects == null && url) {
      try {
        parsedProjects = await fetchProjectsList(String(url));
      } catch (err) {
        const status = err.status || 500;
        if (status === 403) {
          return res.status(403).json({
            error: "That URL blocked the request (403) from the server and the built-in browser. Try uploading the file instead.",
          });
        }
        return res.status(status).json({
          error: status === 400 ? err.message : `Could not fetch the URL: ${err.message}`,
        });
      }
    }

    if (parsedProjects == null) {
      return res.status(400).json({ error: "Provide a projects.json URL or upload a file." });
    }

    const projectsArray = Array.isArray(parsedProjects)
      ? parsedProjects
      : parsedProjects.data || parsedProjects.projects || parsedProjects.artData || [];
    if (!Array.isArray(projectsArray)) {
      return res.status(400).json({ error: "The JSON does not contain a projects list." });
    }

    const result = mergeProjects(cacheEntries, projectsArray);
    const backfill = await backfillArtstationImages(result.artData);
    res.json({
      artData: result.artData,
      count: projectsArray.length,
      added: result.added,
      updated: result.updated,
      imagesFetched: backfill.imagesFetched,
      imageErrors: backfill.imageErrors,
    });
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
