import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.resolve(__dirname, "../../backend");
const targetDir = path.resolve(__dirname, "../backend");
const manifestPath = path.resolve(__dirname, ".backend-sync-manifest.json");

if (!fs.existsSync(sourceDir)) {
    console.error(`[sync-backend] Source backend directory not found: ${sourceDir}`);
    process.exit(1);
}

const shouldInclude = (srcPath) => {
    const name = path.basename(srcPath);

    if (name === ".venv" || name === "__pycache__") {
        return false;
    }

    if (name.endsWith(".pyc") || name.endsWith(".pyo")) {
        return false;
    }

    if (name === ".synced-from-root-backend") {
        return false;
    }

    return true;
};

function collectFileHashes(rootDir) {
    if (!fs.existsSync(rootDir)) {
        return {};
    }

    const fileHashes = {};
    const stack = [rootDir];

    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });

        for (const entry of entries) {
            const absolutePath = path.join(current, entry.name);

            if (!shouldInclude(absolutePath)) {
                continue;
            }

            if (entry.isDirectory()) {
                stack.push(absolutePath);
                continue;
            }

            const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");
            const content = fs.readFileSync(absolutePath);
            const hash = crypto.createHash("sha256").update(content).digest("hex");
            fileHashes[relativePath] = hash;
        }
    }

    return fileHashes;
}

function loadPreviousManifest() {
    if (!fs.existsSync(manifestPath)) {
        return undefined;
    }

    try {
        return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
        return undefined;
    }
}

function diffFileHashes(current, previous) {
    const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
    const diffs = [];

    for (const key of keys) {
        if (current[key] !== previous[key]) {
            diffs.push(key);
        }
    }

    return diffs.sort();
}

function assertNoLocalDrift() {
    if (!fs.existsSync(targetDir)) {
        return;
    }

    const previous = loadPreviousManifest();
    if (!previous?.files) {
        console.warn("[sync-backend] No sync manifest found, proceeding with bootstrap sync.");
        return;
    }

    const currentTargetHashes = collectFileHashes(targetDir);
    const drift = diffFileHashes(currentTargetHashes, previous.files);

    if (drift.length === 0) {
        return;
    }

    const sample = drift.slice(0, 10).join(", ");
    console.error("[sync-backend] Detected local edits in extension/backend since last sync.");
    console.error("[sync-backend] Edit files under backend/ (canonical), then re-run sync.");
    console.error(`[sync-backend] Drifted files (${drift.length}): ${sample}${drift.length > 10 ? ", ..." : ""}`);
    process.exit(1);
}

function writeManifestFromSource() {
    const sourceHashes = collectFileHashes(sourceDir);
    const manifest = {
        sourceDir,
        targetDir,
        generatedAt: new Date().toISOString(),
        files: sourceHashes,
    };

    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

assertNoLocalDrift();
fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: shouldInclude,
});
writeManifestFromSource();

console.log(`[sync-backend] Copied backend -> ${targetDir}`);
