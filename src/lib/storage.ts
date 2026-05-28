import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { logAll } from "./logger";
import { createReviewHistory } from "../shared/reviews";
import type {
  DiffVisionConfig,
  ReviewComment,
  ReviewHistory,
  ReviewVersion,
} from "../shared/types";

export const defaultConfig: DiffVisionConfig = {
  theme: "dark",
  openBrowser: true,
  defaultView: "side-by-side",
  port: 3210,
  host: "127.0.0.1",
  compareRef: "HEAD",
  compareTargetRef: undefined,
};

export function getStoragePaths(repoRoot: string) {
  const root = path.join(repoRoot, ".diffvision");
  return {
    root,
    config: path.join(root, "config.json"),
    comments: path.join(root, "comments.json"),
    exports: path.join(root, "exports"),
  };
}

export async function ensureStorage(repoRoot: string) {
  const paths = getStoragePaths(repoRoot);
  logAll("storage", "ensure storage", { paths });
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.exports, { recursive: true });
  return paths;
}

export async function readConfig(repoRoot: string): Promise<DiffVisionConfig> {
  const paths = await ensureStorage(repoRoot);
  logAll("storage", "read config", { path: paths.config });

  try {
    const raw = await readFile(paths.config, "utf8");
    const parsed = JSON.parse(raw) as Partial<DiffVisionConfig>;

    return {
      ...defaultConfig,
      ...parsed,
      defaultView:
        parsed.defaultView === "unified" ||
        parsed.defaultView === "side-by-side"
          ? parsed.defaultView
          : defaultConfig.defaultView,
      theme: parsed.theme === "system" ? "system" : defaultConfig.theme,
      port:
        typeof parsed.port === "number" && Number.isFinite(parsed.port)
          ? parsed.port
          : defaultConfig.port,
      host:
        typeof parsed.host === "string" && parsed.host.trim()
          ? parsed.host
          : defaultConfig.host,
      compareRef:
        typeof parsed.compareRef === "string" && parsed.compareRef.trim()
          ? parsed.compareRef.trim()
          : defaultConfig.compareRef,
      compareTargetRef:
        typeof parsed.compareTargetRef === "string" &&
        parsed.compareTargetRef.trim()
          ? parsed.compareTargetRef.trim()
          : undefined,
      openBrowser:
        typeof parsed.openBrowser === "boolean"
          ? parsed.openBrowser
          : defaultConfig.openBrowser,
    };
  } catch {
    logAll("storage", "config missing or invalid, using default", {
      path: paths.config,
    });
    return { ...defaultConfig };
  }
}

export async function writeConfig(
  repoRoot: string,
  config: DiffVisionConfig,
): Promise<DiffVisionConfig> {
  const paths = await ensureStorage(repoRoot);
  logAll("storage", "write config", { path: paths.config });
  await writeFile(paths.config, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export async function writeExportReport(
  repoRoot: string,
  title: string,
  markdown: string,
): Promise<string> {
  const paths = await ensureStorage(repoRoot);
  const safe = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(paths.exports, `${stamp}-${safe || "review"}.md`);
  logAll("storage", "write export report", {
    path: filePath,
    title,
    bytes: Buffer.byteLength(markdown),
  });
  await writeFile(filePath, markdown, "utf8");
  return filePath;
}

function isCommentSeverity(value: unknown): value is ReviewComment["severity"] {
  return (
    value === "info" ||
    value === "minor" ||
    value === "major" ||
    value === "critical"
  );
}

function isCommentCategory(value: unknown): value is ReviewComment["category"] {
  return (
    value === "bug" ||
    value === "refactor" ||
    value === "performance" ||
    value === "security" ||
    value === "readability" ||
    value === "suggestion"
  );
}

function normalizeReviewVersion(value: unknown): ReviewVersion | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !record.id.trim() ||
    typeof record.version !== "number" ||
    !Number.isFinite(record.version) ||
    record.version < 1 ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }

  const exportedAt =
    typeof record.exportedAt === "string" && record.exportedAt.trim()
      ? record.exportedAt
      : undefined;
  const lastExportTitle =
    typeof record.lastExportTitle === "string" && record.lastExportTitle.trim()
      ? record.lastExportTitle.trim()
      : undefined;
  const lastExportNotes =
    typeof record.lastExportNotes === "string" && record.lastExportNotes.trim()
      ? record.lastExportNotes.trim()
      : undefined;

  return {
    id: record.id.trim(),
    version: Math.max(1, Math.floor(record.version)),
    createdAt: record.createdAt,
    exportedAt,
    lastExportTitle,
    lastExportNotes,
  };
}

function normalizeComment(
  value: unknown,
  defaultReviewId: string,
  validReviewIds?: Set<string>,
): ReviewComment | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const line =
    typeof record.line === "number" && Number.isFinite(record.line)
      ? Math.max(1, Math.floor(record.line))
      : 0;
  if (!line) {
    return null;
  }

  const endLine =
    typeof record.endLine === "number" && Number.isFinite(record.endLine)
      ? Math.max(line, Math.floor(record.endLine))
      : undefined;
  const startColumn =
    typeof record.startColumn === "number" &&
    Number.isFinite(record.startColumn)
      ? Math.max(1, Math.floor(record.startColumn))
      : undefined;
  const endColumn =
    typeof record.endColumn === "number" && Number.isFinite(record.endColumn)
      ? Math.max(1, Math.floor(record.endColumn))
      : undefined;
  const snippet =
    typeof record.snippet === "string" && record.snippet.trim()
      ? record.snippet.trim()
      : undefined;
  const reviewId =
    typeof record.reviewId === "string" &&
    record.reviewId.trim() &&
    (!validReviewIds || validReviewIds.has(record.reviewId.trim()))
      ? record.reviewId.trim()
      : defaultReviewId;

  if (
    typeof record.id !== "string" ||
    typeof record.filePath !== "string" ||
    typeof record.body !== "string" ||
    typeof record.author !== "string" ||
    typeof record.when !== "string" ||
    !isCommentCategory(record.category) ||
    !isCommentSeverity(record.severity)
  ) {
    return null;
  }

  return {
    id: record.id,
    reviewId,
    filePath: record.filePath,
    line,
    endLine,
    startColumn,
    endColumn,
    category: record.category,
    severity: record.severity,
    body: record.body,
    snippet,
    author: record.author,
    when: record.when,
  };
}

function normalizeReviewHistory(value: unknown): ReviewHistory {
  const fallback = createReviewHistory([], new Date().toISOString());

  if (Array.isArray(value)) {
    return {
      ...fallback,
      comments: value
        .map((entry) => normalizeComment(entry, fallback.activeReviewId))
        .filter((entry): entry is ReviewComment => Boolean(entry)),
    };
  }

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const seenReviewIds = new Set<string>();
  const reviews = (Array.isArray(record.reviews) ? record.reviews : [])
    .map((entry) => normalizeReviewVersion(entry))
    .filter((entry): entry is ReviewVersion => Boolean(entry))
    .filter((entry) => {
      if (seenReviewIds.has(entry.id)) {
        return false;
      }

      seenReviewIds.add(entry.id);
      return true;
    })
    .sort(
      (left, right) =>
        left.version - right.version ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  const normalizedReviews = reviews.length ? reviews : fallback.reviews;
  const validReviewIds = new Set(normalizedReviews.map((review) => review.id));
  const requestedActiveReviewId =
    typeof record.activeReviewId === "string" ? record.activeReviewId : "";
  const activeReviewId = validReviewIds.has(requestedActiveReviewId)
    ? requestedActiveReviewId
    : (normalizedReviews.at(-1)?.id ?? fallback.activeReviewId);
  const comments = (Array.isArray(record.comments) ? record.comments : [])
    .map((entry) => normalizeComment(entry, activeReviewId, validReviewIds))
    .filter((entry): entry is ReviewComment => Boolean(entry));

  return {
    activeReviewId,
    reviews: normalizedReviews,
    comments,
  };
}

export async function readReviewHistory(
  repoRoot: string,
): Promise<ReviewHistory> {
  const paths = await ensureStorage(repoRoot);
  logAll("storage", "read review history", { path: paths.comments });

  try {
    const raw = await readFile(paths.comments, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeReviewHistory(parsed);
  } catch {
    logAll("storage", "review history missing or invalid, using empty", {
      path: paths.comments,
    });
    return createReviewHistory([], new Date().toISOString());
  }
}

export async function writeReviewHistory(
  repoRoot: string,
  history: unknown,
): Promise<ReviewHistory> {
  const paths = await ensureStorage(repoRoot);
  const normalized = normalizeReviewHistory(history);
  logAll("storage", "write review history", {
    path: paths.comments,
    count: normalized.comments.length,
    reviews: normalized.reviews.length,
  });
  await writeFile(
    paths.comments,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return normalized;
}
