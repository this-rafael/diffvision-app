import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Activity,
  Command,
  FileText,
  LayoutPanelLeft,
  Palette,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import {
  appendReviewComment,
  createReviewComment,
  createNextReview,
  createReviewHistory,
  formatReviewLabel,
  nextReviewVersionNumber,
} from "../shared/reviews";
import type {
  DiffFile,
  DiffViewMode,
  ExportJsonResponse,
  ExportResponse,
  RepositorySnapshot,
  ReviewCommentCategory,
  ReviewCommentSeverity,
  ReviewExportSelection,
  ReviewHistory,
  ServerMessage,
} from "../shared/types";
import { fileTrackingFilters, type FileTrackingFilter } from "./fileTracking";
import { DiffViewer } from "./components/DiffViewer";
import { Overview } from "./components/Overview";
import { ReviewHistoryPanel } from "./components/ReviewHistoryPanel";
import { Sidebar } from "./components/Sidebar";
import {
  AiReviewMockFlow,
  type MockAiReviewProfile,
} from "./components/AiReviewMockFlow";
import { ThemeBootstrap } from "./components/ThemeBootstrap";
import {
  applyTheme,
  defaultThemeId,
  loadPersistedThemeId,
  resolveThemeId,
  saveTheme,
  themeGroups,
  type ThemeId,
} from "./theme";

const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);
const ExportPanel = lazy(() =>
  import("./components/ExportPanel").then((module) => ({
    default: module.ExportPanel,
  })),
);

const apiOrigin = import.meta.env.VITE_DIFFVISION_API_ORIGIN ?? "";
const apiUrl = (pathname: string) => `${apiOrigin}${pathname}`;

function wsUrl() {
  const origin = apiOrigin || window.location.origin;
  const target = new URL(origin);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  target.pathname = "/ws";
  return target.toString();
}

function useRepository() {
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [socketState, setSocketState] = useState<
    "connecting" | "live" | "offline"
  >("connecting");

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch(apiUrl("/api/repo"));
      if (!response.ok) {
        throw new Error("Failed to load repository snapshot");
      }

      const data = (await response.json()) as RepositorySnapshot;
      setSnapshot(data);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unexpected error",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const socket = new WebSocket(wsUrl());

    socket.addEventListener("open", () => setSocketState("live"));
    socket.addEventListener("close", () => setSocketState("offline"));
    socket.addEventListener("error", () => setSocketState("offline"));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.type === "snapshot:update") {
        void refresh();
      }
    });

    return () => socket.close();
  }, []);

  return { snapshot, loading, error, refresh, socketState };
}

function getInitialMode(snapshot: RepositorySnapshot | null): DiffViewMode {
  return snapshot?.config.defaultView ?? "side-by-side";
}

function shortcutLabel(key: string) {
  return navigator.platform.includes("Mac") ? `⌘${key}` : `Ctrl ${key}`;
}

interface WorkspaceUiState {
  sidebarQuery: string;
  sidebarFilter: FileTrackingFilter;
  bookmarks: string[];
  recentPaths: string[];
}

interface FocusRequest {
  filePath: string;
  line: number;
  commentId?: string;
  key: number;
}

const workspaceUiStorageKey = "diffvision:workspace-ui";
const aiReviewMockStorageKey = "diffvision:ai-review-mock";
const compactWorkspaceViewportHeight = 820;

function isMockAiReviewCard(
  value: unknown,
): value is MockAiReviewProfile["cards"][number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.summary === "string" &&
    typeof record.instructions === "string" &&
    typeof record.enabled === "boolean" &&
    (record.commentCategory === "bug" ||
      record.commentCategory === "refactor" ||
      record.commentCategory === "performance" ||
      record.commentCategory === "security" ||
      record.commentCategory === "readability" ||
      record.commentCategory === "suggestion")
  );
}

function isMockAiReviewProfile(value: unknown): value is MockAiReviewProfile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.bootstrapComplete === "boolean" &&
    typeof record.providerId === "string" &&
    typeof record.providerLabel === "string" &&
    typeof record.guideText === "string" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.cards) &&
    record.cards.every(isMockAiReviewCard) &&
    record.providerConfig !== null &&
    typeof record.providerConfig === "object"
  );
}

function loadAiReviewMockStore() {
  if (typeof window === "undefined") {
    return {} as Record<string, MockAiReviewProfile>;
  }

  try {
    const rawValue = window.localStorage.getItem(aiReviewMockStorageKey);
    if (!rawValue) {
      return {} as Record<string, MockAiReviewProfile>;
    }

    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, MockAiReviewProfile] =>
          isMockAiReviewProfile(entry[1]),
      ),
    );
  } catch {
    return {} as Record<string, MockAiReviewProfile>;
  }
}

function readAiReviewMockProfile(repoRoot?: string) {
  if (!repoRoot) {
    return null;
  }

  const store = loadAiReviewMockStore();
  return store[repoRoot] ?? null;
}

function writeAiReviewMockProfile(
  repoRoot: string,
  profile: MockAiReviewProfile | null,
) {
  if (typeof window === "undefined") {
    return;
  }

  const nextStore = loadAiReviewMockStore();
  if (profile) {
    nextStore[repoRoot] = profile;
  } else {
    delete nextStore[repoRoot];
  }

  window.localStorage.setItem(
    aiReviewMockStorageKey,
    JSON.stringify(nextStore),
  );
}

function isFileTrackingFilter(value: unknown): value is FileTrackingFilter {
  return fileTrackingFilters.includes(value as FileTrackingFilter);
}

function defaultWorkspaceUiState(): WorkspaceUiState {
  return {
    sidebarQuery: "",
    sidebarFilter: "all",
    bookmarks: [],
    recentPaths: [],
  };
}

function loadWorkspaceUiState(): WorkspaceUiState {
  if (typeof window === "undefined") {
    return defaultWorkspaceUiState();
  }

  try {
    const rawValue = window.localStorage.getItem(workspaceUiStorageKey);
    if (!rawValue) {
      return defaultWorkspaceUiState();
    }

    const parsed = JSON.parse(rawValue) as Partial<WorkspaceUiState>;
    return {
      sidebarQuery:
        typeof parsed.sidebarQuery === "string" ? parsed.sidebarQuery : "",
      sidebarFilter: isFileTrackingFilter(parsed.sidebarFilter)
        ? parsed.sidebarFilter
        : "all",
      bookmarks: Array.isArray(parsed.bookmarks)
        ? parsed.bookmarks.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      recentPaths: Array.isArray(parsed.recentPaths)
        ? parsed.recentPaths.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    };
  } catch {
    return defaultWorkspaceUiState();
  }
}

function readViewportHeight() {
  if (typeof window === "undefined") {
    return Number.POSITIVE_INFINITY;
  }

  return window.visualViewport?.height ?? window.innerHeight;
}

type VisibleReviewId = "all" | string;

function createEmptyReviewHistory() {
  return createReviewHistory([], new Date().toISOString());
}

function finalizeCurrentReview(
  history: ReviewHistory,
  title: string,
  notes: string,
  exportedAt = new Date().toISOString(),
) {
  const activeReview = history.reviews.find(
    (review) => review.id === history.activeReviewId,
  );
  if (!activeReview || activeReview.exportedAt) {
    return history;
  }

  const archivedHistory: ReviewHistory = {
    ...history,
    reviews: history.reviews.map((review) =>
      review.id === history.activeReviewId
        ? {
            ...review,
            exportedAt,
            lastExportTitle: title.trim() || undefined,
            lastExportNotes: notes.trim() || undefined,
          }
        : review,
    ),
  };

  return createNextReview(archivedHistory, exportedAt);
}

function loadInitialThemePreference() {
  const persistedThemeId = loadPersistedThemeId();
  return {
    themeId: persistedThemeId ?? defaultThemeId,
    hasStoredPreference: persistedThemeId !== null,
  };
}

export function App() {
  const { snapshot, loading, error, refresh, socketState } = useRepository();
  const [activePath, setActivePath] = useState("");
  const [themePreference, setThemePreference] = useState(
    loadInitialThemePreference,
  );
  const [mode, setMode] = useState<DiffViewMode>("side-by-side");
  const [isWorkspaceChromeScrollCompact, setIsWorkspaceChromeScrollCompact] =
    useState(false);
  const [
    isWorkspaceChromeViewportCompact,
    setIsWorkspaceChromeViewportCompact,
  ] = useState(() => readViewportHeight() <= compactWorkspaceViewportHeight);
  const [reviewHistory, setReviewHistory] = useState<ReviewHistory>(() =>
    createEmptyReviewHistory(),
  );
  const [historyReady, setHistoryReady] = useState(false);
  const [visibleReviewId, setVisibleReviewId] =
    useState<VisibleReviewId>("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResponse | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [workspaceUi, setWorkspaceUi] = useState<WorkspaceUiState>(() =>
    loadWorkspaceUiState(),
  );
  const [aiReviewOpen, setAiReviewOpen] = useState(false);
  const [mockAiReviewProfile, setMockAiReviewProfile] =
    useState<MockAiReviewProfile | null>(null);
  const [loadedAiReviewRepoRoot, setLoadedAiReviewRepoRoot] = useState<
    string | null
  >(null);

  const bookmarkedPaths = useMemo(
    () => new Set(workspaceUi.bookmarks),
    [workspaceUi.bookmarks],
  );

  const { themeId, hasStoredPreference } = themePreference;
  const isWorkspaceChromeCompact =
    isWorkspaceChromeViewportCompact || isWorkspaceChromeScrollCompact;

  const setThemeId = useCallback((nextThemeId: ThemeId) => {
    setThemePreference((current) => ({
      ...current,
      themeId: nextThemeId,
    }));
  }, []);

  const confirmThemeBootstrap = useCallback(() => {
    setThemePreference((current) => ({
      ...current,
      hasStoredPreference: true,
    }));
  }, []);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    setMode(getInitialMode(snapshot));
    setActivePath((current) => current || snapshot.files[0]?.path || "");
  }, [snapshot]);

  useEffect(() => {
    const loadComments = async () => {
      try {
        const response = await fetch(apiUrl("/api/comments"));
        if (!response.ok) {
          throw new Error("Failed to load comments");
        }

        const data = (await response.json()) as { history?: ReviewHistory };
        const nextHistory =
          data.history &&
          Array.isArray(data.history.reviews) &&
          Array.isArray(data.history.comments)
            ? data.history
            : createEmptyReviewHistory();
        setReviewHistory(nextHistory);
        setVisibleReviewId(nextHistory.activeReviewId);
      } catch {
        const fallbackHistory = createEmptyReviewHistory();
        setReviewHistory(fallbackHistory);
        setVisibleReviewId(fallbackHistory.activeReviewId);
      } finally {
        setHistoryReady(true);
      }
    };

    void loadComments();
  }, []);

  useEffect(() => {
    applyTheme(themeId);

    if (!hasStoredPreference) {
      return;
    }

    saveTheme(themeId);
  }, [themeId, hasStoredPreference]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      workspaceUiStorageKey,
      JSON.stringify(workspaceUi),
    );
  }, [workspaceUi]);

  useEffect(() => {
    const nextRepoRoot = snapshot?.repoRoot ?? null;
    setMockAiReviewProfile(readAiReviewMockProfile(nextRepoRoot ?? undefined));
    setLoadedAiReviewRepoRoot(nextRepoRoot);
    setAiReviewOpen(false);
  }, [snapshot?.repoRoot]);

  useEffect(() => {
    if (!snapshot?.repoRoot || loadedAiReviewRepoRoot !== snapshot.repoRoot) {
      return;
    }

    writeAiReviewMockProfile(snapshot.repoRoot, mockAiReviewProfile);
  }, [loadedAiReviewRepoRoot, mockAiReviewProfile, snapshot?.repoRoot]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncViewportCompactState = () => {
      setIsWorkspaceChromeViewportCompact(
        readViewportHeight() <= compactWorkspaceViewportHeight,
      );
    };

    syncViewportCompactState();

    window.addEventListener("resize", syncViewportCompactState);
    window.visualViewport?.addEventListener("resize", syncViewportCompactState);

    return () => {
      window.removeEventListener("resize", syncViewportCompactState);
      window.visualViewport?.removeEventListener(
        "resize",
        syncViewportCompactState,
      );
    };
  }, []);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const validPaths = new Set(snapshot.files.map((file) => file.path));
    setWorkspaceUi((current) => {
      const nextBookmarks = current.bookmarks.filter((path) =>
        validPaths.has(path),
      );
      const nextRecentPaths = current.recentPaths.filter((path) =>
        validPaths.has(path),
      );

      if (
        nextBookmarks.length === current.bookmarks.length &&
        nextRecentPaths.length === current.recentPaths.length
      ) {
        return current;
      }

      return {
        ...current,
        bookmarks: nextBookmarks,
        recentPaths: nextRecentPaths,
      };
    });
  }, [snapshot]);

  useEffect(() => {
    if (!activePath) {
      return;
    }

    setWorkspaceUi((current) => {
      const nextRecentPaths = [
        activePath,
        ...current.recentPaths.filter((path) => path !== activePath),
      ].slice(0, 10);

      if (
        nextRecentPaths.length === current.recentPaths.length &&
        nextRecentPaths.every(
          (value, index) => value === current.recentPaths[index],
        )
      ) {
        return current;
      }

      return {
        ...current,
        recentPaths: nextRecentPaths,
      };
    });
  }, [activePath]);

  useEffect(() => {
    if (!historyReady) {
      return;
    }

    const saveComments = async () => {
      await fetch(apiUrl("/api/comments"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: reviewHistory }),
      });
    };

    void saveComments();
  }, [reviewHistory, historyReady]);

  useEffect(() => {
    if (
      visibleReviewId !== "all" &&
      !reviewHistory.reviews.some((review) => review.id === visibleReviewId)
    ) {
      setVisibleReviewId(reviewHistory.activeReviewId);
    }
  }, [reviewHistory, visibleReviewId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (exportOpen) {
          event.preventDefault();
          setExportOpen(false);
          return;
        }

        if (paletteOpen) {
          event.preventDefault();
          setPaletteOpen(false);
        }

        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setExportOpen((value) => !value);
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refresh();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportOpen, paletteOpen, refresh]);

  const activeFile = useMemo<DiffFile | null>(() => {
    if (!snapshot) {
      return null;
    }

    return (
      snapshot.files.find((file) => file.path === activePath) ??
      snapshot.files[0] ??
      null
    );
  }, [activePath, snapshot]);

  const exportReport = async (
    notes: string,
    title: string,
    selection: ReviewExportSelection,
  ) => {
    const response = await fetch(apiUrl("/api/export"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notes,
        title,
        comments: reviewHistory.comments,
        reviews: reviewHistory.reviews,
        activeReviewId: reviewHistory.activeReviewId,
        selection,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to export review report");
    }

    const data = (await response.json()) as ExportResponse;
    setExportResult(data);

    if (selection.scope === "current") {
      const currentReviewId = reviewHistory.activeReviewId;
      const nextReviewId = `review-${nextReviewVersionNumber(reviewHistory.reviews)}`;
      setReviewHistory((previous) =>
        finalizeCurrentReview(previous, title, notes),
      );
      if (visibleReviewId === currentReviewId) {
        setVisibleReviewId(nextReviewId);
      }
    }

    return data;
  };

  const copyReportToClipboard = async (
    notes: string,
    title: string,
    selection: ReviewExportSelection,
  ) => {
    if (!navigator.clipboard) {
      throw new Error("Clipboard API unavailable in this browser context");
    }

    const response = await fetch(apiUrl("/api/export/review-json"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notes,
        title,
        comments: reviewHistory.comments,
        reviews: reviewHistory.reviews,
        activeReviewId: reviewHistory.activeReviewId,
        selection,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to generate review JSON for clipboard");
    }

    const data = (await response.json()) as ExportJsonResponse;
    await navigator.clipboard.writeText(data.json);

    if (selection.scope === "current") {
      const currentReviewId = reviewHistory.activeReviewId;
      const nextReviewId = `review-${nextReviewVersionNumber(reviewHistory.reviews)}`;
      setReviewHistory((previous) =>
        finalizeCurrentReview(previous, title, notes),
      );
      if (visibleReviewId === currentReviewId) {
        setVisibleReviewId(nextReviewId);
      }
    }
  };

  const addComment = (next: {
    line: number;
    endLine?: number;
    startColumn?: number;
    endColumn?: number;
    category: ReviewCommentCategory;
    severity: ReviewCommentSeverity;
    body: string;
    snippet?: string;
  }) => {
    if (!activeFile) {
      return;
    }

    if (visibleReviewId !== reviewHistory.activeReviewId) {
      return;
    }

    setReviewHistory((previous) =>
      appendReviewComment(previous, {
        filePath: activeFile.path,
        line: next.line,
        endLine: next.endLine,
        startColumn: next.startColumn,
        endColumn: next.endColumn,
        category: next.category,
        severity: next.severity,
        body: next.body,
        snippet: next.snippet,
        author: "you",
        when: "just now",
      }),
    );
  };

  const reviewCommentCounts = useMemo(() => {
    return reviewHistory.comments.reduce<Record<string, number>>(
      (current, comment) => {
        current[comment.reviewId] = (current[comment.reviewId] ?? 0) + 1;
        return current;
      },
      {},
    );
  }, [reviewHistory.comments]);

  const reviewLabels = useMemo(
    () =>
      Object.fromEntries(
        reviewHistory.reviews.map((review) => [
          review.id,
          formatReviewLabel(review),
        ]),
      ),
    [reviewHistory.reviews],
  );

  const visibleComments = useMemo(() => {
    if (visibleReviewId === "all") {
      return reviewHistory.comments;
    }

    return reviewHistory.comments.filter(
      (comment) => comment.reviewId === visibleReviewId,
    );
  }, [reviewHistory.comments, visibleReviewId]);

  const activeFileComments = useMemo(() => {
    if (!activeFile) {
      return [];
    }

    return visibleComments.filter(
      (comment) => comment.filePath === activeFile.path,
    );
  }, [activeFile, visibleComments]);

  const overviewWorkspaceMetrics = useMemo(() => {
    const targetComments =
      visibleReviewId === "all"
        ? reviewHistory.comments
        : reviewHistory.comments.filter(
            (comment) => comment.reviewId === visibleReviewId,
          );

    return {
      commentedFiles: new Set(targetComments.map((comment) => comment.filePath))
        .size,
      highSeverityFindings: targetComments.filter(
        (comment) =>
          comment.severity === "major" || comment.severity === "critical",
      ).length,
      bookmarks: workspaceUi.bookmarks.length,
    };
  }, [reviewHistory.comments, visibleReviewId, workspaceUi.bookmarks.length]);

  const jumpToComment = useCallback(
    (commentId: string) => {
      const targetComment = reviewHistory.comments.find(
        (comment) => comment.id === commentId,
      );

      if (!targetComment) {
        return;
      }

      setVisibleReviewId(targetComment.reviewId);
      setActivePath(targetComment.filePath);
      setFocusRequest({
        filePath: targetComment.filePath,
        line: targetComment.line,
        commentId: targetComment.id,
        key: Date.now(),
      });
      setPaletteOpen(false);
    },
    [reviewHistory.comments],
  );

  const jumpToFile = useCallback((filePath: string) => {
    setActivePath(filePath);
    setPaletteOpen(false);
  }, []);

  const toggleBookmark = useCallback((path: string) => {
    setWorkspaceUi((current) => {
      const nextBookmarks = new Set(current.bookmarks);
      if (nextBookmarks.has(path)) {
        nextBookmarks.delete(path);
      } else {
        nextBookmarks.add(path);
      }

      return {
        ...current,
        bookmarks: [...nextBookmarks],
      };
    });
  }, []);

  const completeMockAiReview = useCallback(
    (payload: {
      profile: MockAiReviewProfile;
      comments: Array<{
        filePath: string;
        line: number;
        endLine?: number;
        category: ReviewCommentCategory;
        severity: ReviewCommentSeverity;
        body: string;
        snippet?: string;
      }>;
    }) => {
      const activeReviewId = reviewHistory.activeReviewId;
      const nextComments = payload.comments.map((comment) =>
        createReviewComment(
          {
            filePath: comment.filePath,
            line: comment.line,
            endLine: comment.endLine,
            category: comment.category,
            severity: comment.severity,
            body: comment.body,
            snippet: comment.snippet,
            author: `ai:${payload.profile.providerId}`,
            when: "mock preview",
          },
          activeReviewId,
        ),
      );

      setMockAiReviewProfile(payload.profile);
      if (nextComments.length) {
        const firstComment = nextComments[0];
        setReviewHistory((previous) => ({
          ...previous,
          comments: [...previous.comments, ...nextComments],
        }));
        setVisibleReviewId(activeReviewId);
        setActivePath(firstComment.filePath);
        setFocusRequest({
          filePath: firstComment.filePath,
          line: firstComment.line,
          commentId: firstComment.id,
          key: Date.now(),
        });
      }

      setAiReviewOpen(false);
    },
    [reviewHistory.activeReviewId],
  );

  const isReadOnlyReview = visibleReviewId !== reviewHistory.activeReviewId;
  const selectedReviewSummary = useMemo(() => {
    if (visibleReviewId === "all") {
      return {
        label: "General",
        status: "all reviews",
        commentCount: reviewHistory.comments.length,
        totalReviews: reviewHistory.reviews.length,
      };
    }

    const selectedReview = reviewHistory.reviews.find(
      (review) => review.id === visibleReviewId,
    );
    const selectedReviewStatus = !selectedReview
      ? "review"
      : selectedReview.id === reviewHistory.activeReviewId &&
          !selectedReview.exportedAt
        ? "current draft"
        : selectedReview.exportedAt
          ? "exported"
          : "draft";

    return {
      label: reviewLabels[visibleReviewId] ?? "Review",
      status: selectedReviewStatus,
      commentCount: reviewCommentCounts[visibleReviewId] ?? 0,
      totalReviews: reviewHistory.reviews.length,
    };
  }, [
    reviewHistory.activeReviewId,
    reviewHistory.comments.length,
    reviewHistory.reviews,
    reviewCommentCounts,
    reviewLabels,
    visibleReviewId,
  ]);
  const readOnlyReason =
    visibleReviewId === "all"
      ? "General view aggregates every exported review and stays read-only."
      : `${reviewLabels[visibleReviewId] ?? "This review"} is archived and read-only.`;

  useEffect(() => {
    if (!activeFile) {
      setIsWorkspaceChromeScrollCompact(false);
    }
  }, [activeFile]);

  const updateComment = (
    commentId: string,
    patch: {
      line?: number;
      endLine?: number;
      category?: ReviewCommentCategory;
      severity?: ReviewCommentSeverity;
      body?: string;
    },
  ) => {
    if (visibleReviewId !== reviewHistory.activeReviewId) {
      return;
    }

    setReviewHistory((previous) => ({
      ...previous,
      comments: previous.comments.map((comment) =>
        comment.id === commentId
          ? (() => {
              const hasLine = typeof patch.line === "number";
              const hasEndLine = Object.prototype.hasOwnProperty.call(
                patch,
                "endLine",
              );
              const nextLine = hasLine
                ? Math.max(1, Math.floor(patch.line as number))
                : comment.line;
              const nextEndLine = hasEndLine
                ? typeof patch.endLine === "number"
                  ? Math.max(nextLine, Math.floor(patch.endLine))
                  : undefined
                : comment.endLine;

              return {
                ...comment,
                ...patch,
                line: nextLine,
                endLine: nextEndLine,
                when: "just now",
              };
            })()
          : comment,
      ),
    }));
  };

  const deleteComment = (commentId: string) => {
    if (visibleReviewId !== reviewHistory.activeReviewId) {
      return;
    }

    setReviewHistory((previous) => ({
      ...previous,
      comments: previous.comments.filter((comment) => comment.id !== commentId),
    }));
  };

  if (!hasStoredPreference) {
    return (
      <ThemeBootstrap
        themeId={themeId}
        loading={loading && !snapshot}
        error={error}
        onSelectTheme={setThemeId}
        onContinue={confirmThemeBootstrap}
        onRetry={() => void refresh()}
      />
    );
  }

  return (
    <div className="app-shell">
      {/* ── Topbar ── */}
      <header className="topbar">
        <div className="traffic-lights" aria-hidden="true">
          <span className="traffic-dot red" />
          <span className="traffic-dot amber" />
          <span className="traffic-dot green" />
        </div>
        <span className="repo-path">
          {snapshot?.repoRoot ?? "waiting for repository"}
        </span>

        <div className="topbar-center">
          <button
            className="command-launcher"
            onClick={() => setPaletteOpen(true)}
          >
            <Command size={12} />
            <span>Search files, comments, bookmarks and commands…</span>
            <kbd>{shortcutLabel("K")}</kbd>
          </button>
        </div>

        <div className="topbar-actions">
          <label className="theme-picker">
            <Palette size={12} />
            <span>Theme</span>
            <select
              className="theme-picker-select"
              value={themeId}
              onChange={(event) =>
                setThemeId(resolveThemeId(event.target.value))
              }
              aria-label="Select theme"
            >
              {themeGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.themes.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <button
            className={
              mockAiReviewProfile?.bootstrapComplete
                ? "export-button ai-review-launcher"
                : "export-button ai-review-launcher needs-setup"
            }
            onClick={() => setAiReviewOpen(true)}
            aria-label="Open mocked AI review flow"
          >
            <Sparkles size={12} />
            <span>
              {mockAiReviewProfile?.bootstrapComplete
                ? "AI review"
                : "Setup AI review"}
            </span>
          </button>

          <button
            className="export-button"
            onClick={() => setExportOpen(true)}
            aria-label="Open export panel"
          >
            <FileText size={12} />
            <span>Export review</span>
            <kbd>{shortcutLabel("E")}</kbd>
          </button>

          <span className={`status-indicator ${socketState}`}>
            <Activity size={12} />
            <span>{socketState === "live" ? "ready" : socketState}</span>
          </span>

          <button
            className="icon-button"
            onClick={() => void refresh()}
            aria-label="Refresh snapshot"
          >
            <RefreshCcw size={13} />
          </button>
        </div>
      </header>

      {/* ── Content ── */}
      {error ? (
        <div className="workspace-grid">
          <main className="workspace-main state-panel">
            <h2>Repository snapshot unavailable</h2>
            <p>{error}</p>
            <button className="primary-button" onClick={() => void refresh()}>
              Retry
            </button>
          </main>
        </div>
      ) : loading && !snapshot ? (
        <div className="workspace-grid">
          <main className="workspace-main state-panel">
            <Activity className="spin" size={20} />
            <h2>Loading real Git data</h2>
            <p>
              DiffVision is reading the active repository, branch and patch
              stream.
            </p>
          </main>
        </div>
      ) : snapshot ? (
        <div className="workspace-grid">
          <Sidebar
            files={snapshot.files}
            activePath={activeFile?.path ?? ""}
            branch={snapshot.branch}
            repoRoot={snapshot.repoRoot}
            query={workspaceUi.sidebarQuery}
            filter={workspaceUi.sidebarFilter}
            bookmarks={bookmarkedPaths}
            shortcutLabel={shortcutLabel("P")}
            onQueryChange={(query) =>
              setWorkspaceUi((current) => ({
                ...current,
                sidebarQuery: query,
              }))
            }
            onFilterChange={(filter) =>
              setWorkspaceUi((current) => ({
                ...current,
                sidebarFilter: filter,
              }))
            }
            onToggleBookmark={toggleBookmark}
            onSelect={jumpToFile}
          />

          <main className="workspace-main">
            <div
              className={
                isWorkspaceChromeCompact
                  ? "workspace-chrome workspace-chrome-compact"
                  : "workspace-chrome"
              }
            >
              <Overview
                snapshot={snapshot}
                compact={isWorkspaceChromeCompact}
                reviewSummary={selectedReviewSummary}
                workspaceMetrics={overviewWorkspaceMetrics}
              />
              <ReviewHistoryPanel
                reviews={reviewHistory.reviews}
                activeReviewId={reviewHistory.activeReviewId}
                selectedReviewId={visibleReviewId}
                reviewCommentCounts={reviewCommentCounts}
                compact={isWorkspaceChromeCompact}
                onSelect={setVisibleReviewId}
              />
            </div>
            {activeFile ? (
              <DiffViewer
                file={activeFile}
                mode={mode}
                comments={activeFileComments}
                reviewLabels={reviewLabels}
                focusRequest={focusRequest}
                readOnly={isReadOnlyReview}
                readOnlyReason={readOnlyReason}
                onScrollStateChange={setIsWorkspaceChromeScrollCompact}
                onModeChange={setMode}
                onAddComment={addComment}
                onUpdateComment={updateComment}
                onDeleteComment={deleteComment}
              />
            ) : (
              <div className="state-panel">
                <LayoutPanelLeft size={18} />
                <h2>No changed files</h2>
                <p>
                  The repository is clean. DiffVision will update automatically
                  when the working tree changes.
                </p>
              </div>
            )}
          </main>
        </div>
      ) : null}

      <Suspense fallback={null}>
        <CommandPalette
          open={paletteOpen}
          files={snapshot?.files ?? []}
          activePath={activePath}
          comments={reviewHistory.comments}
          reviewLabels={reviewLabels}
          bookmarks={bookmarkedPaths}
          recentPaths={workspaceUi.recentPaths}
          onClose={() => setPaletteOpen(false)}
          onSelect={jumpToFile}
          onSelectComment={jumpToComment}
          onRefresh={() => void refresh()}
          onToggleMode={() =>
            setMode((current) =>
              current === "unified" ? "side-by-side" : "unified",
            )
          }
          onExport={() => setExportOpen(true)}
        />
        <ExportPanel
          open={exportOpen}
          exportResult={exportResult}
          reviews={reviewHistory.reviews}
          activeReviewId={reviewHistory.activeReviewId}
          currentCommentCount={
            reviewCommentCounts[reviewHistory.activeReviewId] ?? 0
          }
          totalCommentCount={reviewHistory.comments.length}
          reviewCommentCounts={reviewCommentCounts}
          onClose={() => setExportOpen(false)}
          onExport={exportReport}
          onCopyToClipboard={copyReportToClipboard}
        />
      </Suspense>

      <AiReviewMockFlow
        open={aiReviewOpen}
        snapshot={snapshot}
        profile={mockAiReviewProfile}
        onClose={() => setAiReviewOpen(false)}
        onSaveProfile={setMockAiReviewProfile}
        onCompleteReview={completeMockAiReview}
      />
    </div>
  );
}
