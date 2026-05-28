#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import boxen from "boxen";
import chalk from "chalk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { isCliEntrypoint } from "./entrypoint";
import { configureLogs, logAll, logAllError } from "../lib/logger";
import { discoverRepository, loadRepositorySnapshot } from "../lib/repository";
import {
  defaultConfig,
  readConfig,
  readReviewHistory,
  writeReviewHistory,
} from "../lib/storage";
import { appendReviewComment, formatReviewLabel } from "../shared/reviews";
import type {
  DiffFile,
  DiffVisionConfig,
  RepositorySnapshot,
  ReviewComment,
  ReviewHistory,
} from "../shared/types";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

export const MCP_CLI_VERSION = packageJson.version;

const commentCategoryIds = [
  "bug",
  "refactor",
  "performance",
  "security",
  "readability",
  "suggestion",
] as const;
const commentSeverityIds = ["info", "minor", "major", "critical"] as const;

export interface McpCliOptions {
  cwd?: string;
  compare?: string;
  newIn?: string;
  relativeTo?: string;
  base?: string;
  target?: string;
  logs?: string;
  author?: string;
  help?: boolean;
  version?: boolean;
}

interface RuntimeOptions {
  compareRef: string;
  compareTargetRef?: string;
  author: string;
}

export interface McpDiffSelection {
  newIn?: string;
  relativeTo?: string;
}

function printHelp() {
  console.log(`
DiffVision MCP

Usage:
  diffvision-mcp [relative-to-ref] [options]

Options:
  --compare <ref>     Base ref (legacy alias for --base)
  --new-in <ref>      Show what is new in this ref
  --relative-to <ref> Compare the new-in ref relative to this ref
  --base <ref>        Legacy alias for --new-in
  --target <ref>      Legacy alias for --relative-to
  --cwd <path>        Inspect a repository different from the current directory
  --author <name>     Author label used for MCP-created comments
  --logs <mode>       Enable terminal logs (all for full internal logs on stderr)
  --help              Show this help
  --version           Print the installed DiffVision version

Tools:
  get_repo_overview     Summarize the active diff and review state
  read_diff             Return the raw patch for a changed file
  list_review_comments  List comments already stored in DiffVision
  create_review_comment Write a new inline review comment into the active draft

Shortcut:
  diffvision-mcp main   Review what is new in the current branch relative to main

Per-call overrides:
  MCP tools can also receive newIn/relativeTo so the client can choose
  the diff context for each tool call without hardcoding it in mcp.json.
`);
}

export function parseMcpCliOptions(argv: string[]): McpCliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      compare: { type: "string" },
      "new-in": { type: "string" },
      "relative-to": { type: "string" },
      base: { type: "string" },
      target: { type: "string" },
      cwd: { type: "string" },
      logs: { type: "string" },
      author: { type: "string" },
      help: { type: "boolean" },
      version: { type: "boolean" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    return { help: true };
  }

  if (values.version) {
    return { version: true };
  }

  if (values.logs && values.logs !== "all") {
    throw new Error("Invalid value for --logs. Supported value: all");
  }

  if (positionals.length > 1) {
    throw new Error(
      "Too many positional arguments. Use `diffvision-mcp <ref>` or the explicit flags.",
    );
  }

  const positionalRelativeTo = positionals[0]?.trim() || undefined;

  if (positionalRelativeTo && (values["relative-to"] || values.target)) {
    throw new Error(
      "Use either a positional ref or --relative-to/--target, not both.",
    );
  }

  return {
    compare: values.compare,
    newIn: values["new-in"],
    relativeTo: values["relative-to"] ?? positionalRelativeTo,
    base: values.base,
    target: values.target,
    cwd: values.cwd,
    logs: values.logs,
    author: values.author,
    help: values.help,
    version: values.version,
  };
}

function normalizeRepoPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function normalizeRefValue(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasOwn(
  value: McpDiffSelection | undefined,
  key: keyof McpDiffSelection,
) {
  return value ? Object.prototype.hasOwnProperty.call(value, key) : false;
}

function firstNonEmptyRef(...values: Array<string | undefined>) {
  for (const value of values) {
    const normalized = normalizeRefValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

export function resolveMcpComparisonSettings(
  config: Pick<DiffVisionConfig, "compareRef" | "compareTargetRef">,
  options: Pick<
    McpCliOptions,
    "compare" | "newIn" | "base" | "relativeTo" | "target"
  >,
  requested?: McpDiffSelection,
) {
  const compareRef = hasOwn(requested, "newIn")
    ? (normalizeRefValue(requested?.newIn) ?? defaultConfig.compareRef)
    : (firstNonEmptyRef(
        options.newIn,
        options.base,
        options.compare,
        config.compareRef,
      ) ?? defaultConfig.compareRef);
  const compareTargetRef = hasOwn(requested, "relativeTo")
    ? normalizeRefValue(requested?.relativeTo)
    : firstNonEmptyRef(
        options.relativeTo,
        options.target,
        config.compareTargetRef,
      );

  return {
    compareRef,
    compareTargetRef,
  };
}

function serializeJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function getRequestedDiffSelection(input: Record<string, unknown>) {
  return {
    ...(Object.prototype.hasOwnProperty.call(input, "newIn")
      ? {
          newIn: typeof input.newIn === "string" ? input.newIn : undefined,
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "relativeTo")
      ? {
          relativeTo:
            typeof input.relativeTo === "string" ? input.relativeTo : undefined,
        }
      : {}),
  } satisfies McpDiffSelection;
}

function createComparisonInputSchema() {
  return {
    newIn: z
      .string()
      .optional()
      .describe(
        "Optional ref to review for this call. If omitted, the server uses the startup or saved DiffVision setting.",
      ),
    relativeTo: z
      .string()
      .optional()
      .describe(
        "Optional base ref for this call. Use an empty string to clear a default relative-to ref.",
      ),
  };
}

function reviewLabels(history: ReviewHistory) {
  return new Map(
    history.reviews.map((review) => [review.id, formatReviewLabel(review)]),
  );
}

function resolveDiffAnchorLines(file: DiffFile) {
  const anchors = new Set<number>();

  for (const line of file.hunks) {
    const target = line.newNumber ?? line.oldNumber;
    if (target) {
      anchors.add(target);
    }
  }

  return [...anchors].sort((left, right) => left - right);
}

function formatRange(start: number, end: number) {
  return start === end ? `${start}` : `${start}-${end}`;
}

function summarizeLineAnchors(lines: number[], limit = 24) {
  if (!lines.length) {
    return "none";
  }

  const ranges: string[] = [];
  let start = lines[0];
  let previous = lines[0];

  for (let index = 1; index < lines.length; index += 1) {
    const current = lines[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push(formatRange(start, previous));
    start = current;
    previous = current;
  }

  ranges.push(formatRange(start, previous));
  const visible = ranges.slice(0, limit);
  return `${visible.join(", ")}${ranges.length > visible.length ? ", ..." : ""}`;
}

function resolveSnapshotFile(
  snapshot: RepositorySnapshot,
  requestedPath: string,
) {
  const normalized = normalizeRepoPath(requestedPath);
  const exact = snapshot.files.find((file) => file.path === normalized);
  if (exact) {
    return exact;
  }

  const caseInsensitive = snapshot.files.find(
    (file) => file.path.toLowerCase() === normalized.toLowerCase(),
  );
  if (caseInsensitive) {
    return caseInsensitive;
  }

  const visibleFiles = snapshot.files.slice(0, 20).map((file) => file.path);
  throw new Error(
    `File ${normalized} is not part of the current diff. Available changed files: ${visibleFiles.join(", ")}${snapshot.files.length > visibleFiles.length ? ", ..." : ""}`,
  );
}

function resolveCommentSnippet(file: DiffFile, line: number, endLine?: number) {
  const lastLine = endLine ?? line;
  const snippet = file.hunks
    .filter((entry) => entry.type !== "hunk")
    .filter((entry) => {
      const targetLine = entry.newNumber ?? entry.oldNumber;
      return (
        typeof targetLine === "number" &&
        targetLine >= line &&
        targetLine <= lastLine
      );
    })
    .map((entry) => entry.text)
    .join("\n")
    .trim();

  return snippet || undefined;
}

function assertCommentAnchor(file: DiffFile, line: number, endLine?: number) {
  if (file.isBinary) {
    throw new Error(
      `Cannot attach a line comment to binary file ${file.path}. Use a textual file from the current diff instead.`,
    );
  }

  const anchors = resolveDiffAnchorLines(file);
  if (!anchors.length) {
    throw new Error(
      `File ${file.path} does not expose line anchors in the current diff.`,
    );
  }

  const available = new Set(anchors);
  const missing: number[] = [];

  if (!available.has(line)) {
    missing.push(line);
  }

  if (typeof endLine === "number" && !available.has(endLine)) {
    missing.push(endLine);
  }

  if (missing.length) {
    throw new Error(
      `Line ${missing.join(", ")} is not present in the current diff for ${file.path}. Available anchors: ${summarizeLineAnchors(anchors)}.`,
    );
  }
}

function sortComments(history: ReviewHistory, comments: ReviewComment[]) {
  const reviewOrder = new Map(
    history.reviews.map((review, index) => [review.id, index]),
  );

  return [...comments].sort(
    (left, right) =>
      (reviewOrder.get(left.reviewId) ?? Number.MAX_SAFE_INTEGER) -
        (reviewOrder.get(right.reviewId) ?? Number.MAX_SAFE_INTEGER) ||
      left.filePath.localeCompare(right.filePath) ||
      left.line - right.line ||
      left.id.localeCompare(right.id),
  );
}

function formatDiffResponse(
  snapshot: RepositorySnapshot,
  file: DiffFile,
  comments: ReviewComment[],
  labels: Map<string, string>,
) {
  const anchors = resolveDiffAnchorLines(file);
  const lines = [
    `New in: ${snapshot.compareNewInRef}`,
    `Relative to: ${snapshot.compareRelativeToRef ?? "(none)"}`,
    `Resolved diff: ${snapshot.compareRef}`,
    "",
    `Path: ${file.path}`,
    `Status: ${file.status}`,
    `Additions: ${file.additions}`,
    `Deletions: ${file.deletions}`,
    `Binary: ${file.isBinary ? "yes" : "no"}`,
    `Available anchors: ${summarizeLineAnchors(anchors)}`,
    "",
  ];

  if (comments.length) {
    lines.push("Existing comments:", "");
    for (const comment of comments) {
      lines.push(
        `- ${labels.get(comment.reviewId) ?? comment.reviewId} · line ${comment.line}${comment.endLine ? `-${comment.endLine}` : ""} · ${comment.category} · ${comment.severity} · ${comment.author}`,
      );
      lines.push(`  ${comment.body}`, "");
    }
  } else {
    lines.push("Existing comments: none", "");
  }

  if (file.isBinary) {
    lines.push("Binary file. No textual patch is available.");
  } else if (file.rawPatch) {
    lines.push("```diff", file.rawPatch, "```");
  } else {
    lines.push("No textual patch is available for this file.");
  }

  return lines.join("\n");
}

async function getRuntimeOptions(
  repoRoot: string,
  options: McpCliOptions,
  requested?: McpDiffSelection,
): Promise<RuntimeOptions> {
  const config = {
    ...defaultConfig,
    ...(await readConfig(repoRoot)),
  };
  const comparison = resolveMcpComparisonSettings(config, options, requested);

  return {
    compareRef: comparison.compareRef,
    compareTargetRef: comparison.compareTargetRef,
    author: options.author?.trim() || "diffvision-mcp",
  };
}

async function loadRuntimeSnapshot(
  repoRoot: string,
  options: McpCliOptions,
  requested?: McpDiffSelection,
) {
  const runtime = await getRuntimeOptions(repoRoot, options, requested);
  const snapshot = await loadRepositorySnapshot(repoRoot, {
    compareRef: runtime.compareRef,
    compareTargetRef: runtime.compareTargetRef,
  });

  return { snapshot, runtime };
}

export async function createDiffVisionMcpServer(
  repoRoot: string,
  options: McpCliOptions,
) {
  const server = new McpServer({
    name: "diffvision-mcp",
    version: MCP_CLI_VERSION,
  });

  server.registerTool(
    "get_repo_overview",
    {
      description:
        "Summarize the current DiffVision snapshot, changed files, and review state.",
      inputSchema: {
        ...createComparisonInputSchema(),
        includeFiles: z
          .boolean()
          .default(true)
          .describe("Include the changed file list in the response."),
        fileLimit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Maximum number of changed files to include."),
      },
    },
    async (input) => {
      const includeFiles = input.includeFiles ?? true;
      const fileLimit = input.fileLimit ?? 50;
      const requestedDiff = getRequestedDiffSelection(input);
      const [{ snapshot }, history] = await Promise.all([
        loadRuntimeSnapshot(repoRoot, options, requestedDiff),
        readReviewHistory(repoRoot),
      ]);
      const labels = reviewLabels(history);
      const activeReview = history.reviews.find(
        (review) => review.id === history.activeReviewId,
      );
      const payload = {
        repo: {
          repoRoot: snapshot.repoRoot,
          repoName: snapshot.repoName,
          branch: snapshot.branch,
          compareRef: snapshot.compareRef,
          compareBaseRef: snapshot.compareBaseRef,
          compareTargetRef: snapshot.compareTargetRef,
          head: snapshot.head,
          changedFiles: snapshot.changedFiles,
          totalAdditions: snapshot.totalAdditions,
          totalDeletions: snapshot.totalDeletions,
          lastUpdated: snapshot.lastUpdated,
        },
        review: {
          activeReviewId: history.activeReviewId,
          activeReviewLabel: activeReview
            ? formatReviewLabel(activeReview)
            : history.activeReviewId,
          reviewCount: history.reviews.length,
          commentCount: history.comments.length,
          reviews: history.reviews.map((review) => ({
            id: review.id,
            label: labels.get(review.id) ?? review.id,
            createdAt: review.createdAt,
            exportedAt: review.exportedAt,
          })),
        },
        commentSchema: {
          categories: [...commentCategoryIds],
          severities: [...commentSeverityIds],
        },
        files: includeFiles
          ? snapshot.files.slice(0, fileLimit).map((file) => ({
              path: file.path,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              isBinary: file.isBinary,
            }))
          : undefined,
      };

      return {
        content: [{ type: "text", text: serializeJson(payload) }],
      };
    },
  );

  server.registerTool(
    "read_diff",
    {
      description:
        "Return the raw patch and existing DiffVision comments for a changed file.",
      inputSchema: {
        ...createComparisonInputSchema(),
        filePath: z
          .string()
          .min(1)
          .describe("Changed file path exactly as reported by DiffVision."),
        includeComments: z
          .boolean()
          .default(true)
          .describe("Include existing stored comments for this file."),
      },
    },
    async (input) => {
      const requestedDiff = getRequestedDiffSelection(input);
      const includeComments = input.includeComments ?? true;
      const [{ snapshot }, history] = await Promise.all([
        loadRuntimeSnapshot(repoRoot, options, requestedDiff),
        readReviewHistory(repoRoot),
      ]);
      const file = resolveSnapshotFile(snapshot, input.filePath);
      const labels = reviewLabels(history);
      const fileComments = includeComments
        ? sortComments(
            history,
            history.comments.filter(
              (comment) => comment.filePath === file.path,
            ),
          )
        : [];

      return {
        content: [
          {
            type: "text",
            text: formatDiffResponse(snapshot, file, fileComments, labels),
          },
        ],
      };
    },
  );

  server.registerTool(
    "list_review_comments",
    {
      description:
        "List review comments already stored in DiffVision, optionally filtered by file or review.",
      inputSchema: {
        filePath: z
          .string()
          .optional()
          .describe("Only include comments for this changed file path."),
        reviewId: z
          .string()
          .optional()
          .describe("Only include comments from this review id."),
      },
    },
    async ({ filePath, reviewId }) => {
      const history = await readReviewHistory(repoRoot);
      const normalizedPath = filePath ? normalizeRepoPath(filePath) : undefined;
      const labels = reviewLabels(history);
      const comments = sortComments(
        history,
        history.comments.filter((comment) => {
          if (
            normalizedPath &&
            comment.filePath.toLowerCase() !== normalizedPath.toLowerCase()
          ) {
            return false;
          }

          if (reviewId && comment.reviewId !== reviewId) {
            return false;
          }

          return true;
        }),
      ).map((comment) => ({
        ...comment,
        reviewLabel: labels.get(comment.reviewId) ?? comment.reviewId,
      }));

      return {
        content: [
          {
            type: "text",
            text: serializeJson({
              filters: {
                filePath: normalizedPath,
                reviewId,
              },
              count: comments.length,
              comments,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "create_review_comment",
    {
      description:
        "Write a new inline review comment into the active DiffVision review draft.",
      inputSchema: {
        ...createComparisonInputSchema(),
        filePath: z
          .string()
          .min(1)
          .describe("Changed file path exactly as reported by DiffVision."),
        line: z.number().int().min(1).describe("Line anchor inside the diff."),
        endLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Optional inclusive end line for a multi-line comment."),
        startColumn: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Optional start column within the selected line range."),
        endColumn: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Optional end column within the selected line range."),
        category: z
          .enum(commentCategoryIds)
          .default("suggestion")
          .describe("Review category for the comment."),
        severity: z
          .enum(commentSeverityIds)
          .default("minor")
          .describe("Review severity for the comment."),
        body: z.string().min(1).describe("The review comment body to persist."),
        snippet: z
          .string()
          .optional()
          .describe("Optional code snippet to store with the comment."),
      },
    },
    async (input) => {
      const requestedDiff = getRequestedDiffSelection(input);
      const [{ snapshot, runtime }, history] = await Promise.all([
        loadRuntimeSnapshot(repoRoot, options, requestedDiff),
        readReviewHistory(repoRoot),
      ]);
      const file = resolveSnapshotFile(snapshot, input.filePath);
      assertCommentAnchor(file, input.line, input.endLine);

      const nextHistory = appendReviewComment(history, {
        filePath: file.path,
        line: input.line,
        endLine: input.endLine,
        startColumn: input.startColumn,
        endColumn: input.endColumn,
        category: input.category ?? "suggestion",
        severity: input.severity ?? "minor",
        body: input.body,
        snippet:
          input.snippet?.trim() ||
          resolveCommentSnippet(file, input.line, input.endLine),
        author: runtime.author,
        when: new Date().toISOString(),
      });
      const written = await writeReviewHistory(repoRoot, nextHistory);
      const createdComment = written.comments.at(-1);
      const labels = reviewLabels(written);

      return {
        content: [
          {
            type: "text",
            text: serializeJson({
              message: "Review comment created.",
              compareRef: snapshot.compareRef,
              compareBaseRef: snapshot.compareBaseRef,
              compareTargetRef: snapshot.compareTargetRef,
              activeReviewId: written.activeReviewId,
              activeReviewLabel:
                labels.get(written.activeReviewId) ?? written.activeReviewId,
              totalComments: written.comments.length,
              comment: createdComment
                ? {
                    ...createdComment,
                    reviewLabel:
                      labels.get(createdComment.reviewId) ??
                      createdComment.reviewId,
                  }
                : null,
            }),
          },
        ],
      };
    },
  );

  return server;
}

async function main() {
  const options = parseMcpCliOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.version) {
    console.log(MCP_CLI_VERSION);
    return;
  }

  configureLogs(options.logs, "stderr");
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const repoRoot = await discoverRepository(cwd);
  logAll("mcp", "parsed CLI options", { options, cwd, repoRoot });

  if (!repoRoot) {
    console.error(
      boxen(
        `${chalk.red("DiffVision MCP could not find a Git repository.")}\n\nRun ${chalk.cyan("diffvision-mcp")} inside any tracked project or pass ${chalk.cyan("--cwd <path>")}.`,
        {
          padding: 1,
          borderColor: "red",
          title: "DiffVision MCP",
        },
      ),
    );
    process.exit(1);
  }

  const runtime = await getRuntimeOptions(repoRoot, options);
  logAll("mcp", "starting stdio server", {
    repoRoot,
    compareRef: runtime.compareRef,
    compareTargetRef: runtime.compareTargetRef,
    author: runtime.author,
  });

  const server = await createDiffVisionMcpServer(repoRoot, options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun = isCliEntrypoint(import.meta.url, process.argv[1], [
  "diffvision-mcp",
]);

if (isDirectRun) {
  main().catch((error) => {
    logAllError("mcp", "startup failed", error);
    console.error(
      boxen(
        chalk.red(
          error instanceof Error
            ? error.message
            : "Unexpected DiffVision MCP failure",
        ),
        {
          padding: 1,
          borderColor: "red",
          title: "DiffVision MCP",
        },
      ),
    );
    process.exit(1);
  });
}
