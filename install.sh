#!/usr/bin/env sh
# notify-panel 安装脚本
#
# 用法(从本仓库 raw 文件安装):
#   curl -fsSL https://raw.githubusercontent.com/<owner>/notify-panel/main/install.sh | sh
#
# 它做的事:
#   1. 检测 Node.js(>= 18),没有就提示安装
#   2. npm install -g notify-panel
#   3. 校验 notify-panel --version
#
# 不带 sudo:npm 全局目录若需要权限,会提示用 nvm / 配 prefix。
# 这是有意为之 —— 直接 sudo 装到系统目录是 npm 全局安装的常见踩坑点。

set -e

# ---------- 颜色 ----------
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; NC=''
fi

info()  { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$1"; }
fatal() { printf "${RED}✗${NC} %s\n" "$1"; exit 1; }

# ---------- 1. Node.js 检测 ----------
if ! command -v node >/dev/null 2>&1; then
  fatal "未检测到 Node.js。请先安装 Node.js 18+:
  https://nodejs.org/
推荐用 nvm 管理多版本:
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | sh"
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  fatal "Node.js 版本过低(当前 $(node -v),需要 18+)。请升级:
  nvm install 18 && nvm use 18"
fi
info "Node.js $(node -v) 检测通过"

# ---------- 2. npm 全局安装 ----------
printf "正在安装 notify-panel ...\n"
if npm install -g notify-panel 2>&1; then
  :
else
  warn "npm install -g 失败。上面是 npm 输出的真实原因,请先看它。"
  echo ""
  echo "最常见的原因及修复:"
  echo ""
  echo "  • 404 / 包找不到 → 还没发布到 npm,改用本地安装:"
  echo "      git clone <repo> && cd notify-panel && npm install && npm run build"
  echo "      cd packages/cli && npm link"
  echo ""
  echo "  • EACCES / 权限错误 → npm 全局目录无写权限,二选一:"
  echo "      方式 A(推荐):用 nvm"
  echo "        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | sh"
  echo "        nvm install 18 && nvm use 18"
  echo "      方式 B:改 npm 全局 prefix"
  echo "        mkdir -p ~/.npm-global && npm config set prefix '~/.npm-global'"
  echo "        # 把 ~/.npm-global/bin 加到 PATH"
  echo ""
  echo "  修复后重新运行本脚本即可。"
  fatal "安装中断"
fi

# ---------- 3. 校验 ----------
if ! command -v notify-panel >/dev/null 2>&1; then
  warn "notify-panel 已安装但不在 PATH。"
  echo ""
  echo "npm 全局 bin 目录通常是以下之一,把它加到 PATH:"
  echo "  \$(npm config get prefix)/bin"
  echo "  ~/.npm-global/bin     (若改过 prefix)"
  echo ""
  echo "加到 ~/.bashrc / ~/.zshrc 后重开终端即可。"
  exit 0
fi

VERSION=$(notify-panel --version 2>/dev/null || echo "unknown")
info "notify-panel $VERSION 安装成功!"

echo ""
echo "下一步:"
echo "  notify-panel install                # 一步到位:开机自启 + 立即启动"
echo "  notify-panel push ci build 'hello'   # 推一条通知试试"
echo ""
echo "(daemon 默认只监听本机,免密钥。暴露到网络才需 --secret)"
