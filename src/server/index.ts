import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { SocketStream } from "@fastify/websocket";
import {
  assertValidCompareRef,
  createMarkdownReport,
  createReviewJsonPayload,
  loadRepositorySnapshot,
} from "../lib/repository";
import { isAllLogsEnabled, logAll, logAllError } from "../lib/logger";
import {
  readConfig,
  readReviewHistory,
  writeConfig,
  writeReviewHistory,
  writeExportReport,
} from "../lib/storage";
import type {
  DiffVisionConfig,
  ExportRequest,
  ServerMessage,
} from "../shared/types";

export interface ServerOptions {
  repoRoot: string;
  host: string;
  port: number;
  staticDir?: string;
  uiOrigin?: string;
  configOverride?: Partial<DiffVisionConfig>;
}

export function resolveEmbeddedUiDirectory() {
  const current = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(current, "../ui"),
    path.resolve(current, "../../dist/ui"),
  ];

  for (const candidate of candidates) {
    const hasIndex = existsSync(path.join(candidate, "index.html"));
    const hasAssets = existsSync(path.join(candidate, "assets"));
    if (hasIndex && hasAssets) {
      return candidate;
    }
  }

  throw new Error(
    "Embedded UI not found. Run `pnpm build` or start with `--ui-origin <url>`.",
  );
}

async function proxyUi(url: string, uiOrigin: string) {
  const response = await fetch(`${uiOrigin}${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    body: buffer,
    headers: response.headers,
    status: response.status,
  };
}

export async function createServer(options: ServerOptions) {
  const app = Fastify({ logger: false });
  const sockets = new Set<SocketStream["socket"]>();
  let lastHash = "";
  let runtimeConfig = { ...(options.configOverride ?? {}) };

  logAll("server", "creating server", {
    repoRoot: options.repoRoot,
    host: options.host,
    port: options.port,
    uiOrigin: options.uiOrigin,
  });

  async function getActiveConfig() {
    return {
      ...(await readConfig(options.repoRoot)),
      ...runtimeConfig,
    };
  }

  await app.register(fastifyWebsocket);

  if (isAllLogsEnabled()) {
    app.addHook("onRequest", async (request) => {
      logAll("http", "request", {
        method: request.method,
        url: request.url,
      });
    });

    app.addHook("onResponse", async (request, reply) => {
      logAll("http", "response", {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
      });
    });
  }

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/repo", async () => {
    logAll("server", "loading /api/repo snapshot");
    return loadRepositorySnapshot(options.repoRoot, await getActiveConfig());
  });

  app.get("/api/config", async () => {
    return getActiveConfig();
  });

  app.get("/api/comments", async () => {
    return {
      history: await readReviewHistory(options.repoRoot),
    };
  });

  app.put<{ Body: { history?: unknown } & Record<string, unknown> }>(
    "/api/comments",
    async (request) => {
      const historyInput = Object.prototype.hasOwnProperty.call(
        request.body ?? {},
        "history",
      )
        ? request.body.history
        : request.body;
      const history = await writeReviewHistory(options.repoRoot, historyInput);
      return { history };
    },
  );

  app.put<{ Body: Partial<DiffVisionConfig> }>(
    "/api/config",
    async (request) => {
      logAll("server", "updating config", { body: request.body });
      const current = await readConfig(options.repoRoot);
      const next = {
        ...current,
        ...request.body,
      };

      if (typeof next.compareRef === "string") {
        next.compareRef = await assertValidCompareRef(
          options.repoRoot,
          next.compareRef,
        );
      }

      if (typeof next.compareTargetRef === "string") {
        const normalizedTargetRef = next.compareTargetRef.trim();
        next.compareTargetRef = normalizedTargetRef
          ? await assertValidCompareRef(options.repoRoot, normalizedTargetRef)
          : undefined;
      }

      const written = await writeConfig(options.repoRoot, next);
      runtimeConfig = {
        ...runtimeConfig,
        ...request.body,
        compareRef: written.compareRef,
        compareTargetRef: written.compareTargetRef,
      };

      return {
        ...written,
        ...runtimeConfig,
      };
    },
  );

  app.post<{ Body: ExportRequest }>("/api/export", async (request) => {
    logAll("server", "generating export", {
      title: request.body.title,
      notesLength: request.body.notes?.length ?? 0,
    });
    const snapshot = await loadRepositorySnapshot(
      options.repoRoot,
      await getActiveConfig(),
    );
    const title =
      request.body.title?.trim() || `DiffVision review ${snapshot.repoName}`;
    const markdown = createMarkdownReport(
      snapshot,
      request.body.notes,
      request.body.comments,
      title,
      {
        reviews: request.body.reviews,
        activeReviewId: request.body.activeReviewId,
        selection: request.body.selection,
      },
    );
    const exportPath = await writeExportReport(
      options.repoRoot,
      title,
      markdown,
    );
    return {
      path: exportPath,
      markdown,
    };
  });

  app.post<{ Body: ExportRequest }>("/api/export/markdown", async (request) => {
    logAll("server", "generating markdown export", {
      title: request.body.title,
      notesLength: request.body.notes?.length ?? 0,
    });
    const snapshot = await loadRepositorySnapshot(
      options.repoRoot,
      await getActiveConfig(),
    );
    const title =
      request.body.title?.trim() || `DiffVision review ${snapshot.repoName}`;
    const markdown = createMarkdownReport(
      snapshot,
      request.body.notes,
      request.body.comments,
      title,
      {
        reviews: request.body.reviews,
        activeReviewId: request.body.activeReviewId,
        selection: request.body.selection,
      },
    );
    return { markdown };
  });

  app.post<{ Body: ExportRequest }>(
    "/api/export/review-json",
    async (request) => {
      logAll("server", "generating review json export", {
        title: request.body.title,
        notesLength: request.body.notes?.length ?? 0,
      });
      const snapshot = await loadRepositorySnapshot(
        options.repoRoot,
        await getActiveConfig(),
      );
      const title =
        request.body.title?.trim() || `DiffVision review ${snapshot.repoName}`;
      const payload = createReviewJsonPayload(
        snapshot,
        request.body.notes,
        request.body.comments,
        title,
        {
          reviews: request.body.reviews,
          activeReviewId: request.body.activeReviewId,
          selection: request.body.selection,
        },
      );
      return { json: JSON.stringify(payload) };
    },
  );

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    logAll("ws", "socket connected", { activeSockets: sockets.size });
    socket.on("close", () => sockets.delete(socket));
    socket.on("close", () => {
      logAll("ws", "socket closed", { activeSockets: sockets.size });
    });
  });

  const poll = setInterval(async () => {
    try {
      const snapshot = await loadRepositorySnapshot(
        options.repoRoot,
        await getActiveConfig(),
      );
      const message: ServerMessage =
        snapshot.hash !== lastHash
          ? {
              type: "snapshot:update",
              hash: snapshot.hash,
              changedFiles: snapshot.changedFiles,
              branch: snapshot.branch,
              lastUpdated: snapshot.lastUpdated,
            }
          : {
              type: "heartbeat",
              lastUpdated: new Date().toISOString(),
            };

      if (snapshot.hash !== lastHash) {
        lastHash = snapshot.hash;
        logAll("poll", "snapshot changed", {
          changedFiles: snapshot.changedFiles,
          branch: snapshot.branch,
          hash: snapshot.hash,
        });
      }

      const payload = JSON.stringify(message);
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.send(payload);
        }
      }
    } catch (error) {
      // Polling should not crash the server on transient git errors.
      logAllError("poll", "snapshot polling failed", error);
    }
  }, 3000);

  app.addHook("onClose", async () => {
    clearInterval(poll);
  });

  if (options.uiOrigin) {
    app.get("/*", async (request, reply) => {
      const proxied = await proxyUi(request.raw.url || "/", options.uiOrigin!);
      proxied.headers.forEach((value, key) => reply.header(key, value));
      reply.status(proxied.status).send(proxied.body);
    });
  } else {
    const staticDir = options.staticDir ?? resolveEmbeddedUiDirectory();

    await app.register(fastifyStatic, {
      root: path.join(staticDir, "assets"),
      prefix: "/assets/",
    });

    app.get("/", async (_request, reply) => {
      const html = await readFile(path.join(staticDir, "index.html"));
      reply.type("text/html").send(html);
    });

    app.get("/*", async (_request, reply) => {
      const html = await readFile(path.join(staticDir, "index.html"));
      reply.type("text/html").send(html);
    });
  }

  return app;
}

export async function startServer(options: ServerOptions) {
  const app = await createServer(options);
  await app.listen({ host: options.host, port: options.port });
  logAll("server", "listening", { host: options.host, port: options.port });
  return app;
}
