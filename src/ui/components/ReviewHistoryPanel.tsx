import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { formatReviewLabel } from "../../shared/reviews";
import type { ReviewVersion } from "../../shared/types";

interface ReviewHistoryPanelProps {
  reviews: ReviewVersion[];
  activeReviewId: string;
  selectedReviewId: "all" | string;
  reviewCommentCounts: Record<string, number>;
  compact?: boolean;
  onSelect: (reviewId: "all" | string) => void;
}

function formatReviewTimestamp(value?: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  return new Intl.DateTimeFormat(
    undefined,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  ).format(date);
}

function reviewStatus(review: ReviewVersion, activeReviewId: string) {
  if (review.id === activeReviewId && !review.exportedAt) {
    return "current draft";
  }

  if (review.exportedAt) {
    return "exported";
  }

  return "draft";
}

function reviewStatusTone(review: ReviewVersion, activeReviewId: string) {
  if (review.id === activeReviewId && !review.exportedAt) {
    return "current";
  }

  if (review.exportedAt) {
    return "exported";
  }

  return "draft";
}

function reviewMoment(review: ReviewVersion, activeReviewId: string) {
  const formattedExported = formatReviewTimestamp(review.exportedAt);
  const formattedCreated = formatReviewTimestamp(review.createdAt);

  if (review.id === activeReviewId && !review.exportedAt) {
    return formattedCreated
      ? `Started ${formattedCreated}`
      : "Started recently";
  }

  if (review.exportedAt) {
    return formattedExported
      ? `Exported ${formattedExported}`
      : "Exported recently";
  }

  return formattedCreated
    ? `Draft from ${formattedCreated}`
    : "Draft in progress";
}

export function ReviewHistoryPanel({
  reviews,
  activeReviewId,
  selectedReviewId,
  reviewCommentCounts,
  compact = false,
  onSelect,
}: ReviewHistoryPanelProps) {
  const [collapsed, setCollapsed] = useState(reviews.length <= 1);

  useEffect(() => {
    if (reviews.length <= 1) {
      setCollapsed(true);
    }
  }, [reviews.length]);

  const totalComments = Object.values(reviewCommentCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const selectedReview = reviews.find(
    (review) => review.id === selectedReviewId,
  );
  const selectedLabel =
    selectedReviewId === "all"
      ? "General"
      : selectedReview
        ? formatReviewLabel(selectedReview)
        : "Review";
  const selectedCommentCount =
    selectedReviewId === "all"
      ? totalComments
      : selectedReview
        ? (reviewCommentCounts[selectedReview.id] ?? 0)
        : 0;
  const selectedStatus =
    selectedReviewId === "all"
      ? `${reviews.length} ${reviews.length === 1 ? "review pass" : "review passes"}`
      : selectedReview
        ? reviewStatus(selectedReview, activeReviewId)
        : "review";
  const selectedMoment =
    selectedReviewId === "all" || !selectedReview
      ? null
      : reviewMoment(selectedReview, activeReviewId);
  const selectedDescription =
    selectedReviewId === "all"
      ? "Browse every exported pass and draft in one continuous stream."
      : selectedReview
        ? reviewStatusTone(selectedReview, activeReviewId) === "current"
          ? `${selectedMoment}. New comments land here until you export.`
          : selectedReview.exportedAt
            ? `${selectedMoment}. Frozen export snapshot kept for traceability and reuse.`
            : `${selectedMoment}. Unexported draft kept available for comparison.`
        : "Switch versions or inspect the full timeline.";

  return (
    <section
      className={[
        "review-history-panel",
        collapsed ? "review-history-panel-collapsed" : "",
        compact ? "review-history-panel-auto-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={compact}
    >
      <div className="review-history-header">
        <div className="review-history-copy">
          <span className="eyebrow">Review history</span>
          <h3>
            {selectedReviewId === "all" ? "General timeline" : selectedLabel}
          </h3>
          <p>{selectedDescription}</p>
        </div>

        <div className="review-history-controls">
          <div className="review-history-summary">
            <span className="review-history-summary-label">
              {selectedReviewId === "all" ? "Selected view" : "Selected pass"}
            </span>
            <strong>
              {selectedReviewId === "all" ? "All reviews" : selectedLabel}
            </strong>
            <span className="review-history-summary-meta">
              <History size={14} />
              <span>{reviews.length} iterations</span>
              <span className="review-history-divider" />
              <span>
                {selectedCommentCount}{" "}
                {selectedCommentCount === 1 ? "comment" : "comments"}
              </span>
              <span className="review-history-divider" />
              <span>{selectedStatus}</span>
              {selectedMoment ? (
                <>
                  <span className="review-history-divider" />
                  <span>{selectedMoment}</span>
                </>
              ) : null}
            </span>
          </div>

          <button
            type="button"
            className="review-history-toggle"
            aria-expanded={!collapsed}
            aria-controls="review-history-strip"
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            <span>
              {collapsed ? `Show timeline (${selectedLabel})` : "Hide timeline"}
            </span>
          </button>
        </div>
      </div>

      {collapsed ? null : (
        <div
          id="review-history-strip"
          className="review-history-strip"
          role="tablist"
          aria-label="Review versions"
        >
          <button
            type="button"
            className={
              selectedReviewId === "all"
                ? "review-history-pill active"
                : "review-history-pill"
            }
            onClick={() => onSelect("all")}
            role="tab"
            aria-selected={selectedReviewId === "all"}
            aria-label={`Show all reviews with ${totalComments} comments`}
          >
            <span className="review-history-pill-copy">
              <span className="review-history-label">General</span>
              <span className="review-history-meta">
                All reviews in one stream
              </span>
            </span>
            <span className="review-history-state">Timeline</span>
            <span className="review-history-count">{totalComments}</span>
          </button>

          {reviews.map((review) => {
            const status = reviewStatus(review, activeReviewId);
            const tone = reviewStatusTone(review, activeReviewId);
            const commentCount = reviewCommentCounts[review.id] ?? 0;
            const moment = reviewMoment(review, activeReviewId);

            return (
              <button
                key={review.id}
                type="button"
                className={
                  selectedReviewId === review.id
                    ? "review-history-pill active"
                    : "review-history-pill"
                }
                onClick={() => onSelect(review.id)}
                role="tab"
                aria-selected={selectedReviewId === review.id}
                aria-label={`${formatReviewLabel(review)}, ${status}, ${commentCount} comments, ${moment}`}
              >
                <span className="review-history-pill-copy">
                  <span className="review-history-label">
                    {formatReviewLabel(review)}
                  </span>
                  <span className="review-history-meta">{moment}</span>
                </span>
                <span
                  className={`review-history-state review-history-state-${tone}`}
                >
                  {status}
                </span>
                <span className="review-history-count">{commentCount}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
