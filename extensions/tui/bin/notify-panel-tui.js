#!/usr/bin/env node
// 包装入口:用 tsx 直接跑 TS 源,免构建步骤
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "src", "cli.ts");

const child = spawn(
  process.execPath,
  ["--import", "tsx", cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
