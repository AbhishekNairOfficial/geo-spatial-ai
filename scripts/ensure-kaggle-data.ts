/**
 * Runs before `next dev` (package.json `predev`). If DATA_PROVIDER=kaggle and
 * ingested artifacts are missing, runs the same ingestion as `npm run build:data`
 * so `next dev` works without a separate step.
 *
 * Skips immediately when DATA_PROVIDER is not kaggle, or when summary.json exists.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { config as loadEnv } from "dotenv";

const root = process.cwd();
const envFile = path.join(root, ".env");
const envLocal = path.join(root, ".env.local");
if (existsSync(envFile)) loadEnv({ path: envFile });
if (existsSync(envLocal)) loadEnv({ path: envLocal, override: true });

const dataProvider = process.env.DATA_PROVIDER ?? "static";
if (dataProvider !== "kaggle") {
  process.exit(0);
}

const marker = path.join(root, "public", "data", "kaggle", "summary.json");
if (existsSync(marker)) {
  process.exit(0);
}

console.log(
  "[ensure-kaggle] DATA_PROVIDER=kaggle but public/data/kaggle/ is empty — running build:data…"
);
execSync("npm run build:data", { stdio: "inherit", cwd: root, env: process.env });
