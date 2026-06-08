import { execSync } from "child_process";
import { existsSync, copyFileSync, cpSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");

function run(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function detectTarget() {
  const platform = process.platform;
  const arch = process.arch;
  const map = {
    "darwin-x64": "macos-x64",
    "darwin-arm64": "macos-arm64",
    "linux-x64": "linux-x64",
    "linux-arm64": "linux-arm64",
    "win32-x64": "win-x64",
    "win32-arm64": "win-arm64",
  };
  const key = `${platform}-${arch}`;
  const target = map[key];
  if (!target) throw new Error(`Unsupported platform: ${key}`);
  return target;
}

function appBinaryName(target) {
  if (target.startsWith("win")) return "manage-app.exe";
  return "manage-app";
}

const TARGET = detectTarget();
console.log(`Building for ${TARGET}`);

mkdirSync(DIST, { recursive: true });

// 1. Bundle server.js + deps into a single CJS file
run(`npx esbuild server.js --bundle --platform=node --format=cjs --outfile="${join(DIST, "bundle.cjs")}"`);

// 2. Copy public/ folder to dist/
const publicSrc = join(ROOT, "public");
const publicDest = join(DIST, "public");
cpSync(publicSrc, publicDest, { recursive: true });

// 3. Create SEA config
const seaConfig = {
  main: join(DIST, "bundle.cjs"),
  output: join(DIST, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
};
const configPath = join(DIST, "sea-config.json");
writeFileSync(configPath, JSON.stringify(seaConfig, null, 2));

// 4. Generate the SEA blob
run(`node --experimental-sea-config "${configPath}"`);

// 5. Prepare node binary
const nodeBin = process.execPath;
const thinnedBin = join(DIST, "node-thinned");

if (TARGET.startsWith("macos")) {
  try {
    const info = execSync(`lipo -info "${nodeBin}"`, {
      encoding: "utf8",
    });

    console.log(info.trim());

    if (info.includes("Non-fat file")) {
      console.log("Node is already single-architecture, copying...");
      copyFileSync(nodeBin, thinnedBin);
    } else {
      const arch = TARGET === "macos-arm64"
        ? "arm64"
        : "x86_64";

      console.log(`Thinning universal binary to ${arch}...`);

      execSync(
        `lipo "${nodeBin}" -thin ${arch} -output "${thinnedBin}"`,
        { stdio: "inherit" }
      );
    }
  } catch (err) {
    console.warn(
      "Could not determine binary architecture, copying Node executable."
    );
    copyFileSync(nodeBin, thinnedBin);
  }
} else {
  copyFileSync(nodeBin, thinnedBin);
}

// 6. Copy and inject blob into the binary
const appBin = join(DIST, appBinaryName(TARGET));
copyFileSync(thinnedBin, appBin);
rmSync(thinnedBin);

const blobPath = join(DIST, "sea-prep.blob");
const sentinel = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const extra = TARGET.startsWith("macos") ? "--macho-segment-name NODE_SEA" : "";
run(`npx postject "${appBin}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse "${sentinel}" ${extra}`);

// 7. macOS ad-hoc codesign
if (TARGET.startsWith("macos")) {
  run(`codesign --sign - "${appBin}"`);
}

// 8. Cleanup intermediate files
for (const f of ["bundle.cjs", "sea-config.json", "sea-prep.blob"]) {
  const fp = join(DIST, f);
  if (existsSync(fp)) rmSync(fp);
}

console.log(`\nDone! Binary at: ${appBin}`);
