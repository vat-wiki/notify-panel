#!/usr/bin/env node
// 入口:加载编译后的 dist/cli.js(build 步骤产出)。
// 发布到 npm 的就是这个 dist,不依赖 tsx,用户全局安装即用。
const { join, dirname } = require("node:path");
const { fileURLToPath } = require("node:url");
// require 用 __dirname(CJS 标准),不依赖 import.meta
require(join(__dirname, "..", "dist", "cli.js"));
