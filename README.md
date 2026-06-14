<div align="center">

# 🛠️ DiffVision

**Premium local-first Git diff review tool shipped as a high-performance npm CLI.**

[![npm version](https://img.shields.io/npm/v/diffvision.svg?style=flat-square&color=6366f1)](https://www.npmjs.com/package/diffvision)
[![npm downloads](https://img.shields.io/npm/dm/diffvision.svg?style=flat-square&color=818cf8)](https://www.npmjs.com/package/diffvision)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square&color=a78bfa)](https://opensource.org/licenses/MIT)
[![Node version](https://img.shields.io/badge/node-%3E%3D20.0.0-60a5fa?style=flat-square&logo=node.js)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-34d399.svg?style=flat-square)](https://makeapullrequest.com)

[Explore Features](#key-features) • [Installation](#-installation) • [Quick Start](#-quick-start) • [AI Review](#ai-review-flow) • [MCP Server](#-mcp-stdio-server) • [Changelog](./CHANGELOG.md)

---

**DiffVision** transforms your local Git diffs into a rich, interactive experience. It opens your working tree in a focused browser UI, allowing you to inspect changes, track iterations, and export professional Markdown reviews—all without sending a single line of code to the cloud.

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/this-rafael/diffvision-app/master/docs/screenshots/dashboard.png" alt="DiffVision Dashboard" width="90%" style="border-radius: 10px; border: 1px solid #333;" />
</p>

### Theme Selection

<p align="center">
  <img src="https://raw.githubusercontent.com/this-rafael/diffvision-app/master/docs/screenshots/theme-bootstrap.png" alt="DiffVision Theme Selection" width="90%" style="border-radius: 10px; border: 1px solid #333;" />
</p>

### AI Review Flow

<p align="center">
  <img src="https://raw.githubusercontent.com/this-rafael/diffvision-app/master/docs/screenshots/ai-review-flow.png" alt="DiffVision AI Review Flow" width="90%" style="border-radius: 10px; border: 1px solid #333;" />
</p>

### Export Panel

<p align="center">
  <img src="https://raw.githubusercontent.com/this-rafael/diffvision-app/master/docs/screenshots/export-panel.png" alt="DiffVision Export Panel" width="90%" style="border-radius: 10px; border: 1px solid #333;" />
</p>

### Comment Composer

<p align="center">
  <img src="https://raw.githubusercontent.com/this-rafael/diffvision-app/master/docs/screenshots/comment-details.png" alt="DiffVision Comment Composer" width="90%" style="border-radius: 10px; border: 1px solid #333;" />
</p>

## Key Features

- **Local-First & Private**: Your code never leaves your machine. Full offline capability.
- **6 Premium Themes**: Choose from Dark, Dracula, Lust, OneLight, MinTheme, and PaperColor. Each theme drives both page chrome and syntax highlighting.
- **Split & Unified Diffs**: Toggle between side-by-side and unified diff layouts with fullscreen support.
- **Interactive Comments**: Add inline review comments with categories (Bug, Refactor, Performance, Security, Readability, Suggestion) and severity levels (info, minor, major, critical).
- **AI Review Flow**: Built-in 6-step wizard to configure AI agents (GitHub Copilot CLI, Qwen Code, Gemini CLI, Claude Code), draft review guides, categorize rules, and run mocked reviews.
- **Iteration Tracking**: Keep a local history of your reviews (`v1`, `v2`, `v3`) automatically with a visual timeline.
- **Command Palette**: Fast navigation and actions via `Ctrl/Cmd + K`. Search files, comments, bookmarks and commands.
- **File Bookmarks & Filters**: Bookmark important files and filter by all, modified, added, untracked, staged, unstaged, or bookmarked.
- **Line Selection**: Click to select a line, Shift-click to extend the selection range.
- **Local Export**: Generate polished Markdown reports or JSON exports into `.diffvision/`.
- **MCP Server**: Ships with a built-in Model Context Protocol server for integration with AI coding agents.
- **High Performance**: Powered by Fastify and React for a near-instant review experience.

---

## 🚀 Installation

Install DiffVision globally or run it on-the-fly using your favorite package manager.

### Global Install
```bash
npm install -g diffvision
# or
pnpm add -g diffvision
```

### Run without install
```bash
npx diffvision
# or
pnpm dlx diffvision
# or
bunx diffvision
```

---

## 🏁 Quick Start

Just run `diffvision` inside any Git repository:

```bash
diffvision
```

### Advanced Usage

```bash
# Compare current changes relative to 'main'
diffvision main

# Specify a different directory
diffvision --cwd /path/to/repo

# View what is new in 'feature-branch' relative to 'develop'
diffvision --new-in feature-branch --relative-to develop
```

---

## ⚙️ How it Works

DiffVision is designed for offline-first review workflows. It stores configuration and generated exports inside your repository:

- `<repo-root>/.diffvision/config.json`: Local UI preferences.
- `<repo-root>/.diffvision/comments.json`: Active review draft.
- `<repo-root>/.diffvision/exports/*.md`: Your archived review reports.

---

## 🛠️ Tech Stack

<div align="center">

| Component | Technology |
| :--- | :--- |
| **Frontend** | [React](https://reactjs.org/) + [Vite](https://vitejs.dev/) + [TailwindCSS](https://tailwindcss.com/) |
| **Icons** | [Lucide React](https://lucide.dev/) |
| **Server** | [Fastify](https://www.fastify.io/) + [WebSockets](https://github.com/fastify/fastify-websocket) |
| **Language** | [TypeScript](https://www.typescriptlang.org/) |
| **Syntax Highlighting** | [PrismJS](https://prismjs.com/) |
| **Agent Protocol** | [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) |

</div>

---

## 🤖 MCP Stdio Server

`diffvision-mcp` bridges the gap between your local review session and AI agents. It allows AI clients to inspect diffs and write comments directly into your active draft.

<details>
<summary><b>📖 Click to see MCP Configuration</b></summary>

### VS Code Configuration (`mcp.json`)

```json
{
  "servers": {
    "diffvision": {
      "type": "stdio",
      "command": "diffvision-mcp",
      "args": ["--cwd", "${workspaceFolder}"]
    }
  }
}
```

### Available Tools
- `get_repo_overview`: Metadata and file list.
- `read_diff`: Raw patch + existing comments.
- `list_review_comments`: History and draft comments.
- `create_review_comment`: Append new comments from the agent.

</details>

---

## Keyboard Shortcuts

<p align="center">
  <img src="https://raw.githubusercontent.com/this-rafael/diffvision-app/master/docs/screenshots/command-palette.png" alt="DiffVision Command Palette" width="90%" style="border-radius: 10px; border: 1px solid #333;" />
</p>

| Shortcut | Action |
| :--- | :--- |
| `Ctrl/Cmd + K` | Open command palette |
| `Ctrl/Cmd + E` | Open export panel |
| `Ctrl/Cmd + P` | Find file |
| `Ctrl/Cmd + R` | Refresh repository snapshot |
| `Ctrl/Cmd + Enter` | Save comment |
| `Esc` | Close palette/export panel/comment composer |
| `Shift + Click` | Extend line selection range |

---

## 📑 CLI Reference

<details>
<summary><b>🔍 Click to expand CLI Options</b></summary>

| Option | Description |
| :--- | :--- |
| `--host <host>` | Host to bind the local server. |
| `--port <port>` | Preferred port for the local server. |
| `--compare <ref>` | Base ref (legacy alias for --base). |
| `--new-in <ref>` | Show what is new in this ref. |
| `--relative-to <ref>` | Compare the `--new-in` ref relative to this ref. |
| `--base <ref>` | Legacy alias for --new-in. |
| `--target <ref>` | Legacy alias for --relative-to. |
| `--open` | Force browser launch. |
| `--no-open` | Disable automatic browser launch. |
| `--cwd <path>` | Inspect a repository different from the current directory. |
| `--ui-origin <url>` | Development UI origin override. |
| `--logs <mode>` | Enable terminal logging (`all` for full logs). |
| `--version` | Print the installed version. |
| `--help` | Show CLI help. |

</details>

---

## 🏗️ Development

```bash
# Install dependencies
pnpm install

# Start UI and Server in dev mode
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test
```

---

## 🤝 Contributing


Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

<div align="center">
  <sub>Built with ❤️ by the DiffVision Team</sub>
</div>
