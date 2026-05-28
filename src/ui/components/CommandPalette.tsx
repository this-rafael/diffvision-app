import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  Clock3,
  Download,
  FileCode2,
  MessageSquare,
  RefreshCcw,
  Rows3,
  Search,
  type LucideIcon,
} from "lucide-react";
import type { DiffFile, ReviewComment } from "../../shared/types";

interface CommandPaletteProps {
  open: boolean;
  files: DiffFile[];
  activePath: string;
  comments: ReviewComment[];
  reviewLabels?: Record<string, string>;
  bookmarks: Set<string>;
  recentPaths: string[];
  onClose: () => void;
  onSelect: (filePath: string) => void;
  onSelectComment: (commentId: string) => void;
  onRefresh: () => void;
  onToggleMode: () => void;
  onExport: () => void;
}

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  meta?: string;
  icon: LucideIcon;
  tone?: "comment" | "bookmark" | "recent";
  searchableText: string;
  onSelect: () => void;
}

function matchesTokens(query: string, values: string[]) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (!tokens.length) {
    return true;
  }

  const haystack = values.join(" ").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function commentSeverityRank(severity: ReviewComment["severity"]) {
  switch (severity) {
    case "critical":
      return 4;
    case "major":
      return 3;
    case "minor":
      return 2;
    default:
      return 1;
  }
}

export function CommandPalette({
  open,
  files,
  activePath,
  comments,
  reviewLabels,
  bookmarks,
  recentPaths,
  onClose,
  onSelect,
  onSelectComment,
  onRefresh,
  onToggleMode,
  onExport,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveItemId(null);
    }
  }, [open]);

  const sections = useMemo(() => {
    const actionItems: PaletteItem[] = [
      {
        id: "action-refresh",
        label: "Refresh repository",
        description: "Fetch a fresh snapshot from the active repository.",
        icon: RefreshCcw,
        searchableText: "refresh repository snapshot reload",
        onSelect: () => {
          onRefresh();
          onClose();
        },
      },
      {
        id: "action-toggle-mode",
        label: "Toggle diff mode",
        description: "Swap between unified and split diff layouts.",
        icon: Rows3,
        searchableText: "toggle diff mode split unified layout",
        onSelect: () => {
          onToggleMode();
          onClose();
        },
      },
      {
        id: "action-export",
        label: "Open export panel",
        description: "Package the current review into Markdown or JSON.",
        icon: Download,
        searchableText: "open export panel markdown json report",
        onSelect: () => {
          onExport();
          onClose();
        },
      },
    ];

    const fileByPath = new Map(files.map((file) => [file.path, file]));

    const commentItems = [...comments]
      .sort(
        (left, right) =>
          commentSeverityRank(right.severity) -
            commentSeverityRank(left.severity) ||
          left.filePath.localeCompare(right.filePath) ||
          left.line - right.line,
      )
      .slice(0, 12)
      .map<PaletteItem>((comment) => ({
        id: `comment-${comment.id}`,
        label: `${comment.filePath}:${comment.line}`,
        description: comment.body,
        meta: `${reviewLabels?.[comment.reviewId] ?? "Review"} · ${comment.category} · ${comment.severity}`,
        icon: MessageSquare,
        tone: "comment",
        searchableText: `${comment.filePath} ${comment.line} ${comment.body} ${comment.category} ${comment.severity} ${reviewLabels?.[comment.reviewId] ?? "review"}`,
        onSelect: () => onSelectComment(comment.id),
      }));

    const bookmarkItems = files
      .filter((file) => bookmarks.has(file.path))
      .map<PaletteItem>((file) => ({
        id: `bookmark-${file.path}`,
        label: file.path,
        description: `Bookmarked file · +${file.additions} -${file.deletions}`,
        meta: file.path === activePath ? "Current file" : undefined,
        icon: Bookmark,
        tone: "bookmark",
        searchableText: `${file.path} bookmarked favorite`,
        onSelect: () => onSelect(file.path),
      }));

    const recentItems = recentPaths
      .map((path) => fileByPath.get(path))
      .filter((file): file is DiffFile => Boolean(file))
      .map<PaletteItem>((file) => ({
        id: `recent-${file.path}`,
        label: file.path,
        description: `Recent file · +${file.additions} -${file.deletions}`,
        meta: file.path === activePath ? "Current file" : undefined,
        icon: Clock3,
        tone: "recent",
        searchableText: `${file.path} recent latest`,
        onSelect: () => onSelect(file.path),
      }));

    const fileItems = files.map<PaletteItem>((file) => ({
      id: `file-${file.path}`,
      label: file.path,
      description: `${file.status} · +${file.additions} -${file.deletions}`,
      meta: file.path === activePath ? "Current file" : undefined,
      icon: FileCode2,
      searchableText: `${file.path} ${file.status} ${file.additions} ${file.deletions}`,
      onSelect: () => onSelect(file.path),
    }));

    return [
      { label: "Actions", items: actionItems },
      { label: "Comment jumps", items: commentItems },
      { label: "Bookmarked files", items: bookmarkItems },
      { label: "Recent files", items: recentItems },
      { label: "Files", items: fileItems },
    ]
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          matchesTokens(query, [
            item.label,
            item.description,
            item.meta ?? "",
            item.searchableText,
          ]),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [
    activePath,
    bookmarks,
    comments,
    files,
    onClose,
    onExport,
    onRefresh,
    onSelect,
    onSelectComment,
    onToggleMode,
    query,
    recentPaths,
    reviewLabels,
  ]);

  const flatItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );

  useEffect(() => {
    if (!flatItems.length) {
      setActiveItemId(null);
      return;
    }

    setActiveItemId((current) => {
      if (current && flatItems.some((item) => item.id === current)) {
        return current;
      }

      return flatItems[0].id;
    });
  }, [flatItems]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (!flatItems.length) {
        return;
      }

      const currentIndex = Math.max(
        0,
        flatItems.findIndex((item) => item.id === activeItemId),
      );

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveItemId(flatItems[(currentIndex + 1) % flatItems.length].id);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveItemId(
          flatItems[(currentIndex - 1 + flatItems.length) % flatItems.length]
            .id,
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        flatItems[currentIndex]?.onSelect();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeItemId, flatItems, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="palette glass-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <label className="palette-search">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files, comments or commands"
          />
        </label>

        {sections.length ? (
          sections.map((section) => (
            <div key={section.label} className="palette-section">
              <div className="palette-section-header">
                <div className="palette-caption">{section.label}</div>
                <span className="palette-caption-count">
                  {section.items.length}
                </span>
              </div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const toneClass = item.tone ? `palette-item-${item.tone}` : "";
                const activeClass = activeItemId === item.id ? "is-active" : "";

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`palette-item ${toneClass} ${activeClass}`.trim()}
                    onMouseEnter={() => setActiveItemId(item.id)}
                    onClick={() => item.onSelect()}
                  >
                    <Icon size={14} />
                    <span className="palette-item-copy">
                      <span className="palette-item-label">{item.label}</span>
                      <span className="palette-item-description">
                        {item.description}
                      </span>
                    </span>
                    {item.meta ? (
                      <span className="palette-item-meta">{item.meta}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        ) : (
          <div className="palette-empty">
            <strong>No matches</strong>
            <span>
              Try a file path, comment text, severity or command name.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
