# Tech Stack

- TypeScript ESM package, Node >=20.
- Frontend: React 18, Vite 5, Tailwind CSS 4, lucide-react, PrismJS.
- Backend: Fastify 5, `@fastify/static`, `@fastify/websocket`.
- CLI/build: `tsx` for dev entrypoints, `tsup` for server/CLI bundles.
- Agent integration: `@modelcontextprotocol/sdk` exposes `diffvision-mcp` stdio server.
- Tests/lint: Vitest 3, ESLint 9 with TypeScript/React hooks configs.