# Conventions

- Shared product/domain contracts live in `src/shared/types.ts`; prefer extending those types before duplicating shapes in UI/server code.
- Review comments use category/severity unions from shared types; current categories: bug, refactor, performance, security, readability, suggestion.
- Local review data and exports are stored under `.diffvision/` in the inspected repository.
- UI copy emphasizes local-first/private review, offline runtime, command palette, review iterations, and local exports.
- AI provider flow in `AiReviewMockFlow` is explicitly mocked UI; MCP server is the real agent-facing integration surface.