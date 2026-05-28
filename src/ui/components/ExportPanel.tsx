import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Copy, FileOutput, X } from "lucide-react";
import { formatReviewLabel } from "../../shared/reviews";
import type {
  ExportResponse,
  ReviewExportSelection,
  ReviewExportScope,
  ReviewVersion,
} from "../../shared/types";

function formatScopeCount(commentCount: number, reviewCount: number) {
  return `${commentCount} ${commentCount === 1 ? "comment" : "comments"} · ${reviewCount} ${reviewCount === 1 ? "review" : "reviews"}`;
}

function buildExportPathPreview(title: string) {
  const safe = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `.diffvision/exports/<timestamp>-${safe || "review"}.md`;
}

interface ExportPanelProps {
  open: boolean;
  exportResult: ExportResponse | null;
  reviews: ReviewVersion[];
  activeReviewId: string;
  currentCommentCount: number;
  totalCommentCount: number;
  reviewCommentCounts: Record<string, number>;
  onClose: () => void;
  onExport: (
    notes: string,
    title: string,
    selection: ReviewExportSelection,
  ) => Promise<ExportResponse>;
  onCopyToClipboard: (
    notes: string,
    title: string,
    selection: ReviewExportSelection,
  ) => Promise<void>;
}

const scopeDetails: Record<
  ReviewExportScope,
  { label: string; summary: string; detail: string }
> = {
  current: {
    label: "Current review",
    summary: "Archive the active draft and roll the workspace forward.",
    detail:
      "Use this when the current pass is ready to leave the workbench. DiffVision will archive it and open the next draft automatically.",
  },
  selected: {
    label: "Previous reviews",
    summary: "Repackage one or more earlier review passes.",
    detail:
      "This leaves the active draft untouched and is useful when you need to resend a specific exported pass or subset.",
  },
  complete: {
    label: "Complete history",
    summary: "Bundle every review iteration in one report.",
    detail:
      "Choose this for audits, handoffs, or when the reader needs the full timeline instead of a single pass.",
  },
};

export function ExportPanel({
  open,
  exportResult,
  reviews,
  activeReviewId,
  currentCommentCount,
  totalCommentCount,
  reviewCommentCounts,
  onClose,
  onExport,
  onCopyToClipboard,
}: ExportPanelProps) {
  const [title, setTitle] = useState("DiffVision review");
  const [notes, setNotes] = useState("");
  const [scope, setScope] = useState<ReviewExportScope>("current");
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"success" | "error" | null>(
    null,
  );
  const [copyMessage, setCopyMessage] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);
  const lastExportPathRef = useRef<string | null>(exportResult?.path ?? null);

  const previousReviews = useMemo(
    () => reviews.filter((review) => review.id !== activeReviewId),
    [reviews, activeReviewId],
  );
  const activeReview = useMemo(
    () => reviews.find((review) => review.id === activeReviewId) ?? null,
    [reviews, activeReviewId],
  );

  useEffect(() => {
    setSelectedReviewIds((current) => {
      const availableIds = new Set(previousReviews.map((review) => review.id));
      const filtered = current.filter((reviewId) => availableIds.has(reviewId));

      if (filtered.length) {
        return filtered;
      }

      return previousReviews.length
        ? [previousReviews[previousReviews.length - 1].id]
        : [];
    });
  }, [previousReviews]);

  useEffect(() => {
    if (scope === "selected" && !previousReviews.length) {
      setScope("complete");
    }
  }, [previousReviews.length, scope]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setCopyStatus(null);
    setCopyMessage("");
    setExportError(null);
    setLastSavedPath(null);
  }, [open]);

  useEffect(() => {
    const nextPath = exportResult?.path ?? null;

    if (open && nextPath && nextPath !== lastExportPathRef.current) {
      setLastSavedPath(nextPath);
      setExportError(null);
    }

    lastExportPathRef.current = nextPath;
  }, [exportResult, open]);

  const selection = useMemo<ReviewExportSelection>(() => {
    if (scope === "selected") {
      return {
        scope,
        reviewIds: selectedReviewIds,
      };
    }

    return { scope };
  }, [scope, selectedReviewIds]);

  const selectedCommentCount = useMemo(() => {
    if (scope === "current") {
      return currentCommentCount;
    }

    if (scope === "selected") {
      return selectedReviewIds.reduce(
        (sum, reviewId) => sum + (reviewCommentCounts[reviewId] ?? 0),
        0,
      );
    }

    return totalCommentCount;
  }, [
    currentCommentCount,
    reviewCommentCounts,
    scope,
    selectedReviewIds,
    totalCommentCount,
  ]);

  const canExport = scope !== "selected" || selectedReviewIds.length > 0;

  const selectedReviewCount =
    scope === "current"
      ? 1
      : scope === "selected"
        ? selectedReviewIds.length
        : reviews.length;

  const activeScopeDetails = scopeDetails[scope];
  const exportPathPreview = buildExportPathPreview(title);
  const currentReviewLabel = activeReview
    ? formatReviewLabel(activeReview)
    : "the current draft";
  const archivesCurrentDraft = scope === "current";
  const previousReviewsUnavailable = !previousReviews.length;
  const exportButtonLabel = archivesCurrentDraft
    ? `Archive ${currentReviewLabel} and export`
    : "Export to .diffvision/exports";

  const handleExport = useCallback(async () => {
    setCopyStatus(null);
    setCopyMessage("");
    setExportBusy(true);
    setExportError(null);
    setLastSavedPath(null);

    try {
      const result = await onExport(notes, title, selection);
      setLastSavedPath(result.path);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Could not save the review report locally",
      );
    } finally {
      setExportBusy(false);
    }
  }, [notes, onExport, selection, title]);

  const handleCopy = async () => {
    setExportError(null);
    setCopyBusy(true);
    try {
      await onCopyToClipboard(notes, title, selection);
      setCopyStatus("success");
      setCopyMessage("Minified review JSON copied to clipboard");
    } catch {
      setCopyStatus("error");
      setCopyMessage("Could not copy minified review JSON to clipboard");
    } finally {
      setCopyBusy(false);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        canExport &&
        !exportBusy &&
        !copyBusy
      ) {
        event.preventDefault();
        void handleExport();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canExport, copyBusy, exportBusy, handleExport, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay export-overlay" onClick={onClose}>
      <aside
        className="export-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-heading export-panel-heading">
          <div className="export-panel-copy">
            <span className="eyebrow">Local export</span>
            <h2>Package the review</h2>
            <p className="panel-subtitle">
              Write a Markdown handoff or copy a JSON snapshot without leaving
              the workbench.
            </p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close export panel"
          >
            <X size={14} />
          </button>
        </div>

        <section className="export-section">
          <div className="export-section-header">
            <h3>What to include</h3>
            <p>
              Choose whether you are packaging the live draft, a set of earlier
              passes or the entire timeline.
            </p>
          </div>

          <div className="scope-grid">
            {(["current", "selected", "complete"] as ReviewExportScope[]).map(
              (option) => {
                const optionDetails = scopeDetails[option];
                const optionCommentCount =
                  option === "current"
                    ? currentCommentCount
                    : option === "selected"
                      ? selectedReviewIds.reduce(
                          (sum, reviewId) =>
                            sum + (reviewCommentCounts[reviewId] ?? 0),
                          0,
                        )
                      : totalCommentCount;
                const optionReviewCount =
                  option === "current"
                    ? 1
                    : option === "selected"
                      ? selectedReviewIds.length
                      : reviews.length;

                return (
                  <button
                    key={option}
                    type="button"
                    className={
                      scope === option ? "scope-option active" : "scope-option"
                    }
                    onClick={() => setScope(option)}
                    disabled={
                      option === "selected" && previousReviewsUnavailable
                    }
                  >
                    <span className="scope-option-copy">
                      <span className="scope-option-label">
                        {optionDetails.label}
                      </span>
                      <span className="scope-option-meta">
                        {optionDetails.summary}
                      </span>
                      {option === "selected" && previousReviewsUnavailable ? (
                        <span className="scope-option-helper">
                          Available after you export at least one pass.
                        </span>
                      ) : null}
                    </span>
                    <span className="scope-option-count">
                      {formatScopeCount(optionCommentCount, optionReviewCount)}
                    </span>
                  </button>
                );
              },
            )}
          </div>

          {previousReviewsUnavailable ? (
            <p className="export-scope-help">
              Previous reviews unlock after the first local export. Until then,
              `Current review` and `Complete history` produce the same result.
            </p>
          ) : null}

          {scope === "selected" ? (
            <div className="stack-field">
              <span>Previous reviews</span>
              {previousReviews.length ? (
                <div className="review-checkbox-list">
                  {previousReviews.map((review) => {
                    const checked = selectedReviewIds.includes(review.id);
                    const commentCount = reviewCommentCounts[review.id] ?? 0;
                    return (
                      <label key={review.id} className="review-checkbox-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedReviewIds((current) =>
                              checked
                                ? current.filter(
                                    (reviewId) => reviewId !== review.id,
                                  )
                                : [...current, review.id],
                            );
                          }}
                        />
                        <span className="review-checkbox-copy">
                          <strong>{formatReviewLabel(review)}</strong>
                          <span>
                            {commentCount} comments ·{" "}
                            {review.exportedAt ? "exported" : "draft"}
                          </span>
                        </span>
                        <span className="review-checkbox-count">
                          {commentCount}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="export-scope-help">
                  No previous reviews exist yet. Export the current draft once
                  to create `v1`.
                </p>
              )}
            </div>
          ) : null}
        </section>

        <section className="export-summary">
          <div className="export-summary-grid">
            <div className="export-summary-item">
              <span className="export-summary-label">Included</span>
              <strong>
                {selectedCommentCount}{" "}
                {selectedCommentCount === 1 ? "comment" : "comments"}
              </strong>
            </div>
            <div className="export-summary-item">
              <span className="export-summary-label">Review passes</span>
              <strong>
                {selectedReviewCount}{" "}
                {selectedReviewCount === 1 ? "pass" : "passes"}
              </strong>
            </div>
            <div className="export-summary-item">
              <span className="export-summary-label">Scope</span>
              <strong>{activeScopeDetails.label}</strong>
            </div>
          </div>
          <p className="export-summary-note">{activeScopeDetails.detail}</p>
          {selectedCommentCount === 0 ? (
            <p className="export-summary-note">
              No inline comments are included yet. Export will still capture the
              review metadata and any framing notes you add here.
            </p>
          ) : null}
        </section>

        <section className="export-section">
          <div className="export-section-header">
            <h3>Report details</h3>
            <p>
              Set the heading and short framing note that will travel with the
              export.
            </p>
          </div>

          <label className="stack-field">
            <span>Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="DiffVision review"
            />
          </label>

          <label className="stack-field">
            <span>Notes</span>
            <textarea
              rows={8}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Lead with the main finding, then capture risk, context or follow-up."
            />
          </label>

          <p className="export-field-help">
            Keep the note short. The detailed evidence already lives in the
            inline comments.
          </p>
        </section>

        <div className="export-actions">
          <div className="export-actions-copy">
            <h3>Export outputs</h3>
            <p>
              {archivesCurrentDraft
                ? "Cmd/Ctrl + Enter writes the Markdown report, archives the active draft and opens the next pass. Clipboard export keeps the active draft untouched."
                : "Cmd/Ctrl + Enter writes the Markdown report. Clipboard export keeps the active draft untouched."}
            </p>
          </div>

          <div className="export-destination">
            <span className="export-destination-label">Next file</span>
            <span className="export-destination-path">{exportPathPreview}</span>
          </div>

          {archivesCurrentDraft ? (
            <div className="export-warning" role="note">
              <div className="result-head">
                <AlertCircle size={14} />
                <span>{currentReviewLabel} will be archived</span>
              </div>
              <p>
                Exporting the active draft closes this pass and opens the next
                one automatically. Use Copy JSON snapshot if you want to keep
                drafting without rotating versions.
              </p>
            </div>
          ) : null}

          <div className="export-action-row">
            <button
              className="primary-button"
              disabled={exportBusy || copyBusy || !canExport}
              onClick={() => void handleExport()}
            >
              <FileOutput size={14} />
              {exportBusy ? "Writing report..." : exportButtonLabel}
            </button>

            <button
              className="secondary-button"
              disabled={exportBusy || copyBusy || !canExport}
              onClick={() => void handleCopy()}
            >
              <Copy size={14} />
              {copyBusy
                ? "Copying JSON..."
                : archivesCurrentDraft
                  ? "Copy JSON without archiving"
                  : "Copy JSON snapshot"}
            </button>
          </div>
        </div>

        {copyStatus ? (
          <div
            className={
              copyStatus === "success"
                ? "export-result is-success"
                : "export-result is-error"
            }
            role={copyStatus === "success" ? "status" : "alert"}
          >
            <div className="result-head">
              {copyStatus === "success" ? (
                <Check size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              <span>
                {copyStatus === "success" ? "Copied" : "Clipboard error"}
              </span>
            </div>
            <p>{copyMessage}</p>
          </div>
        ) : null}

        {exportError ? (
          <div className="export-result is-error" role="alert">
            <div className="result-head">
              <AlertCircle size={14} />
              <span>Export failed</span>
            </div>
            <p>{exportError}</p>
            <p className="export-result-hint">
              Check write access to `.diffvision/exports`, then retry. If you
              only need a handoff payload, copy the JSON snapshot instead.
            </p>
            <div className="export-result-actions">
              <button
                className="secondary-button"
                disabled={exportBusy || copyBusy || !canExport}
                onClick={() => void handleExport()}
              >
                Retry export
              </button>
              <button
                className="secondary-button"
                disabled={exportBusy || copyBusy || !canExport}
                onClick={() => void handleCopy()}
              >
                Copy JSON instead
              </button>
            </div>
          </div>
        ) : null}

        {lastSavedPath ? (
          <div className="export-result is-success" role="status">
            <div className="result-head">
              <Check size={14} />
              <span>Report saved locally</span>
            </div>
            <p>{lastSavedPath}</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
