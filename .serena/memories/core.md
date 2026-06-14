# Core

- Product: `diffvision` npm CLI for local-first Git diff review.
- Main references for product behavior: README, `src/shared/types.ts`, `src/ui/App.tsx`, `src/ui/components/*`, `src/server/index.ts`, `src/cli/index.ts`, `src/cli/mcp.ts`.
- UI is a browser app served by local Fastify/CLI flow; CLI opens/serves repository snapshots from a target Git repo.
- Durable product surfaces: split/unified diff viewer, file filtering/search, inline review comments, review iterations, Markdown/JSON export, MCP stdio server.
- Related memories: stack/commands in `mem:tech_stack`, `mem:suggested_commands`; completion checks in `mem:task_completion`.