# 发版流程

本项目用 **版本号驱动** 的自动发版:你改版本号、push,CI 自动发 npm + 打 tag + 建 Release。
没有 changeset 文件、不开 PR、不建分支。

## 包清单

| 包 | 路径 | npm 名 | 分发方式 |
|----|------|--------|---------|
| 主包 | `packages/notify-panel/` | `notify-panel` | `npm install -g notify-panel` |
| pi 扩展 | `extensions/pi/` | `notify-panel-pi` | `pi install npm:notify-panel-pi@<ver>` 或 `pi install git:github.com/vat-wiki/notify-panel` |

> 想加新包:在 `packages/` 或 `extensions/` 下建目录,写 `package.json`(非 `private`),CI 自动纳入扫描。

## 发一个新版本(标准流程)

**前提:** 你要发的包有**实质改动**(代码 / 文档 / keywords 等),且准备让它上 npm。

### 第 1 步:改版本号

打开对应包的 `package.json`,把 `version` 往上加一位:

```bash
# 主包
$EDITOR packages/notify-panel/package.json     # 例:0.2.1 → 0.2.2(patch)/ 0.3.0(minor)

# pi 扩展
$EDITOR extensions/pi/package.json             # 例:0.1.0 → 0.1.1 / 0.2.0
```

**版本号怎么定(SemVer):**
- `patch`(0.2.1 → 0.2.2):bug 修复、文档完善、小调整
- `minor`(0.2.1 → 0.3.0):新功能、向后兼容的改动
- `major`(0.2.1 → 1.0.0):破坏性改动

### 第 2 步:提交并推送

```bash
git add -A
git commit -m "release: notify-panel@0.2.2"   # 或 notify-panel-pi@0.1.1
git push
```

### 第 3 步:等 CI,完事

push 到 `main` 会触发 `.github/workflows/release.yml`,它自动:

1. 跑 `npm test` + `npm run build`(失败会**拦住发版**,保护 npm 上不出现坏包)
2. 遍历 `packages/*` 和 `extensions/*`,比对每个包的本地 `version` 与 npm registry 上的版本
3. 本地版本号更高 → `npm publish` + `git tag <name>@<ver>` + 建 GitHub Release
4. 版本没变 → skip(改了代码但忘 bump 版本,不会误发)

查进度:
```bash
gh run watch              # 实时看当前跑的 workflow
gh run list --limit 5     # 看最近几次结果
```

发完验证:
```bash
npm view notify-panel version        # 或 notify-panel-pi
```

## 常见情况

### 只改了代码,不想发版

正常 commit + push 即可。CI 会跑 test/build,但 publish 步骤会 `✓ skip`(版本号没变)。
**不碰 `package.json` 的 version 就不会发。**

### 同时发多个包

各自改 version,一起 commit + push。CI 会逐个发布、各打各的 tag、各建各的 Release。

### 想跳过 CI(纯文档/配置改动,不想触发构建)

commit message 里加 `[skip ci]`:
```bash
git commit -m "docs: 修个错别字 [skip ci]"
```
两个 workflow 都不会跑。

### 发版失败怎么办

1. `gh run view <run-id>` 看哪一步挂了
2. 常见原因:
   - test / build 挂了 → 本地 `npm test` 复现、修了重 push
   - `npm publish` 报 403 → npm 账号没该包权限 / 没开 OIDC trusted publishing
   - `npm publish` 报 403 "You cannot publish over" → 版本号已存在,bump 再试
3. **npm 不会留下半成品**:publish 是原子的,失败就是没发上去,修了重跑即可。

## 前置设置(一次性,已经配好)

- **npm 账号权限**:仓库 owner 的 npm 账号对 `notify-panel` 和 `notify-panel-pi` 有发布权。新包首次发布会自动占用 scope。
- **OIDC trusted publishing**:workflow 用 `id-token: write` 走 npm OIDC,**不需要配 `NPM_TOKEN` secret**。前提是 npm 账号开了 trusted publishing(GitHub Actions)。
- **GitHub Actions 权限**:仓库 Settings → Actions → General → Workflow permissions = "Read and write"。

## 调试 workflow 脚本

想本地模拟 release.yml 的「比对版本」逻辑:

```bash
for pkg_dir in packages/* extensions/*; do
  [ -f "$pkg_dir/package.json" ] || continue
  name=$(node -p "require('./$pkg_dir/package.json').name")
  local_ver=$(node -p "require('./$pkg_dir/package.json').version")
  private=$(node -p "require('./$pkg_dir/package.json').private === true")
  [ "$private" = "true" ] && { echo "↷ skip $name (private)"; continue; }
  published=$(npm view "$name" version 2>/dev/null || echo "")
  if [ -z "$published" ]; then
    echo "📦 WILL PUBLISH $name@$local_ver (new)"
  elif [ "$(node -p "require('semver').gt('$local_ver','$published')")" = "true" ]; then
    echo "📦 WILL PUBLISH $name@$local_ver (npm has $published)"
  else
    echo "✓ skip $name@$local_ver (npm has $published)"
  fi
done
```
