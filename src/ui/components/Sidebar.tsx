import { useMemo, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus2,
  FileX2,
  Filter,
  GitBranch,
  Search,
} from "lucide-react";
import packageMetadata from "../../../package.json";
import type { DiffFile } from "../../shared/types";
import {
  fileTrackingFilters,
  getTrackingBadges,
  matchesFileFilter,
  type FileTrackingFilter,
} from "../fileTracking";

interface SidebarProps {
  files: DiffFile[];
  activePath: string;
  branch: string;
  repoRoot: string;
  query: string;
  filter: FileTrackingFilter;
  bookmarks: Set<string>;
  shortcutLabel: string;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: FileTrackingFilter) => void;
  onToggleBookmark: (path: string) => void;
  onSelect: (path: string) => void;
}

interface TreeNodeData {
  name: string;
  path: string;
  file?: DiffFile;
  children?: TreeNodeData[];
}

function statusIcon(status: DiffFile["status"]) {
  switch (status) {
    case "added":
    case "untracked":
      return <FilePlus2 size={13} />;
    case "deleted":
      return <FileX2 size={13} />;
    default:
      return <FileCode2 size={13} />;
  }
}

function buildTree(files: DiffFile[]) {
  const root: TreeNodeData = { name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    parts.forEach((part, index) => {
      const nextPath = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      current.children ??= [];
      let node = current.children.find((c) => c.name === part);
      if (!node) {
        node = {
          name: part,
          path: nextPath,
          children: isFile ? undefined : [],
        };
        current.children.push(node);
      }
      if (isFile) node.file = file;
      current = node;
    });
  }
  return root;
}

function TreeNode({
  node,
  depth,
  activePath,
  bookmarks,
  onSelect,
  onToggleBookmark,
}: {
  node: TreeNodeData;
  depth: number;
  activePath: string;
  bookmarks: Set<string>;
  onSelect: (path: string) => void;
  onToggleBookmark: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.file) {
    const f = node.file;
    const trackingBadges = getTrackingBadges(f);

    return (
      <div
        role="button"
        tabIndex={0}
        className={f.path === activePath ? "file-row active" : "file-row"}
        onClick={() => onSelect(f.path)}
        onKeyDown={(e) => e.key === "Enter" && onSelect(f.path)}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        <span className={`file-icon status-${f.status}`}>
          {statusIcon(f.status)}
        </span>
        <div className="file-meta">
          <span className="file-name">{node.name}</span>
          {trackingBadges.length ? (
            <span className="file-tracking-badges">
              {trackingBadges.map((badge) => (
                <span
                  key={badge.key}
                  className={`tracking-pill tracking-${badge.key}`}
                >
                  {badge.label}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        <span className="file-counts">
          <span className="added">+{f.additions}</span>
          <span className="removed">-{f.deletions}</span>
        </span>
        <button
          type="button"
          className={`bookmark-btn ${bookmarks.has(f.path) ? "bookmarked" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleBookmark(f.path);
          }}
          aria-label="Bookmark file"
        >
          <Bookmark size={11} />
        </button>
      </div>
    );
  }

  return (
    <div className="tree-block">
      {node.name ? (
        <button
          type="button"
          className="folder-row"
          onClick={() => setOpen((c) => !c)}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{node.name}</span>
        </button>
      ) : null}
      {open &&
        node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={node.name ? depth + 1 : depth}
            activePath={activePath}
            bookmarks={bookmarks}
            onSelect={onSelect}
            onToggleBookmark={onToggleBookmark}
          />
        ))}
    </div>
  );
}

export function Sidebar({
  files,
  activePath,
  branch,
  repoRoot,
  query,
  filter,
  bookmarks,
  shortcutLabel,
  onQueryChange,
  onFilterChange,
  onToggleBookmark,
  onSelect,
}: SidebarProps) {
  const filtered = useMemo(
    () =>
      files.filter((file) => {
        if (filter === "bookmarked") return bookmarks.has(file.path);
        if (!matchesFileFilter(file, filter)) return false;
        if (query && !file.path.toLowerCase().includes(query.toLowerCase()))
          return false;
        return true;
      }),
    [bookmarks, files, filter, query],
  );

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const filterSummary =
    filter === "all"
      ? `Showing ${filtered.length} of ${files.length} files`
      : `Showing ${filtered.length} ${filter} files`;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">
          <GitBranch size={16} />
        </div>
        <div className="brand-lockup">
          <div className="brand-title">DiffVision</div>
          <div className="brand-subtitle">
            v{packageMetadata.version} · {repoRoot.split(/[/\\]/).pop() ?? "local"}
          </div>
        </div>
      </div>

      <div className="search-box">
        <Search size={12} className="search-icon" />
        <input
          className="search-box-inner"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Find file…"
        />
        <kbd className="search-kbd">{shortcutLabel}</kbd>
      </div>

      <div className="filter-row">
        <Filter size={11} className="filter-icon" />
        {fileTrackingFilters.map((option) => (
          <button
            key={option}
            type="button"
            className={filter === option ? "filter-pill active" : "filter-pill"}
            onClick={() => onFilterChange(option)}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="sidebar-summary" aria-live="polite">
        <span>{filterSummary}</span>
        <div className="sidebar-summary-chips">
          {filter !== "all" ? (
            <span className="sidebar-summary-chip">filter: {filter}</span>
          ) : null}
          {bookmarks.size ? (
            <span className="sidebar-summary-chip">
              {bookmarks.size} bookmarked
            </span>
          ) : null}
        </div>
      </div>

      <div className="file-tree">
        {filtered.length ? (
          <TreeNode
            node={tree}
            depth={0}
            activePath={activePath}
            bookmarks={bookmarks}
            onSelect={onSelect}
            onToggleBookmark={onToggleBookmark}
          />
        ) : (
          <div className="sidebar-empty">
            <strong>No files match the current filters</strong>
            <span>
              Clear the search or switch filters to widen the review set.
            </span>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <div className="footer-label">Active branch</div>
        <div className="footer-branch">
          <span className="branch-dot" />
          <span>{branch}</span>
        </div>
      </div>
    </aside>
  );
}
