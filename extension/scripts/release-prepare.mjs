import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJsonPath = path.resolve(__dirname, "../package.json");

function parseVersionArg(argv) {
    const index = argv.indexOf("--version");
    if (index === -1 || !argv[index + 1]) {
        return "";
    }
    return argv[index + 1].trim();
}

function assertSemver(version) {
    const semverRegex = /^\d+\.\d+\.\d+$/;
    if (!semverRegex.test(version)) {
        console.error(`[release:prepare] Invalid version '${version}'. Expected format x.y.z (e.g. 0.0.2)`);
        process.exit(1);
    }
}

function updatePackageVersion(version) {
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw);
    const previous = pkg.version;

    if (previous === version) {
        console.log(`[release:prepare] package.json is already at version ${version}`);
        return;
    }

    pkg.version = version;
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 4)}\n`, "utf8");
    console.log(`[release:prepare] Updated version ${previous} -> ${version}`);
}

function printNextSteps(version) {
    console.log("\n[release:prepare] Next steps:");
    console.log("1) Update CHANGELOG.md for this release (if needed)");
    console.log("2) Run: npm run compile && npm run lint && npm run vsix");
    console.log("3) Commit: git add extension/package.json CHANGELOG.md && git commit -m \"chore(release): v" + version + "\"");
    console.log("4) Tag: git tag v" + version);
    console.log("5) Push: git push && git push --tags");
    console.log("6) Create GitHub release from tag v" + version);
}

const version = parseVersionArg(process.argv);
if (!version) {
    console.error("[release:prepare] Missing required argument --version <x.y.z>");
    process.exit(1);
}

assertSemver(version);
updatePackageVersion(version);
printNextSteps(version);
