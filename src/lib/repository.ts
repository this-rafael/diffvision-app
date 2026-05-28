import path from "node:path";
import crypto from "node:crypto";
import {
  buildSyntheticDiff,
  parseDiffNameStatus,
  parseStatusPorcelain,
  parseUnifiedDiff,
} from "./diff";
import { logAll } from "./logger";
import { runGit } from "./process";
import { readConfig } from "./storage";
import {
  formatReviewLabel,
  resolveIncludedComments,
  resolveIncludedReviews,
} from "../shared/reviews";
import {
  reviewCommentCategories,
  type DiffVisionConfig,
  type RepositorySnapshot,
  type ReviewJsonExportPayload,
  type ReviewComment,
  type ReviewExportSelection,
  type ReviewVersion,
} from "../shared/types";

interface ReviewExportMetadata {
  reviews?: ReviewVersion[];
  activeReviewId?: string;
  selection?: ReviewExportSelection;
}

function normalizeCompareRef(compareRef?: string) {
  return compareRef?.trim() || "HEAD";
}

function normalizeCompareTargetRef(compareTargetRef?: string) {
  const normalized = compareTargetRef?.trim();
  return normalized ? normalized : undefined;
}

export async function discoverRepository(
  startDirectory: string,
): Promise<string | null> {
  logAll("repository", "discover start", { startDirectory });
  try {
    const repoRoot = await runGit(
      ["rev-parse", "--show-toplevel"],
      startDirectory,
      true,
    );
    const resolved = repoRoot ? path.resolve(repoRoot.trim()) : null;
    logAll("repository", "discover success", { repoRoot: resolved });
    return resolved;
  } catch {
    logAll("repository", "discover failed", { startDirectory });
    return null;
  }
}

function parseBranchHeader(header: string) {
  const detached =
    header.includes("no branch") || header.includes("HEAD (no branch)");
  const branchMatch = /##\s+([^.\s]+)(?:\.\.\.[^\s]+)?(?:\s+\[(.+)\])?/.exec(
    header,
  );
  const branch = detached ? "detached" : (branchMatch?.[1] ?? "unknown");
  const details = branchMatch?.[2] ?? "";

  const ahead = /ahead (\d+)/.exec(details);
  const behind = /behind (\d+)/.exec(details);

  return {
    branch,
    detached,
    ahead: ahead ? Number.parseInt(ahead[1], 10) : 0,
    behind: behind ? Number.parseInt(behind[1], 10) : 0,
  };
}

function stableHash(snapshot: RepositorySnapshot) {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        branch: snapshot.branch,
        compareRef: snapshot.compareRef,
        head: snapshot.head,
        changedFiles: snapshot.changedFiles,
        totalAdditions: snapshot.totalAdditions,
        totalDeletions: snapshot.totalDeletions,
        files: snapshot.files.map((file) => [
          file.path,
          file.status,
          file.additions,
          file.deletions,
          file.rawPatch,
        ]),
      }),
    )
    .digest("hex");
}

export async function assertValidCompareRef(
  repoRoot: string,
  compareRef: string,
) {
  const normalized = normalizeCompareRef(compareRef);
  logAll("repository", "validate compare ref", {
    repoRoot,
    compareRef: normalized,
  });
  await runGit(["rev-parse", "--verify", `${normalized}^{commit}`], repoRoot);
  return normalized;
}

export async function loadRepositorySnapshot(
  repoRoot: string,
  configOverride?: Partial<DiffVisionConfig>,
): Promise<RepositorySnapshot & { hash: string }> {
  const startedAt = Date.now();
  logAll("repository", "snapshot start", {
    repoRoot,
    configOverride,
  });
  const storedConfig = await readConfig(repoRoot);
  const config = {
    ...storedConfig,
    ...configOverride,
    compareRef: normalizeCompareRef(
      configOverride?.compareRef ?? storedConfig.compareRef,
    ),
    compareTargetRef: normalizeCompareTargetRef(
      configOverride?.compareTargetRef ?? storedConfig.compareTargetRef,
    ),
  };
  const comparisonRef = config.compareTargetRef
    ? `${config.compareTargetRef}..${config.compareRef}`
    : config.compareRef;
  const isRefToRefComparison = Boolean(config.compareTargetRef);
  const statusText = await runGit(
    ["status", "--porcelain=v1", "--branch", "--untracked-files=all"],
    repoRoot,
  );
  const branchHeader = statusText.split(/\r?\n/)[0] ?? "## unknown";
  const branch = parseBranchHeader(branchHeader);
  const statusEntries = parseStatusPorcelain(statusText);
  const diffText = await runGit(
    ["diff", "--no-color", "--find-renames", "--unified=3", comparisonRef],
    repoRoot,
    true,
  );
  const trackedFiles = parseUnifiedDiff(
    diffText,
    parseDiffNameStatus(
      await runGit(
        ["diff", "--name-status", "--find-renames", comparisonRef],
        repoRoot,
        true,
      ),
    ),
  );
  const syntheticFiles = isRefToRefComparison
    ? []
    : await Promise.all(
        statusEntries
          .filter((entry) => entry.status === "untracked")
          .map((entry) => buildSyntheticDiff(repoRoot, entry)),
      );
  const mergedFiles = [...trackedFiles, ...syntheticFiles].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const files = isRefToRefComparison
    ? mergedFiles
    : mergedFiles.map((file) => {
        const entry = statusEntries.find(
          (candidate) => candidate.path === file.path,
        );
        if (!entry) {
          return file;
        }

        return {
          ...file,
          status:
            entry.status === "untracked" && file.status !== "binary"
              ? "untracked"
              : file.status,
          stagedStatus: entry.indexStatus,
          unstagedStatus: entry.workTreeStatus,
          oldPath: entry.oldPath ?? file.oldPath,
        };
      });

  const head = await runGit(["rev-parse", "--short", "HEAD"], repoRoot, true);
  const snapshot: RepositorySnapshot = {
    repoRoot,
    repoName: path.basename(repoRoot),
    branch: branch.branch,
    compareRef: comparisonRef,
    compareBaseRef: config.compareRef,
    compareTargetRef: config.compareTargetRef,
    compareNewInRef: config.compareRef,
    compareRelativeToRef: config.compareTargetRef,
    head: head || "unborn",
    isDetached: branch.detached,
    ahead: branch.ahead,
    behind: branch.behind,
    changedFiles: files.length,
    stagedFiles: isRefToRefComparison
      ? 0
      : statusEntries.filter(
          (entry) => entry.indexStatus !== " " && entry.indexStatus !== "?",
        ).length,
    unstagedFiles: isRefToRefComparison
      ? 0
      : statusEntries.filter(
          (entry) =>
            entry.workTreeStatus !== " " && entry.workTreeStatus !== "?",
        ).length,
    untrackedFiles: isRefToRefComparison
      ? 0
      : statusEntries.filter((entry) => entry.status === "untracked").length,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
    lastUpdated: new Date().toISOString(),
    config,
    files,
  };

  logAll("repository", "snapshot ready", {
    repoRoot,
    branch: snapshot.branch,
    changedFiles: snapshot.changedFiles,
    elapsedMs: Date.now() - startedAt,
  });

  return {
    ...snapshot,
    hash: stableHash(snapshot),
  };
}

function describeReviewScope(scope: ReviewExportSelection["scope"]) {
  if (scope === "current") {
    return "current review";
  }

  if (scope === "selected") {
    return "selected review history";
  }

  return "complete history";
}

function sortComments(
  comments: ReviewComment[],
  reviewOrder: Map<string, number>,
) {
  return [...comments].sort(
    (left, right) =>
      (reviewOrder.get(left.reviewId) ?? Number.MAX_SAFE_INTEGER) -
        (reviewOrder.get(right.reviewId) ?? Number.MAX_SAFE_INTEGER) ||
      left.filePath.localeCompare(right.filePath) ||
      left.line - right.line ||
      left.id.localeCompare(right.id),
  );
}

function groupCommentsByFile(comments: ReviewComment[]) {
  return comments.reduce<Record<string, ReviewComment[]>>(
    (current, comment) => {
      (current[comment.filePath] ??= []).push(comment);
      return current;
    },
    {},
  );
}

function resolveExportPayload(
  comments: ReviewComment[],
  metadata?: ReviewExportMetadata,
) {
  const reviews = metadata?.reviews ?? [];
  const selection = metadata?.selection;
  const includedReviews = resolveIncludedReviews(
    reviews,
    metadata?.activeReviewId,
    selection,
  );
  const includedComments = sortComments(
    resolveIncludedComments(
      comments,
      reviews,
      metadata?.activeReviewId,
      selection,
    ),
    new Map(includedReviews.map((review, index) => [review.id, index])),
  );

  return {
    includedReviews,
    includedComments,
    scope: selection?.scope ?? (reviews.length ? "current" : "complete"),
  };
}

export function createMarkdownReport(
  snapshot: RepositorySnapshot,
  notes?: string,
  comments: ReviewComment[] = [],
  title = `DiffVision review for ${snapshot.repoName}`,
  metadata?: ReviewExportMetadata,
) {
  const { includedReviews, includedComments, scope } = resolveExportPayload(
    comments,
    metadata,
  );
  const lines = [
    `# ${title}`,
    "",
    `- Repository: ${snapshot.repoRoot}`,
    `- Branch: ${snapshot.branch}`,
    `- Compare against: ${snapshot.compareRef}`,
    `- HEAD: ${snapshot.head}`,
    `- Changed files: ${snapshot.changedFiles}`,
    `- Additions: ${snapshot.totalAdditions}`,
    `- Deletions: ${snapshot.totalDeletions}`,
    `- Generated: ${snapshot.lastUpdated}`,
    ...(includedReviews.length
      ? [
          `- Review scope: ${describeReviewScope(scope)}`,
          `- Reviews included: ${includedReviews.map((review) => formatReviewLabel(review)).join(", ")}`,
        ]
      : []),
    "",
  ];

  if (notes?.trim()) {
    lines.push("## Notes", "", notes.trim(), "");
  }

  if (includedComments.length) {
    lines.push("## Review Comments", "");

    if (includedReviews.length) {
      for (const review of includedReviews) {
        const reviewComments = includedComments.filter(
          (comment) => comment.reviewId === review.id,
        );

        lines.push(`### ${formatReviewLabel(review)}`, "");
        lines.push(`- Created: ${review.createdAt}`);
        lines.push(
          `- Status: ${
            review.exportedAt
              ? `exported ${review.exportedAt}`
              : review.id === metadata?.activeReviewId
                ? "current draft"
                : "draft"
          }`,
        );
        if (review.lastExportTitle) {
          lines.push(`- Last title: ${review.lastExportTitle}`);
        }
        if (review.lastExportNotes) {
          lines.push(`- Last notes: ${review.lastExportNotes}`);
        }
        lines.push("");

        if (!reviewComments.length) {
          lines.push("- No comments captured in this review.", "");
          continue;
        }

        const grouped = groupCommentsByFile(reviewComments);
        for (const [filePath, fileComments] of Object.entries(grouped)) {
          lines.push(`#### ${filePath}`, "");

          for (const comment of fileComments) {
            const category =
              reviewCommentCategories.find(
                (item) => item.id === comment.category,
              )?.label ?? comment.category;
            lines.push(
              `- Line ${comment.line}${comment.endLine ? `-${comment.endLine}` : ""} · ${category} · _${comment.severity}_ · ${comment.author}`,
            );
            lines.push(`  ${comment.body}`, "");
          }
        }
      }
    } else {
      const grouped = groupCommentsByFile(includedComments);
      for (const [filePath, fileComments] of Object.entries(grouped)) {
        lines.push(`### ${filePath}`, "");

        for (const comment of fileComments) {
          const category =
            reviewCommentCategories.find((item) => item.id === comment.category)
              ?.label ?? comment.category;
          lines.push(
            `- Line ${comment.line}${comment.endLine ? `-${comment.endLine}` : ""} · ${category} · _${comment.severity}_ · ${comment.author}`,
          );
          lines.push(`  ${comment.body}`, "");
        }
      }
    }
  }

  lines.push("## Files", "");

  for (const file of snapshot.files) {
    lines.push(`### ${file.path}`, "");
    lines.push(`- Status: ${file.status}`);
    lines.push(`- Additions: ${file.additions}`);
    lines.push(`- Deletions: ${file.deletions}`, "");

    if (!file.isBinary && file.rawPatch) {
      lines.push("```diff", file.rawPatch, "```", "");
    }
  }

  return lines.join("\n");
}

function buildCorrectionPrompt(
  snapshot: RepositorySnapshot,
  notes?: string,
  reviewLabels: string[] = [],
) {
  const baseRef = snapshot.compareRelativeToRef ?? "working tree";
  const note = notes?.trim();

  return [
    "Apply the requested code corrections from this review.",
    `Repository: ${snapshot.repoName}.`,
    `Current branch: ${snapshot.branch}.`,
    `Reviewed ref: ${snapshot.compareNewInRef}.`,
    `Base ref: ${baseRef}.`,
    `Comparison: ${snapshot.compareRef}.`,
    reviewLabels.length ? `Included reviews: ${reviewLabels.join(", ")}.` : "",
    "Use each review item's file path, line range, column hints, and snippet as anchors.",
    "Change only what is necessary to satisfy the review comments and preserve unrelated behavior.",
    note ? `Reviewer notes: ${note}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function createReviewJsonPayload(
  snapshot: RepositorySnapshot,
  notes?: string,
  comments: ReviewComment[] = [],
  title = `DiffVision review for ${snapshot.repoName}`,
  metadata?: ReviewExportMetadata,
): ReviewJsonExportPayload {
  const cleanNotes = notes?.trim() || undefined;
  const { includedReviews, includedComments, scope } = resolveExportPayload(
    comments,
    metadata,
  );
  const reviewById = new Map(
    includedReviews.map((review) => [review.id, review]),
  );

  return {
    prompt: buildCorrectionPrompt(
      snapshot,
      cleanNotes,
      includedReviews.map((review) => formatReviewLabel(review)),
    ),
    context: {
      title,
      repoName: snapshot.repoName,
      repoRoot: snapshot.repoRoot,
      branch: snapshot.branch,
      reviewedRef: snapshot.compareNewInRef,
      baseRef: snapshot.compareRelativeToRef ?? "working tree",
      compareRef: snapshot.compareRef,
      head: snapshot.head,
      generatedAt: snapshot.lastUpdated,
      scope,
      includedReviews: includedReviews.map((review) => ({
        id: review.id,
        version: review.version,
        label: formatReviewLabel(review),
        createdAt: review.createdAt,
        ...(review.exportedAt ? { exportedAt: review.exportedAt } : {}),
      })),
      ...(cleanNotes ? { notes: cleanNotes } : {}),
    },
    data: includedComments.map((comment) => ({
      filePath: comment.filePath,
      ...(reviewById.has(comment.reviewId)
        ? {
            reviewId: comment.reviewId,
            reviewVersion: reviewById.get(comment.reviewId)?.version,
            reviewLabel: reviewById.get(comment.reviewId)
              ? formatReviewLabel(reviewById.get(comment.reviewId)!)
              : undefined,
          }
        : {}),
      lines: {
        start: comment.line,
        end: comment.endLine ?? comment.line,
      },
      ...((typeof comment.startColumn === "number" ||
        typeof comment.endColumn === "number") && {
        columns: {
          start: comment.startColumn ?? null,
          end: comment.endColumn ?? null,
        },
      }),
      comment: comment.body.trim(),
      ...(comment.snippet?.trim() ? { snippet: comment.snippet.trim() } : {}),
      category: comment.category,
      severity: comment.severity,
    })),
  };
}
