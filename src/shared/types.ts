export type DiffViewMode = "unified" | "side-by-side";

export type DiffFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "binary";

export type DiffLineType = "context" | "added" | "removed" | "hunk";

export interface DiffVisionConfig {
  theme: "dark" | "system";
  openBrowser: boolean;
  defaultView: DiffViewMode;
  port: number;
  host: string;
  compareRef: string;
  compareTargetRef?: string;
}

export interface DiffLine {
  id: string;
  type: DiffLineType;
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: DiffFileStatus;
  stagedStatus: string;
  unstagedStatus: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
  hunks: DiffLine[];
  rawPatch: string;
}

export const reviewCommentCategories = [
  { id: "bug", label: "Bug" },
  { id: "refactor", label: "Refactor" },
  { id: "performance", label: "Performance" },
  { id: "security", label: "Security" },
  { id: "readability", label: "Readability" },
  { id: "suggestion", label: "Suggestion" },
] as const;

export type ReviewCommentCategory =
  (typeof reviewCommentCategories)[number]["id"];
export type ReviewCommentSeverity = "info" | "minor" | "major" | "critical";

export interface ReviewComment {
  id: string;
  reviewId: string;
  filePath: string;
  line: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  category: ReviewCommentCategory;
  severity: ReviewCommentSeverity;
  body: string;
  snippet?: string;
  author: string;
  when: string;
}

export interface ReviewVersion {
  id: string;
  version: number;
  createdAt: string;
  exportedAt?: string;
  lastExportTitle?: string;
  lastExportNotes?: string;
}

export interface ReviewHistory {
  activeReviewId: string;
  reviews: ReviewVersion[];
  comments: ReviewComment[];
}

export type ReviewExportScope = "current" | "selected" | "complete";

export interface ReviewExportSelection {
  scope: ReviewExportScope;
  reviewIds?: string[];
}

export interface RepositorySnapshot {
  repoRoot: string;
  repoName: string;
  branch: string;
  compareRef: string;
  compareBaseRef: string;
  compareTargetRef?: string;
  compareNewInRef: string;
  compareRelativeToRef?: string;
  head: string;
  isDetached: boolean;
  ahead: number;
  behind: number;
  changedFiles: number;
  stagedFiles: number;
  unstagedFiles: number;
  untrackedFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  lastUpdated: string;
  config: DiffVisionConfig;
  files: DiffFile[];
}

export interface ExportRequest {
  title?: string;
  notes?: string;
  comments?: ReviewComment[];
  reviews?: ReviewVersion[];
  activeReviewId?: string;
  selection?: ReviewExportSelection;
}

export interface ExportResponse {
  path: string;
  markdown: string;
}

export interface ExportMarkdownResponse {
  markdown: string;
}

export interface ReviewJsonExportColumns {
  start: number | null;
  end: number | null;
}

export interface ReviewJsonExportItem {
  filePath: string;
  reviewId?: string;
  reviewVersion?: number;
  reviewLabel?: string;
  lines: {
    start: number;
    end: number;
  };
  columns?: ReviewJsonExportColumns;
  comment: string;
  snippet?: string;
  category: ReviewCommentCategory;
  severity: ReviewCommentSeverity;
}

export interface ReviewJsonExportReview {
  id: string;
  version: number;
  label: string;
  createdAt: string;
  exportedAt?: string;
}

export interface ReviewJsonExportContext {
  title: string;
  repoName: string;
  repoRoot: string;
  branch: string;
  reviewedRef: string;
  baseRef: string;
  compareRef: string;
  head: string;
  generatedAt: string;
  scope: ReviewExportScope;
  includedReviews: ReviewJsonExportReview[];
  notes?: string;
}

export interface ReviewJsonExportPayload {
  prompt: string;
  context: ReviewJsonExportContext;
  data: ReviewJsonExportItem[];
}

export interface ExportJsonResponse {
  json: string;
}

export type ServerMessage =
  | {
      type: "snapshot:update";
      hash: string;
      changedFiles: number;
      branch: string;
      lastUpdated: string;
    }
  | {
      type: "heartbeat";
      lastUpdated: string;
    };
