import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.resolve(__dirname, "../../backend");
const targetDir = path.resolve(__dirname, "../backend");

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

    return true;
};

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: shouldInclude,
});

console.log(`[sync-backend] Copied backend -> ${targetDir}`);
