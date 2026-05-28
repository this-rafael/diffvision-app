import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-json";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-yaml";
import {
  ChevronDown,
  Columns2,
  Copy,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  MoreHorizontal,
  Rows3,
  Sparkles,
  X,
} from "lucide-react";
import type {
  DiffFile,
  DiffLine,
  DiffViewMode,
  ReviewComment,
  ReviewCommentCategory,
  ReviewCommentSeverity,
} from "../../shared/types";
import { getTrackingBadges } from "../fileTracking";

interface DiffViewerProps {
  file: DiffFile;
  mode: DiffViewMode;
  comments: ReviewComment[];
  reviewLabels?: Record<string, string>;
  focusRequest?: {
    filePath: string;
    line: number;
    commentId?: string;
    key: number;
  } | null;
  readOnly?: boolean;
  readOnlyReason?: string;
  onScrollStateChange?: (isScrolledPastThreshold: boolean) => void;
  onModeChange: (mode: DiffViewMode) => void;
  onAddComment: (comment: {
    line: number;
    endLine?: number;
    startColumn?: number;
    endColumn?: number;
    category: ReviewCommentCategory;
    severity: ReviewCommentSeverity;
    body: string;
    snippet?: string;
  }) => void;
  onUpdateComment: (
    commentId: string,
    patch: {
      line?: number;
      endLine?: number;
      category?: ReviewCommentCategory;
      severity?: ReviewCommentSeverity;
      body?: string;
    },
  ) => void;
  onDeleteComment: (commentId: string) => void;
}

type CommentDraftPayload = Parameters<DiffViewerProps["onAddComment"]>[0];
type CommentDeleteHandler = (comment: ReviewComment) => void;

interface CommentDraft {
  line: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  snippet?: string;
  presetBody?: string;
  source: "line" | "selection";
}

interface SelectedRange {
  start: number;
  end: number;
}

interface SelectedTextState {
  text: string;
  startColumn?: number;
  endColumn?: number;
}

interface ViewerFeedback {
  tone: "success" | "error" | "info";
  message: string;
}

interface RestorableComment {
  payload: CommentDraftPayload;
  targetLabel: string;
}

const commentCategories = [
  { id: "bug", label: "Bug", color: "var(--category-bug)" },
  { id: "refactor", label: "Refactor", color: "var(--category-refactor)" },
  {
    id: "performance",
    label: "Performance",
    color: "var(--category-performance)",
  },
  { id: "security", label: "Security", color: "var(--category-security)" },
  {
    id: "readability",
    label: "Readability",
    color: "var(--category-readability)",
  },
  {
    id: "suggestion",
    label: "Suggestion",
    color: "var(--category-suggestion)",
  },
] as const;

function severityDotClass(severity: ReviewCommentSeverity) {
  if (severity === "critical") {
    return "severity-dot severity-critical";
  }

  if (severity === "major") {
    return "severity-dot severity-major";
  }

  if (severity === "minor") {
    return "severity-dot severity-minor";
  }

  return "severity-dot severity-info";
}

function lineClass(type: DiffLine["type"]) {
  if (type === "added") {
    return "diff-row diff-added";
  }

  if (type === "removed") {
    return "diff-row diff-removed";
  }

  if (type === "hunk") {
    return "diff-row diff-hunk";
  }

  return "diff-row";
}

function filePathParts(path: string) {
  const parts = path.split("/");
  return {
    dirname: parts.slice(0, -1).join("/"),
    basename: parts.at(-1) ?? path,
  };
}

function hunkLabel(text: string) {
  const match = /@@.*@@\s*(.*)$/.exec(text);
  return match?.[1] || "changed block";
}

function getTargetLine(line: DiffLine) {
  return line.newNumber ?? line.oldNumber ?? 0;
}

function lineInRange(targetLine: number, range: SelectedRange | null) {
  if (!range) {
    return false;
  }

  return targetLine >= range.start && targetLine <= range.end;
}

function describeLineRange(line: number, endLine?: number) {
  return endLine && endLine !== line
    ? `lines ${line}-${endLine}`
    : `line ${line}`;
}

function findDiffLineElement(node: Node | null) {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);

  while (current) {
    if (current.dataset.diffLine) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function findSyntaxLineElement(node: Node | null) {
  let current: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);

  while (current) {
    if (current.classList.contains("syntax-line")) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function resolveLineNumber(node: Node | null) {
  const value = findDiffLineElement(node)?.dataset.diffLine;
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveColumn(node: Node, offset: number, edge: "start" | "end") {
  const codeElement = findSyntaxLineElement(node);
  if (!codeElement) {
    return undefined;
  }

  try {
    const range = document.createRange();
    range.selectNodeContents(codeElement);
    range.setEnd(node, offset);
    const length = range.toString().length;
    return edge === "start" ? length + 1 : Math.max(1, length);
  } catch {
    return undefined;
  }
}

const prismLanguageByExtension = new Map<string, string>([
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["jsx", "jsx"],
  ["json", "json"],
  ["css", "css"],
  ["scss", "scss"],
  ["html", "markup"],
  ["md", "markdown"],
  ["yml", "yaml"],
  ["yaml", "yaml"],
]);

function resolvePrismLanguage(filePath: string) {
  const extension = filePath.split(".").at(-1)?.toLowerCase() ?? "";
  return prismLanguageByExtension.get(extension);
}

function renderCode(text: string, filePath: string): ReactNode {
  if (!text) {
    return " ";
  }

  const language = resolvePrismLanguage(filePath);
  const grammar = language ? Prism.languages[language] : undefined;

  if (!language || !grammar) {
    return text;
  }

  const html = Prism.highlight(text, grammar, language);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function AddCommentButton({
  line,
  onAdd,
}: {
  line: DiffLine;
  onAdd: (lineNumber: number) => void;
}) {
  if (line.type === "hunk") {
    return null;
  }

  const targetLine = getTargetLine(line);

  return (
    <button
      type="button"
      onClick={() => onAdd(targetLine)}
      className="line-comment-button"
      title={`Add comment on ${describeLineRange(targetLine)}`}
      aria-label={`Add comment on ${describeLineRange(targetLine)}`}
    >
      <MessageSquarePlus size={12} />
    </button>
  );
}

function NewCommentForm({
  line,
  endLine,
  startColumn,
  endColumn,
  snippet,
  presetBody,
  onCancel,
  onSubmit,
}: {
  line: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  snippet?: string;
  presetBody?: string;
  onCancel: () => void;
  onSubmit: (comment: CommentDraftPayload) => void;
}) {
  const [body, setBody] = useState(presetBody ?? "");
  const [endLineInput, setEndLineInput] = useState(
    endLine ? String(endLine) : "",
  );
  const [category, setCategory] = useState<ReviewCommentCategory>("suggestion");
  const [severity, setSeverity] = useState<ReviewCommentSeverity>("minor");
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setBody(presetBody ?? "");
    setEndLineInput(endLine ? String(endLine) : "");
    setDetailsOpen(false);
  }, [line, endLine, presetBody, snippet]);

  const parsedEndLine = endLineInput
    ? Number.parseInt(endLineInput, 10)
    : undefined;
  const normalizedEndLine =
    typeof parsedEndLine === "number" && Number.isFinite(parsedEndLine)
      ? Math.max(line, parsedEndLine)
      : undefined;
  const targetLabel = describeLineRange(line, normalizedEndLine);

  const saveComment = () => {
    if (!body.trim()) {
      return;
    }

    onSubmit({
      line,
      endLine: normalizedEndLine,
      startColumn,
      endColumn,
      category,
      severity,
      body: body.trim(),
      snippet,
    });
  };

  return (
    <div className="inline-comment-form">
      <div className="inline-comment-header">
        <span className="inline-comment-title">
          <Sparkles size={12} />
          Comment on {targetLabel}
        </span>
      </div>

      <div className="comment-draft-context">
        <span className="comment-draft-target">{targetLabel}</span>
        {snippet ? (
          <code className="comment-draft-snippet">{snippet}</code>
        ) : (
          <p className="comment-draft-hint">
            Keep the patch visible and write the finding first. Review details
            stay optional.
          </p>
        )}
      </div>

      <textarea
        autoFocus
        rows={5}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            saveComment();
          }
        }}
        placeholder={`Explain what matters about ${targetLabel}...`}
      />

      <div className="comment-primary-actions">
        <button
          type="button"
          className="ghost-button"
          onClick={() => setDetailsOpen((current) => !current)}
        >
          {detailsOpen ? "Hide details" : "Review details"}
        </button>
        <span className="comment-save-hint">Ctrl/Cmd + Enter saves</span>
        <button type="button" className="ghost-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!body.trim()}
          onClick={saveComment}
        >
          Save comment
        </button>
      </div>

      {detailsOpen ? (
        <div className="comment-detail-panel">
          <div className="range-field-row">
            <label>
              Start
              <input type="number" value={line} disabled />
            </label>
            <label>
              End
              <input
                type="number"
                min={line}
                value={endLineInput}
                onChange={(event) => setEndLineInput(event.target.value)}
                placeholder={`${line}`}
              />
            </label>
          </div>

          <div className="comment-category-row">
            {commentCategories.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  category === item.id
                    ? "category-pill active"
                    : "category-pill"
                }
                style={
                  category === item.id
                    ? {
                        background: `color-mix(in oklab, ${item.color} 22%, transparent)`,
                        boxShadow: `inset 0 0 0 1px ${item.color}`,
                      }
                    : undefined
                }
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="inline-comment-actions">
            <label className="comment-detail-field">
              Severity
              <select
                value={severity}
                onChange={(event) =>
                  setSeverity(event.target.value as ReviewCommentSeverity)
                }
              >
                {(["info", "minor", "major", "critical"] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CommentCard({
  comment,
  reviewLabel,
  highlighted,
  readOnly,
  onUpdate,
  onDelete,
}: {
  comment: ReviewComment;
  reviewLabel?: string;
  highlighted?: boolean;
  readOnly?: boolean;
  onUpdate: DiffViewerProps["onUpdateComment"];
  onDelete: CommentDeleteHandler;
}) {
  const category = commentCategories.find(
    (item) => item.id === comment.category,
  );
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [categoryInput, setCategoryInput] = useState<ReviewCommentCategory>(
    comment.category,
  );
  const [severityInput, setSeverityInput] = useState<ReviewCommentSeverity>(
    comment.severity,
  );
  const [startLineInput, setStartLineInput] = useState(String(comment.line));
  const [endLineInput, setEndLineInput] = useState(
    comment.endLine ? String(comment.endLine) : "",
  );

  useEffect(() => {
    if (readOnly) {
      setEditing(false);
    }
  }, [readOnly]);

  return (
    <div
      className={
        highlighted
          ? "inline-comment-wrap is-highlighted"
          : "inline-comment-wrap"
      }
      data-comment-id={comment.id}
    >
      <div className="inline-comment-card">
        <div className="inline-comment-headrow">
          <div className="inline-comment-avatar">
            {(comment.author[0] ?? "u").toUpperCase()}
          </div>
          <span className="inline-comment-author">{comment.author}</span>
          {reviewLabel ? (
            <span className="inline-comment-review">{reviewLabel}</span>
          ) : null}
          <span
            className="inline-comment-category"
            style={{
              background: category
                ? `color-mix(in oklab, ${category.color} 18%, transparent)`
                : undefined,
              color: category?.color,
            }}
          >
            {category?.label ?? comment.category}
          </span>
          <span className="inline-comment-severity">
            <span className={severityDotClass(comment.severity)} />
            {comment.severity}
          </span>
          <span className="inline-comment-when">{comment.when}</span>
          {readOnly ? null : (
            <button
              type="button"
              className="comment-menu-button"
              onClick={() => setEditing((value) => !value)}
              aria-label={editing ? "Close comment editor" : "Edit comment"}
              title={editing ? "Close edit" : "Edit comment"}
            >
              <MoreHorizontal size={12} />
            </button>
          )}
        </div>

        {editing ? (
          <div className="inline-comment-editor">
            <div className="range-field-row compact">
              <label>
                Start
                <input
                  type="number"
                  min={1}
                  value={startLineInput}
                  onChange={(event) => setStartLineInput(event.target.value)}
                />
              </label>
              <label>
                End
                <input
                  type="number"
                  value={endLineInput}
                  onChange={(event) => setEndLineInput(event.target.value)}
                  placeholder={startLineInput || "1"}
                />
              </label>
            </div>

            <div className="inline-comment-controls compact">
              <div className="comment-category-row">
                {commentCategories.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={
                      categoryInput === item.id
                        ? "category-pill active"
                        : "category-pill"
                    }
                    style={
                      categoryInput === item.id
                        ? {
                            background: `color-mix(in oklab, ${item.color} 22%, transparent)`,
                            boxShadow: `inset 0 0 0 1px ${item.color}`,
                          }
                        : undefined
                    }
                    onClick={() => setCategoryInput(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="inline-comment-actions">
                <select
                  value={severityInput}
                  onChange={(event) =>
                    setSeverityInput(
                      event.target.value as ReviewCommentSeverity,
                    )
                  }
                >
                  {(["info", "minor", "major", "critical"] as const).map(
                    (value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>

            <textarea
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />

            <div className="inline-comment-actions comment-edit-actions">
              <button
                type="button"
                className="danger-button"
                onClick={() => onDelete(comment)}
              >
                Delete
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setBody(comment.body);
                  setCategoryInput(comment.category);
                  setSeverityInput(comment.severity);
                  setStartLineInput(String(comment.line));
                  setEndLineInput(
                    comment.endLine ? String(comment.endLine) : "",
                  );
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!body.trim()}
                onClick={() => {
                  const nextStart = Math.max(
                    1,
                    Number.parseInt(startLineInput || "1", 10) || 1,
                  );
                  const nextEndRaw = Number.parseInt(endLineInput || "", 10);
                  const nextEnd = Number.isFinite(nextEndRaw)
                    ? Math.max(nextStart, nextEndRaw)
                    : undefined;

                  onUpdate(comment.id, {
                    line: nextStart,
                    endLine: nextEnd,
                    category: categoryInput,
                    severity: severityInput,
                    body: body.trim(),
                  });
                  setEditing(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="inline-comment-body">
            <div className="inline-comment-range-label">
              Lines {comment.line}
              {comment.endLine ? `-${comment.endLine}` : ""}
            </div>
            {comment.body}
          </div>
        )}
      </div>
    </div>
  );
}

function UnifiedView({
  hunks,
  filePath,
  comments,
  reviewLabels,
  highlightedCommentId,
  readOnly,
  onAdd,
  selectedRange,
  onSelectLine,
  onUpdateComment,
  onDeleteComment,
}: {
  hunks: DiffLine[];
  filePath: string;
  comments: ReviewComment[];
  reviewLabels?: Record<string, string>;
  highlightedCommentId?: string | null;
  readOnly?: boolean;
  onAdd: (lineNumber: number) => void;
  selectedRange: SelectedRange | null;
  onSelectLine: (
    lineNumber: number,
    anchor: { x: number; y: number },
    extend: boolean,
  ) => void;
  onUpdateComment: DiffViewerProps["onUpdateComment"];
  onDeleteComment: CommentDeleteHandler;
}) {
  return (
    <div className="diff-table unified">
      {hunks.map((line) => {
        const targetLine = getTargetLine(line);
        const selectionLabel = `Select ${describeLineRange(targetLine)}. Shift-click to extend the selection.`;
        const lineComments = comments.filter(
          (comment) => line.type !== "hunk" && comment.line === targetLine,
        );

        return (
          <div key={line.id}>
            <div
              className={`${lineClass(line.type)} ${lineInRange(targetLine, selectedRange) ? "diff-row-selected" : ""}`}
              data-diff-line={
                line.type !== "hunk" ? String(targetLine) : undefined
              }
            >
              {line.type === "hunk" ? (
                <>
                  <ChevronDown size={12} />
                  <span>{line.text}</span>
                  <span className="hunk-label-text">
                    {hunkLabel(line.text)}
                  </span>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="line-number line-select-button"
                    aria-label={selectionLabel}
                    title={selectionLabel}
                    onClick={(event) =>
                      onSelectLine(
                        targetLine,
                        {
                          x: event.currentTarget.getBoundingClientRect().left,
                          y: event.currentTarget.getBoundingClientRect().top,
                        },
                        event.shiftKey,
                      )
                    }
                  >
                    {line.oldNumber ?? ""}
                  </button>
                  <button
                    type="button"
                    className="line-number line-select-button"
                    aria-label={selectionLabel}
                    title={selectionLabel}
                    onClick={(event) =>
                      onSelectLine(
                        targetLine,
                        {
                          x: event.currentTarget.getBoundingClientRect().left,
                          y: event.currentTarget.getBoundingClientRect().top,
                        },
                        event.shiftKey,
                      )
                    }
                  >
                    {line.newNumber ?? ""}
                  </button>
                  <span className="line-marker">
                    {line.type === "added"
                      ? "+"
                      : line.type === "removed"
                        ? "−"
                        : " "}
                  </span>
                  <code className="syntax-line">
                    {renderCode(line.text, filePath)}
                  </code>
                  {!readOnly ? (
                    <AddCommentButton line={line} onAdd={onAdd} />
                  ) : null}
                </>
              )}
            </div>

            {lineComments.map((comment) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                reviewLabel={reviewLabels?.[comment.reviewId]}
                highlighted={highlightedCommentId === comment.id}
                readOnly={readOnly}
                onUpdate={onUpdateComment}
                onDelete={onDeleteComment}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function pairSplitRows(hunks: DiffLine[]) {
  const rows: Array<{ left?: DiffLine; right?: DiffLine; hunk?: DiffLine }> =
    [];

  for (let index = 0; index < hunks.length; index += 1) {
    const line = hunks[index];

    if (line.type === "hunk") {
      rows.push({ hunk: line });
      continue;
    }

    if (line.type === "context") {
      rows.push({ left: line, right: line });
      continue;
    }

    if (line.type === "removed") {
      const removed = [line];
      const added: DiffLine[] = [];

      while (hunks[index + 1]?.type === "removed") {
        removed.push(hunks[index + 1]);
        index += 1;
      }

      while (hunks[index + 1]?.type === "added") {
        added.push(hunks[index + 1]);
        index += 1;
      }

      const count = Math.max(removed.length, added.length);
      for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
        rows.push({ left: removed[rowIndex], right: added[rowIndex] });
      }

      continue;
    }

    rows.push({ right: line });
  }

  return rows;
}

function SideBySideView({
  hunks,
  filePath,
  comments,
  reviewLabels,
  highlightedCommentId,
  readOnly,
  onAdd,
  selectedRange,
  onSelectLine,
  onUpdateComment,
  onDeleteComment,
}: {
  hunks: DiffLine[];
  filePath: string;
  comments: ReviewComment[];
  reviewLabels?: Record<string, string>;
  highlightedCommentId?: string | null;
  readOnly?: boolean;
  onAdd: (lineNumber: number) => void;
  selectedRange: SelectedRange | null;
  onSelectLine: (
    lineNumber: number,
    anchor: { x: number; y: number },
    extend: boolean,
  ) => void;
  onUpdateComment: DiffViewerProps["onUpdateComment"];
  onDeleteComment: CommentDeleteHandler;
}) {
  const rows = useMemo(() => pairSplitRows(hunks), [hunks]);

  return (
    <div className="split-table">
      {rows.map((row, index) => {
        if (row.hunk) {
          return (
            <div key={`${row.hunk.id}-${index}`} className="split-hunk">
              <ChevronDown size={12} />
              <span>{row.hunk.text}</span>
              <span className="hunk-label-text">
                {hunkLabel(row.hunk.text)}
              </span>
            </div>
          );
        }

        const target = row.right ?? row.left;
        const targetLine = target ? getTargetLine(target) : 0;
        const isSelected =
          selectedRange &&
          targetLine >= selectedRange.start &&
          targetLine <= selectedRange.end;
        const selectionLabel = `Select ${describeLineRange(targetLine)}. Shift-click to extend the selection.`;
        const lineComments = comments.filter(
          (comment) => comment.line === targetLine,
        );

        return (
          <div key={`${row.left?.id ?? row.right?.id}-${index}`}>
            <div
              className={
                isSelected ? "split-row diff-row-selected" : "split-row"
              }
              data-diff-line={String(targetLine)}
            >
              <div
                className={
                  row.left ? lineClass(row.left.type) : "diff-row ghost-row"
                }
              >
                <button
                  type="button"
                  className="line-number line-select-button"
                  aria-label={selectionLabel}
                  title={selectionLabel}
                  onClick={(event) =>
                    onSelectLine(
                      targetLine,
                      {
                        x: event.currentTarget.getBoundingClientRect().left,
                        y: event.currentTarget.getBoundingClientRect().top,
                      },
                      event.shiftKey,
                    )
                  }
                >
                  {row.left?.oldNumber ?? ""}
                </button>
                <code className="syntax-line">
                  {renderCode(row.left?.text ?? " ", filePath)}
                </code>
              </div>

              <div
                className={
                  row.right ? lineClass(row.right.type) : "diff-row ghost-row"
                }
              >
                <button
                  type="button"
                  className="line-number line-select-button"
                  aria-label={selectionLabel}
                  title={selectionLabel}
                  onClick={(event) =>
                    onSelectLine(
                      targetLine,
                      {
                        x: event.currentTarget.getBoundingClientRect().left,
                        y: event.currentTarget.getBoundingClientRect().top,
                      },
                      event.shiftKey,
                    )
                  }
                >
                  {row.right?.newNumber ?? ""}
                </button>
                <code className="syntax-line">
                  {renderCode(row.right?.text ?? " ", filePath)}
                </code>
                {row.right && !readOnly ? (
                  <AddCommentButton line={row.right} onAdd={onAdd} />
                ) : null}
              </div>
            </div>

            {lineComments.map((comment) => (
              <CommentCard
                key={comment.id}
                comment={comment}
                reviewLabel={reviewLabels?.[comment.reviewId]}
                highlighted={highlightedCommentId === comment.id}
                readOnly={readOnly}
                onUpdate={onUpdateComment}
                onDelete={onDeleteComment}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function DiffViewer({
  file,
  mode,
  comments,
  reviewLabels,
  focusRequest,
  readOnly,
  readOnlyReason,
  onScrollStateChange,
  onModeChange,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: DiffViewerProps) {
  const compactScrollThreshold = 32;
  const compactScrollReleaseThreshold = 8;
  const compactMinVisibleDiffHeight = 140;
  const compactReleaseVisibleDiffHeight = 220;
  const { dirname, basename } = filePathParts(file.path);
  const trackingBadges = getTrackingBadges(file);
  const [composer, setComposer] = useState<CommentDraft | null>(null);
  const [selectedRange, setSelectedRange] = useState<SelectedRange | null>(
    null,
  );
  const [selectedText, setSelectedText] = useState<SelectedTextState | null>(
    null,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [feedback, setFeedback] = useState<ViewerFeedback | null>(null);
  const [restorableComment, setRestorableComment] =
    useState<RestorableComment | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState<
    string | null
  >(null);
  const diffScrollRef = useRef<HTMLDivElement | null>(null);
  const lastScrollCompactStateRef = useRef(false);
  const scrollRestoreFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isFullscreen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  useEffect(
    () => () => {
      if (scrollRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollRestoreFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!readOnly) {
      return;
    }

    setComposer(null);
    setSelectedRange(null);
    setSelectedText(null);
  }, [readOnly]);

  useEffect(() => {
    setComposer(null);
    setSelectedRange(null);
    setSelectedText(null);
    setFeedback(null);
    setRestorableComment(null);
    setHighlightedCommentId(null);
  }, [file.path]);

  useEffect(() => {
    if (!focusRequest || focusRequest.filePath !== file.path) {
      return;
    }

    const timer = window.setTimeout(() => {
      const diffRoot = diffScrollRef.current;
      const commentElement = focusRequest.commentId
        ? (diffRoot?.querySelector(
            `[data-comment-id="${focusRequest.commentId}"]`,
          ) as HTMLElement | null)
        : null;
      const lineElement = diffRoot?.querySelector(
        `[data-diff-line="${focusRequest.line}"]`,
      ) as HTMLElement | null;
      const targetElement = commentElement ?? lineElement;

      targetElement?.scrollIntoView({
        block: "center",
        inline: "nearest",
      });

      setSelectedRange({ start: focusRequest.line, end: focusRequest.line });
      setHighlightedCommentId(focusRequest.commentId ?? null);
      setFeedback({
        tone: "info",
        message: focusRequest.commentId
          ? `Jumped to comment on ${describeLineRange(focusRequest.line)}.`
          : `Jumped to ${describeLineRange(focusRequest.line)}.`,
      });
    }, 48);

    return () => window.clearTimeout(timer);
  }, [file.path, focusRequest]);

  useEffect(() => {
    if (!highlightedCommentId) {
      return undefined;
    }

    const timer = window.setTimeout(() => setHighlightedCommentId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightedCommentId]);

  useEffect(() => {
    if (!feedback) {
      return undefined;
    }

    const timer = window.setTimeout(
      () => {
        setFeedback(null);
        setRestorableComment(null);
      },
      restorableComment ? 6000 : 2600,
    );

    return () => window.clearTimeout(timer);
  }, [feedback, restorableComment]);

  const resolveCompactChromeState = (
    scrollTop: number,
    visibleDiffHeight: number,
  ) => {
    if (scrollTop > compactScrollThreshold) {
      return true;
    }

    if (scrollTop > compactScrollReleaseThreshold) {
      return lastScrollCompactStateRef.current;
    }

    if (lastScrollCompactStateRef.current) {
      return visibleDiffHeight < compactReleaseVisibleDiffHeight;
    }

    return visibleDiffHeight < compactMinVisibleDiffHeight;
  };

  useEffect(() => {
    if (!onScrollStateChange) {
      return;
    }

    const diffRoot = diffScrollRef.current;
    const syncCompactChromeState = () => {
      const currentScrollTop = diffRoot?.scrollTop ?? 0;
      const visibleDiffHeight = diffRoot?.clientHeight ?? 0;
      const nextCompactState = resolveCompactChromeState(
        currentScrollTop,
        visibleDiffHeight,
      );

      if (nextCompactState === lastScrollCompactStateRef.current) {
        return;
      }

      lastScrollCompactStateRef.current = nextCompactState;
      onScrollStateChange(nextCompactState);
    };

    syncCompactChromeState();

    const resizeObserver =
      diffRoot !== null
        ? new ResizeObserver(() => syncCompactChromeState())
        : null;

    resizeObserver?.observe(diffRoot);

    return () => {
      resizeObserver?.disconnect();
    };
  }, [
    compactMinVisibleDiffHeight,
    compactReleaseVisibleDiffHeight,
    compactScrollReleaseThreshold,
    compactScrollThreshold,
    file.path,
    onScrollStateChange,
  ]);

  const syncCompactScrollState = (scrollTop: number) => {
    if (!onScrollStateChange) {
      return;
    }

    const visibleDiffHeight = diffScrollRef.current?.clientHeight ?? 0;
    const nextCompactState = resolveCompactChromeState(
      scrollTop,
      visibleDiffHeight,
    );
    if (nextCompactState === lastScrollCompactStateRef.current) {
      return;
    }

    if (scrollRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollRestoreFrameRef.current);
    }

    lastScrollCompactStateRef.current = nextCompactState;
    onScrollStateChange(nextCompactState);

    scrollRestoreFrameRef.current = window.requestAnimationFrame(() => {
      scrollRestoreFrameRef.current = null;

      const diffRoot = diffScrollRef.current;
      if (!diffRoot) {
        return;
      }

      if (Math.abs(diffRoot.scrollTop - scrollTop) > 1) {
        diffRoot.scrollTop = scrollTop;
      }
    });
  };

  const submitComment = (comment: {
    line: number;
    endLine?: number;
    startColumn?: number;
    endColumn?: number;
    category: ReviewCommentCategory;
    severity: ReviewCommentSeverity;
    body: string;
    snippet?: string;
  }) => {
    if (readOnly) {
      return;
    }

    onAddComment(comment);
    setComposer(null);
    setSelectedRange(null);
    setSelectedText(null);
    setRestorableComment(null);
    setFeedback({
      tone: "success",
      message: `Comment saved on ${describeLineRange(comment.line, comment.endLine)}.`,
    });
  };

  const handleSelectLine = (
    lineNumber: number,
    _anchor: { x: number; y: number },
    extend: boolean,
  ) => {
    if (readOnly) {
      return;
    }

    setComposer(null);
    setSelectedText(null);
    setSelectedRange((current) => {
      if (extend && current) {
        return {
          start: Math.min(current.start, lineNumber),
          end: Math.max(current.start, lineNumber),
        };
      }

      return { start: lineNumber, end: lineNumber };
    });
  };

  const handleCommentSelection = () => {
    if (readOnly || !selectedRange) {
      return;
    }

    setComposer({
      line: selectedRange.start,
      endLine: selectedRange.end,
      startColumn: selectedText?.startColumn,
      endColumn: selectedText?.endColumn,
      snippet: selectedText?.text,
      presetBody: undefined,
      source: "selection",
    });
    setFeedback(null);
  };

  const handleStartComment = (lineNumber: number) => {
    if (readOnly) {
      return;
    }

    setSelectedRange({ start: lineNumber, end: lineNumber });
    setSelectedText(null);
    setComposer({
      line: lineNumber,
      presetBody: undefined,
      source: "line",
    });
    setFeedback(null);
  };

  const handleCopyRawPatch = async () => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API unavailable in this browser context");
      }

      await navigator.clipboard.writeText(file.rawPatch);
      setRestorableComment(null);
      setFeedback({
        tone: "success",
        message: `Raw patch copied for ${basename}.`,
      });
    } catch (error) {
      setRestorableComment(null);
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not copy the raw patch.",
      });
    }
  };

  const handleDeleteComment = (comment: ReviewComment) => {
    if (readOnly) {
      return;
    }

    onDeleteComment(comment.id);
    setComposer(null);
    setRestorableComment({
      targetLabel: describeLineRange(comment.line, comment.endLine),
      payload: {
        line: comment.line,
        endLine: comment.endLine,
        startColumn: comment.startColumn,
        endColumn: comment.endColumn,
        category: comment.category,
        severity: comment.severity,
        body: comment.body,
        snippet: comment.snippet,
      },
    });
    setFeedback({
      tone: "info",
      message: `Comment deleted from ${describeLineRange(comment.line, comment.endLine)}.`,
    });
  };

  const restoreDeletedComment = () => {
    if (readOnly || !restorableComment) {
      return;
    }

    onAddComment(restorableComment.payload);
    setFeedback({
      tone: "success",
      message: `Comment restored on ${restorableComment.targetLabel}.`,
    });
    setRestorableComment(null);
  };

  useEffect(() => {
    const onMouseUp = () => {
      if (readOnly) {
        return;
      }

      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";
      if (!text || !selection || selection.rangeCount === 0) {
        return;
      }

      const range = selection.getRangeAt(0);
      const startNode = range.startContainer;
      const endNode = range.endContainer;
      if (!startNode || !endNode) {
        return;
      }

      const start = resolveLineNumber(startNode);
      const end = resolveLineNumber(endNode);
      if (!start || !end) {
        return;
      }

      setComposer(null);
      setSelectedRange({
        start: Math.min(start, end),
        end: Math.max(start, end),
      });
      setSelectedText({
        text: text.slice(0, 240),
        startColumn: resolveColumn(startNode, range.startOffset, "start"),
        endColumn: resolveColumn(endNode, range.endOffset, "end"),
      });
    };

    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [readOnly]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (composer) {
          setComposer(null);
          return;
        }

        if (selectedRange || selectedText) {
          setSelectedRange(null);
          setSelectedText(null);
          return;
        }

        if (isFullscreen) {
          setIsFullscreen(false);
        }

        return;
      }

      const activeElement = document.activeElement;
      const isTypingTarget =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement instanceof HTMLElement &&
          activeElement.isContentEditable);

      if (isTypingTarget || readOnly || !selectedRange) {
        return;
      }

      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        handleCommentSelection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    composer,
    handleCommentSelection,
    isFullscreen,
    readOnly,
    selectedRange,
    selectedText,
  ]);

  return (
    <section
      className={isFullscreen ? "viewer-panel is-fullscreen" : "viewer-panel"}
    >
      <div className="viewer-header">
        <div className="viewer-title-block">
          <div className="viewer-pathline">
            {dirname ? <span className="viewer-dir">{dirname}/</span> : null}
            <span className="viewer-file">{basename}</span>
          </div>
          <div className="viewer-stats">
            <span className={`change-badge status-${file.status}`}>
              {file.status}
            </span>
            {trackingBadges.map((badge) => (
              <span
                key={badge.key}
                className={`tracking-pill tracking-${badge.key}`}
              >
                {badge.label}
              </span>
            ))}
            {readOnly ? (
              <span className="viewer-readonly-badge">
                {readOnlyReason ?? "History view"}
              </span>
            ) : null}
            <span className="added">+{file.additions}</span>
            <span className="removed">-{file.deletions}</span>
            {file.oldPath ? (
              <span className="rename-pill">from {file.oldPath}</span>
            ) : null}
          </div>
        </div>

        <div className="viewer-toolbar">
          <div className="mode-switch">
            <button
              type="button"
              className={
                mode === "unified" ? "mode-button active" : "mode-button"
              }
              onClick={() => onModeChange("unified")}
            >
              <Rows3 size={13} /> Unified
            </button>
            <button
              type="button"
              className={
                mode === "side-by-side" ? "mode-button active" : "mode-button"
              }
              onClick={() => onModeChange("side-by-side")}
            >
              <Columns2 size={13} /> Split
            </button>
          </div>

          <button
            type="button"
            className="copy-button"
            aria-label={isFullscreen ? "Exit fullscreen" : "Open fullscreen"}
            onClick={() => setIsFullscreen((current) => !current)}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          <button
            type="button"
            className="copy-button"
            aria-label="Copy raw patch"
            onClick={() => void handleCopyRawPatch()}
          >
            <Copy size={13} />
          </button>
        </div>
      </div>

      {feedback ? (
        <div
          className={`viewer-feedback viewer-feedback-${feedback.tone}`}
          role="status"
          aria-live="polite"
        >
          <span>{feedback.message}</span>
          {restorableComment ? (
            <button
              type="button"
              className="ghost-button viewer-feedback-action"
              onClick={restoreDeletedComment}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className={composer ? "viewer-body is-composer-open" : "viewer-body"}
      >
        <div
          ref={diffScrollRef}
          className="diff-scroll"
          onScroll={(event) =>
            syncCompactScrollState(event.currentTarget.scrollTop)
          }
        >
          {selectedRange ? (
            <div className="selection-banner">
              <div className="selection-copy">
                <strong className="selection-label">
                  Selected{" "}
                  {describeLineRange(selectedRange.start, selectedRange.end)}
                </strong>
                {selectedText ? (
                  <span className="selection-snippet">{selectedText.text}</span>
                ) : (
                  <span className="selection-hint">
                    Shift-click another line to extend the range.
                  </span>
                )}
              </div>

              <div className="selection-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleCommentSelection}
                >
                  {selectedRange.end !== selectedRange.start
                    ? "Comment range"
                    : "Comment line"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setComposer(null);
                    setSelectedRange(null);
                    setSelectedText(null);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}

          {file.isBinary ? (
            <div className="binary-block">
              Binary change detected. DiffVision keeps the file in the review
              index, but textual hunks are not available.
            </div>
          ) : mode === "side-by-side" ? (
            <SideBySideView
              hunks={file.hunks}
              filePath={file.path}
              comments={comments}
              reviewLabels={reviewLabels}
              highlightedCommentId={highlightedCommentId}
              readOnly={readOnly}
              onAdd={handleStartComment}
              selectedRange={selectedRange}
              onSelectLine={handleSelectLine}
              onUpdateComment={onUpdateComment}
              onDeleteComment={handleDeleteComment}
            />
          ) : (
            <UnifiedView
              hunks={file.hunks}
              filePath={file.path}
              comments={comments}
              reviewLabels={reviewLabels}
              highlightedCommentId={highlightedCommentId}
              readOnly={readOnly}
              onAdd={handleStartComment}
              selectedRange={selectedRange}
              onSelectLine={handleSelectLine}
              onUpdateComment={onUpdateComment}
              onDeleteComment={handleDeleteComment}
            />
          )}
        </div>

        {composer ? (
          <aside className="viewer-side-panel" aria-label="Comment composer">
            <div className="viewer-side-panel-header">
              <div className="viewer-side-panel-copy">
                <span className="viewer-side-eyebrow">
                  {composer.source === "selection"
                    ? "Range comment"
                    : "Line comment"}
                </span>
                <h3>Draft a review note</h3>
                <p>Write the finding first. Classification stays optional.</p>
              </div>
              <button
                type="button"
                className="copy-button"
                aria-label="Close comment composer"
                onClick={() => setComposer(null)}
              >
                <X size={13} />
              </button>
            </div>

            <NewCommentForm
              line={composer.line}
              endLine={composer.endLine}
              startColumn={composer.startColumn}
              endColumn={composer.endColumn}
              snippet={composer.snippet}
              presetBody={composer.presetBody}
              onCancel={() => setComposer(null)}
              onSubmit={submitComment}
            />
          </aside>
        ) : null}
      </div>
    </section>
  );
}
