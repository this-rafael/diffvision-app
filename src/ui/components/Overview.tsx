import {
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  History,
  Minus,
  Plus,
} from "lucide-react";
import type { RepositorySnapshot } from "../../shared/types";

interface OverviewReviewSummary {
  label: string;
  status: string;
  commentCount: number;
  totalReviews: number;
}

interface OverviewProps {
  snapshot: RepositorySnapshot;
  compact?: boolean;
  reviewSummary?: OverviewReviewSummary;
  workspaceMetrics?: {
    commentedFiles: number;
    highSeverityFindings: number;
    bookmarks: number;
  };
}

function relativeTime(value: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function Overview({
  snapshot,
  compact = false,
  reviewSummary,
  workspaceMetrics,
}: OverviewProps) {
  const diffTotal = Math.max(
    1,
    snapshot.totalAdditions + snapshot.totalDeletions,
  );
  const addRatio = (snapshot.totalAdditions / diffTotal) * 100;
  const shortHead = snapshot.head.slice(0, 7);
  const title = snapshot.branch.replace(/[._/-]+/g, " ").trim()
    ? snapshot.branch.charAt(0).toUpperCase() +
      snapshot.branch.slice(1).replace(/[._/-]+/g, " ") +
      " review across the active working tree"
    : "Working tree review";
  const compareLabel = snapshot.compareRelativeToRef
    ? `new in ${snapshot.compareNewInRef} vs ${snapshot.compareRelativeToRef}`
    : snapshot.compareNewInRef;

  if (compact) {
    return (
      <div className="overview-shell overview-shell-compact">
        <div className="overview-compact-main">
          <div className="overview-compact-titleline">
            <h1 className="overview-compact-title">{title}</h1>
            <span className="overview-compact-age">
              {relativeTime(snapshot.lastUpdated)}
            </span>
          </div>

          <div className="overview-compact-meta">
            <span className="mono">{snapshot.repoName}</span>
            <span className="hero-dot" />
            <span>{compareLabel}</span>
          </div>

          <div className="overview-compact-pills">
            <span className="hero-meta-pill">
              <GitBranch size={11} />
              <span>{snapshot.branch}</span>
            </span>
            <span className="hero-meta-pill">
              <GitCommitHorizontal size={11} />
              <span>{shortHead}</span>
            </span>
            {reviewSummary ? (
              <span className="hero-meta-pill overview-review-summary-pill">
                <History size={11} />
                <span>{reviewSummary.label}</span>
                <span className="overview-compact-status">
                  {reviewSummary.status}
                </span>
                <span>{reviewSummary.commentCount}</span>
                <span className="overview-compact-status">
                  / {reviewSummary.totalReviews} reviews
                </span>
              </span>
            ) : null}
            {workspaceMetrics ? (
              <span className="hero-meta-pill overview-review-summary-pill">
                <FileDiff size={11} />
                <span>{workspaceMetrics.commentedFiles} commented files</span>
                <span className="overview-compact-status">
                  {workspaceMetrics.highSeverityFindings} high severity
                </span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="overview-compact-metrics">
          <span className="overview-compact-metric">
            <FileDiff size={13} />
            {snapshot.changedFiles}
          </span>
          <span className="overview-compact-metric add-color">
            <Plus size={13} />
            {snapshot.totalAdditions}
          </span>
          <span className="overview-compact-metric del-color">
            <Minus size={13} />
            {snapshot.totalDeletions}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="overview-shell">
      <div className="hero-breadcrumb">
        <span>Repository</span>
        <span className="hero-dot" />
        <span>Working Tree</span>
        <span className="hero-dot" />
        <span className="hero-pr">#{snapshot.changedFiles}</span>
      </div>

      <h1 className="hero-title">
        <span className="text-gradient">{title}</span>
      </h1>

      <div className="hero-meta">
        <span className="mono">{snapshot.repoName}</span>
        <span className="hero-meta-pill">
          <GitBranch size={11} />
          <span>{compareLabel}</span>
          <span className="hero-meta-arrow">←</span>
          <span className="meta-branch-head">{snapshot.branch}</span>
        </span>
        <span className="hero-meta-pill">
          <GitCommitHorizontal size={11} />
          <span>{shortHead}</span>
        </span>
        <span>· {relativeTime(snapshot.lastUpdated)}</span>
      </div>

      <div className="hero-grid">
        <div className="metric-card">
          <span className="metric-label">Files</span>
          <span className="metric-value">
            <FileDiff size={16} style={{ color: "var(--text-soft)" }} />
            {snapshot.changedFiles}
          </span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Added</span>
          <span className="metric-value add-color">
            <Plus size={16} />
            {snapshot.totalAdditions}
          </span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Removed</span>
          <span className="metric-value del-color">
            <Minus size={16} />
            {snapshot.totalDeletions}
          </span>
        </div>
        {workspaceMetrics ? (
          <div className="metric-card">
            <span className="metric-label">Commented Files</span>
            <span className="metric-value">
              <History size={16} style={{ color: "var(--text-soft)" }} />
              {workspaceMetrics.commentedFiles}
            </span>
          </div>
        ) : null}
        {workspaceMetrics ? (
          <div className="metric-card">
            <span className="metric-label">High Severity</span>
            <span className="metric-value del-color">
              <Minus size={16} />
              {workspaceMetrics.highSeverityFindings}
            </span>
          </div>
        ) : null}
        {workspaceMetrics ? (
          <div className="metric-card">
            <span className="metric-label">Bookmarks</span>
            <span className="metric-value">
              <GitBranch size={16} style={{ color: "var(--text-soft)" }} />
              {workspaceMetrics.bookmarks}
            </span>
          </div>
        ) : null}
      </div>

      <div className="diff-balance" aria-hidden="true">
        <div className="diff-balance-add" style={{ width: `${addRatio}%` }} />
        <div
          className="diff-balance-remove"
          style={{ width: `${100 - addRatio}%` }}
        />
      </div>
    </div>
  );
}
