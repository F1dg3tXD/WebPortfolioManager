import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "fs";
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

app.use(express.json({ limit: "10mb" }));
app.use(express.static(publicDir));

let currentSha = null;

function getAuthHeaders() {
  return {
    Authorization: `token ${config.githubToken}`,
    Accept: "application/vnd.github.v3+json",
  };
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
    const response = await fetch(api, { headers: getAuthHeaders() });
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

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Manage app running at ${url}`);
  if (!config.githubToken) {
    console.log("No GitHub token configured. Open the app and click the gear icon to set it up.");
  }
  import("open").then((m) => m.default(url)).catch(() => {});
});
