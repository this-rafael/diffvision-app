import type {
  ReviewComment,
  ReviewExportSelection,
  ReviewHistory,
  ReviewVersion,
} from "./types";

export interface CreateReviewCommentInput {
  reviewId?: string;
  id?: string;
  filePath: string;
  line: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  category: ReviewComment["category"];
  severity: ReviewComment["severity"];
  body: string;
  snippet?: string;
  author?: string;
  when?: string;
}

export function formatReviewLabel(review: Pick<ReviewVersion, "version">) {
  return `v${review.version}`;
}

export function createReviewVersion(
  version: number,
  createdAt = new Date().toISOString(),
): ReviewVersion {
  return {
    id: `review-${version}`,
    version,
    createdAt,
  };
}

export function createReviewHistory(
  comments: ReviewComment[] = [],
  createdAt = new Date().toISOString(),
): ReviewHistory {
  const initialReview = createReviewVersion(1, createdAt);

  return {
    activeReviewId: initialReview.id,
    reviews: [initialReview],
    comments: comments.map((comment) => ({
      ...comment,
      reviewId: comment.reviewId || initialReview.id,
    })),
  };
}

export function nextReviewVersionNumber(reviews: ReviewVersion[]) {
  return (
    reviews.reduce(
      (highestVersion, review) => Math.max(highestVersion, review.version),
      0,
    ) + 1
  );
}

export function createNextReview(
  history: ReviewHistory,
  createdAt = new Date().toISOString(),
): ReviewHistory {
  const nextReview = createReviewVersion(
    nextReviewVersionNumber(history.reviews),
    createdAt,
  );

  return {
    ...history,
    activeReviewId: nextReview.id,
    reviews: [...history.reviews, nextReview],
  };
}

function normalizePositiveInteger(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeOptionalColumn(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return undefined;
  }

  return Math.floor(value);
}

function createReviewCommentId() {
  return `c${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createReviewComment(
  input: CreateReviewCommentInput,
  defaultReviewId: string,
): ReviewComment {
  const line = Math.max(1, Math.floor(input.line));
  const normalizedEndLine = normalizePositiveInteger(input.endLine);
  const snippet = input.snippet?.trim();
  const body = input.body.trim();

  return {
    id: input.id?.trim() || createReviewCommentId(),
    reviewId: input.reviewId?.trim() || defaultReviewId,
    filePath: input.filePath,
    line,
    endLine:
      normalizedEndLine !== undefined
        ? Math.max(line, normalizedEndLine)
        : undefined,
    startColumn: normalizeOptionalColumn(input.startColumn),
    endColumn: normalizeOptionalColumn(input.endColumn),
    category: input.category,
    severity: input.severity,
    body,
    snippet: snippet || undefined,
    author: input.author?.trim() || "you",
    when: input.when?.trim() || "just now",
  };
}

export function appendReviewComment(
  history: ReviewHistory,
  input: CreateReviewCommentInput,
): ReviewHistory {
  return {
    ...history,
    comments: [
      ...history.comments,
      createReviewComment(input, history.activeReviewId),
    ],
  };
}

function orderedReviews(reviews: ReviewVersion[]) {
  return [...reviews].sort(
    (left, right) =>
      left.version - right.version ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export function resolveIncludedReviews(
  reviews: ReviewVersion[],
  activeReviewId?: string,
  selection?: ReviewExportSelection,
): ReviewVersion[] {
  const ordered = orderedReviews(reviews);
  const byId = new Map(ordered.map((review) => [review.id, review]));

  if (!ordered.length) {
    return [];
  }

  if (selection?.scope === "complete") {
    return ordered;
  }

  if (selection?.scope === "selected") {
    const selectedIds = new Set(selection.reviewIds ?? []);
    return ordered.filter((review) => selectedIds.has(review.id));
  }

  const currentReview =
    (activeReviewId ? byId.get(activeReviewId) : undefined) ?? ordered.at(-1);
  return currentReview ? [currentReview] : [];
}

export function resolveIncludedComments(
  comments: ReviewComment[],
  reviews: ReviewVersion[],
  activeReviewId?: string,
  selection?: ReviewExportSelection,
): ReviewComment[] {
  const includedReviews = resolveIncludedReviews(
    reviews,
    activeReviewId,
    selection,
  );
  if (!includedReviews.length) {
    return selection?.scope === "selected" ? [] : comments;
  }

  const includedIds = new Set(includedReviews.map((review) => review.id));
  return comments.filter((comment) => includedIds.has(comment.reviewId));
}
