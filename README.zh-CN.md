# Claude Code Delegate

[English](README.md) | **简体中文**

[![插件验证](https://github.com/awei-187/claude-code-delegate/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/awei-187/claude-code-delegate/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/awei-187/claude-code-delegate)](https://github.com/awei-187/claude-code-delegate/releases/latest)

Claude Code Delegate 是一个 Codex Skill：当用户明确提出委派请求时，它会把代码修改任务交给本地 Claude Code CLI 执行，运行预先固定的验证命令，再把结果交回 Codex 独立审查。

它适合同时使用 Codex 和 Claude Code，并希望以受控方式完成实现交接，而不是直接放任第二个编码智能体自由操作的用户。

```text
用户提出修改需求
    ↓
Codex 检查仓库并制定计划
    ↓
Claude Code 仅使用文件工具修改代码
    ↓
辅助程序运行预先固定的验证命令
    ↓
验证失败 → 在同一会话中进行有限修复（最多 2 轮）
    ↓
Codex 审查实际差异并报告结果
```

## Skill 提供的能力

- **显式委派**——仅当你指定 `$claude-code-delegate`，或明确要求 Codex 把实现工作委派给 Claude Code 时才会运行。
- **角色分离**——Codex 负责规划和审查，Claude Code 负责修改文件。
- **限制 Claude 的工具权限**——Claude 只能使用 Read、Edit、Write、Glob、Grep 和 NotebookEdit；不提供 Shell、子智能体和继承的 MCP 工具。
- **固定验证命令**——委派开始前，Codex 会确定一个已获授权的可执行文件和字面参数列表；Claude 无法替换或弱化该命令。
- **有限修复循环**——验证失败后，辅助程序最多可将有限的诊断信息送回同一个 Claude 会话，进行两轮针对性修复。
- **持久化任务**——长时间运行的工作具有任务 ID，支持状态查询、结果获取、取消、超时和清理。
- **跨平台运行**——Windows 使用可见的 PowerShell 工作窗口；Linux 和 macOS 使用分离式后台进程。
- **结构化结果**——最终 JSON 会记录状态、验证次数、实际使用的 Claude 模型、耗时、Claude 返回的费用信息以及稳定错误码。

## 适用场景

适合用于：

- 实现范围明确的功能；
- 修复可以复现的 Bug；
- 执行边界清晰的重构；
- 新增或更新测试；
- 让 Claude Code 负责实现，同时由 Codex 独立检查结果。

不适合只读解释或代码审查、安装依赖、交互式或监视型命令、破坏性操作、包含密钥的命令，以及任何尚未获得用户授权的工作。

## 环境要求

- 支持本地 Skill 的 Codex；
- Node.js 18.18 或更高版本；
- 已在本机安装并完成身份验证的 Claude Code CLI；
- Claude Code 支持 `--restricted`、`--tools` 和 `--strict-mcp-config`；
- 在 Windows 上使用可见工作窗口时，需要 Windows PowerShell。

本 Skill 没有 npm 运行时依赖。它不会替你安装 Claude Code，也不会替你登录账号。

## 安装为个人 Skill

最简单的安装方法是把 Skill 放入用户级 `.agents/skills` 目录。这样，在 Codex 中打开任何代码仓库时都可以使用它。

从 [Releases](https://github.com/awei-187/claude-code-delegate/releases/latest) 下载最新源码压缩包并解压，或者克隆仓库：

```powershell
git clone https://github.com/awei-187/claude-code-delegate.git
```

### Windows PowerShell

请在包含已克隆 `claude-code-delegate` 文件夹的目录中运行：

```powershell
$skillSource = (Resolve-Path ".\claude-code-delegate\skills\claude-code-delegate").Path; $skillTarget = "$env:USERPROFILE\.agents\skills\claude-code-delegate"; New-Item -ItemType Directory -Force $skillTarget | Out-Null; Copy-Item -Path "$skillSource\*" -Destination $skillTarget -Recurse -Force
```

### Linux 和 macOS

请在包含已克隆 `claude-code-delegate` 文件夹的目录中运行：

```bash
mkdir -p "$HOME/.agents/skills/claude-code-delegate" && cp -R "./claude-code-delegate/skills/claude-code-delegate/." "$HOME/.agents/skills/claude-code-delegate/"
```

Codex 通常会自动检测本地 Skill 变更。如果没有显示该 Skill，请重启 Codex 并新建一个任务。Skill 的加载位置和发现机制请参阅 [Codex 官方 Skill 文档](https://learn.chatgpt.com/zh-Hans/docs/build-skills)。

### 仅在当前仓库中安装

如果只希望在某个代码仓库中使用，请把同一个 `claude-code-delegate` Skill 目录复制到：

```text
<代码仓库>/.agents/skills/claude-code-delegate/
```

## 验证安装

首先检查本地环境：

```powershell
node --version
```

```powershell
claude --version
```

在 Windows 上，可以让已安装的辅助程序检查 Claude Code CLI 和必需参数：

```powershell
node "$env:USERPROFILE\.agents\skills\claude-code-delegate\scripts\claude-delegate.mjs" setup --json
```

在 Linux 或 macOS 上：

```bash
node "$HOME/.agents/skills/claude-code-delegate/scripts/claude-delegate.mjs" setup --json
```

安装就绪时，会返回类似以下内容的 JSON：

```json
{
  "available": true,
  "version": "<已安装的 Claude Code 版本>",
  "detail": "Claude Code CLI is available."
}
```

你也可以打开 Codex 的 Skill 选择器，确认列表中存在 `claude-code-delegate`。

## 使用 Skill

在需要修改的代码仓库中打开 Codex，然后在提示词里明确提到这个 Skill。本 Skill 有意关闭了隐式调用。

### 实现功能

```text
使用 $claude-code-delegate 为用户注册接口添加输入验证。保持现有 API 响应格式不变，并运行已有单元测试。
```

### 按验收标准修复 Bug

```text
使用 $claude-code-delegate 修复 Windows 路径处理问题。

验收标准：
- 包含空格的路径仍能正常工作；
- 路径不能逃逸出代码仓库根目录；
- 实现后运行 npm test。
```

### 重构

```text
使用 $claude-code-delegate 将缓存逻辑提取到单独模块中，不改变公开行为，并使用现有测试套件完成验证。
```

### 指定 Claude 模型或预算

只有需要覆盖本地 Claude 默认配置时，才在请求中指定模型或预算：

```text
使用 $claude-code-delegate，并指定 Claude 模型 <模型名称>、最高预算 2 美元，完成此修改并运行 npm test。
```

如果没有明确指定，Codex 应当保持模型和预算未设置，让本地 Claude Code 配置继续生效。

## 一次委派会经历什么

1. Codex 检查代码仓库、适用指令和已有改动。
2. Codex 制定具体实现计划和验收标准。
3. 如果已有安全、确定性的检查命令，Codex 会在启动 Claude 前固定其可执行文件、参数、工作目录、超时时间和最大修复次数。
4. Claude Code 通过标准输入接收限定范围的提示词，并仅使用文件工具修改代码仓库。
5. 辅助程序运行固定的验证命令。验证失败时，可以在同一个 Claude 会话中触发最多两轮修复。
6. Codex 获取持久化结果，检查实际文件和差异，并可再执行一次与风险相称的独立验证。
7. 审查结束后，除非用户要求保留诊断信息，否则会清理终态任务记录。

在 Windows 上，工作进程结束后，可见 PowerShell 窗口会保持打开，便于查看运行进度和退出状态。

## 任务状态、恢复与取消

通常由 Codex 负责管理这些命令。需要手动恢复时，请使用委派启动后返回的 `jobId`。

### 查询状态

```powershell
node "<Skill 目录>\scripts\claude-delegate.mjs" status --cwd "<代码仓库根目录>" --job-id "<任务 ID>" --json
```

### 获取最终结果

```powershell
node "<Skill 目录>\scripts\claude-delegate.mjs" result --cwd "<代码仓库根目录>" --job-id "<任务 ID>" --json
```

### 取消正在运行的任务

```powershell
node "<Skill 目录>\scripts\claude-delegate.mjs" cancel --cwd "<代码仓库根目录>" --job-id "<任务 ID>" --json
```

### 删除已审查的终态任务

```powershell
node "<Skill 目录>\scripts\claude-delegate.mjs" cleanup --cwd "<代码仓库根目录>" --job-id "<任务 ID>" --json
```

`cleanup` 会拒绝清理仍在运行的任务，并且只会永久删除通过校验的任务目录。在手动恢复、取消、处理超时或保留诊断信息之前，请阅读[运行时参考](skills/claude-code-delegate/references/runtime.md)。

## 安全与隐私

Claude 只能使用文件工具，但这只是**工具能力边界，并不是操作系统沙箱**。

- 委派根目录和验证目录都会解析为规范路径。提示词和验证路径不能通过路径穿越或链接逃逸。
- 验证命令使用辅助进程的操作系统权限运行，因此可能产生副作用。请只使用已经符合当前任务授权范围的命令。
- 为了保留身份验证、提供商和模型配置，辅助程序可能会传递现有 Claude `settings.json` 的路径。用户设置和托管设置属于受信任输入，可能包含钩子或额外目录。
- Claude 原始事件、标准错误输出、提示词、文件名、源代码片段和测试输出可能会临时保存在本机。
- 事件日志上限为 8 MiB，标准错误输出上限为 1 MiB，验证输出也会受到限制。
- 最终审查完成后，除非你要求保留诊断信息，否则 Skill 会清理终态任务记录。
- 本项目不会额外添加遥测、网络服务、凭据存储或账户系统。Claude Code 及其已配置的提供商仍可能按照各自配置和政策传输代码仓库内容。

完整边界请参阅 [PRIVACY.md](PRIVACY.md) 和 [SECURITY.md](SECURITY.md)。

## 常见问题

### Skill 没有出现在列表中

确认安装目录中直接包含 `SKILL.md`：

```text
~/.agents/skills/claude-code-delegate/SKILL.md
```

然后重启 Codex 并新建任务。由于已关闭隐式调用，请使用 `$claude-code-delegate` 明确调用。

### 安装检查提示 Claude 不可用

运行 `claude --version`，完成 Claude Code 的常规安装或登录流程，然后重新执行安装检查。本项目不会自动安装 Claude Code 或完成身份验证。

### Windows 上的中文变成问号

Windows PowerShell 5.1 的管道输出需要使用 UTF-8。Skill 在通过标准输入发送提示词时会使用以下设置：

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
```

### 任务失败或被中断

在获取最终结果前请保留任务目录。依次使用 `status` 和 `result`，不要仅根据文件是否发生变化来判断成功。工作进程异常时可能留下需要检查的子进程。

## 开发与验证

公开仓库中包含可分发的 Skill。运行检查：

```powershell
cd skills\claude-code-delegate
```

```powershell
npm run verify
```

测试套件使用模拟 Claude CLI，覆盖结构化验证、有限修复、超时、取消、任务恢复、命令引用、UTF-8 输入、日志限制、清理和路径约束。GitHub Actions 会在 Windows、Linux 和 macOS 上运行 Node.js 检查。

## 文档

- [Skill 指令](skills/claude-code-delegate/SKILL.md)
- [运行时与操作说明](skills/claude-code-delegate/references/runtime.md)
- [委派提示词模板](skills/claude-code-delegate/references/delegation-prompt.md)
- [隐私说明](PRIVACY.md)
- [安全说明](SECURITY.md)
- [更新日志](CHANGELOG.md)

## 发布内容范围

发布压缩包不包含凭据、Claude 设置、生成的任务记录、冒烟测试仓库或用户项目。
