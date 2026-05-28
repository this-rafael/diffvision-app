import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseDiffNameStatus,
  parseStatusPorcelain,
  parseUnifiedDiff,
} from "../src/lib/diff";
import {
  createMarkdownReport,
  loadRepositorySnapshot,
  createReviewJsonPayload,
} from "../src/lib/repository";
import { runGit } from "../src/lib/process";
import { ensureStorage, readReviewHistory } from "../src/lib/storage";
import { getTrackingBadges, matchesFileFilter } from "../src/ui/fileTracking";
import type { RepositorySnapshot } from "../src/shared/types";

describe("parseStatusPorcelain", () => {
  it("parses mixed repository status output", () => {
    const result = parseStatusPorcelain(
      [
        "## main...origin/main [ahead 2]",
        " M src/app.ts",
        "A  src/new.ts",
        "R  src/old.ts -> src/renamed.ts",
        "?? notes.md",
      ].join("\n"),
    );

    expect(result).toEqual([
      expect.objectContaining({ path: "src/app.ts", status: "modified" }),
      expect.objectContaining({ path: "src/new.ts", status: "added" }),
      expect.objectContaining({
        path: "src/renamed.ts",
        oldPath: "src/old.ts",
        status: "renamed",
      }),
      expect.objectContaining({ path: "notes.md", status: "untracked" }),
    ]);
  });
});

describe("parseUnifiedDiff", () => {
  it("builds real diff lines from unified patches", () => {
    const files = parseUnifiedDiff(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,2 +1,2 @@",
        "-console.log('old')",
        "+console.log('new')",
        " export {};",
      ].join("\n"),
      [
        {
          path: "src/app.ts",
          indexStatus: " ",
          workTreeStatus: "M",
          status: "modified",
        },
      ],
    );

    expect(files).toHaveLength(1);
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
    expect(files[0].hunks.map((line) => line.type)).toEqual([
      "hunk",
      "removed",
      "added",
      "context",
    ]);
  });
});

describe("parseDiffNameStatus", () => {
  it("parses git diff --name-status output", () => {
    const result = parseDiffNameStatus(
      [
        "M\tsrc/app.ts",
        "A\tsrc/new.ts",
        "D\tsrc/old.ts",
        "R100\tsrc/before.ts\tsrc/after.ts",
      ].join("\n"),
    );

    expect(result).toEqual([
      expect.objectContaining({ path: "src/app.ts", status: "modified" }),
      expect.objectContaining({ path: "src/new.ts", status: "added" }),
      expect.objectContaining({ path: "src/old.ts", status: "deleted" }),
      expect.objectContaining({
        path: "src/after.ts",
        oldPath: "src/before.ts",
        status: "renamed",
      }),
    ]);
  });
});

describe("createMarkdownReport", () => {
  it("includes inline comments in the exported markdown", () => {
    const snapshot: RepositorySnapshot = {
      repoRoot: "C:/tmp/repo",
      repoName: "repo",
      branch: "main",
      compareRef: "HEAD",
      compareBaseRef: "HEAD",
      compareTargetRef: undefined,
      compareNewInRef: "HEAD",
      compareRelativeToRef: undefined,
      head: "abc123",
      isDetached: false,
      ahead: 0,
      behind: 0,
      changedFiles: 1,
      stagedFiles: 0,
      unstagedFiles: 1,
      untrackedFiles: 0,
      totalAdditions: 1,
      totalDeletions: 1,
      lastUpdated: "2026-05-11T18:50:00.000Z",
      config: {
        theme: "dark",
        openBrowser: false,
        defaultView: "unified",
        port: 3210,
        host: "127.0.0.1",
        compareRef: "HEAD",
        compareTargetRef: undefined,
      },
      files: [
        {
          path: "src/app.ts",
          status: "modified",
          stagedStatus: " ",
          unstagedStatus: "M",
          additions: 1,
          deletions: 1,
          isBinary: false,
          hunks: [],
          rawPatch: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
    };

    const markdown = createMarkdownReport(
      snapshot,
      "review notes",
      [
        {
          id: "c1",
          reviewId: "review-1",
          filePath: "src/app.ts",
          line: 10,
          category: "bug",
          severity: "major",
          body: "Potential null dereference.",
          author: "you",
          when: "just now",
        },
      ],
      "My report",
    );

    expect(markdown).toContain("## Review Comments");
    expect(markdown).toContain("### src/app.ts");
    expect(markdown).toContain("Line 10");
    expect(markdown).toContain("Potential null dereference.");
  });
});

describe("fileTracking helpers", () => {
  it("distinguishes staged, unstaged, and untracked badges", () => {
    expect(
      getTrackingBadges({
        status: "modified",
        stagedStatus: "M",
        unstagedStatus: "M",
      }).map((badge) => badge.key),
    ).toEqual(["staged", "unstaged"]);

    expect(
      getTrackingBadges({
        status: "untracked",
        stagedStatus: "?",
        unstagedStatus: "?",
      }).map((badge) => badge.key),
    ).toEqual(["untracked"]);
  });

  it("matches staged and untracked filters independently", () => {
    expect(
      matchesFileFilter(
        {
          status: "added",
          stagedStatus: "A",
          unstagedStatus: " ",
        },
        "staged",
      ),
    ).toBe(true);

    expect(
      matchesFileFilter(
        {
          status: "untracked",
          stagedStatus: "?",
          unstagedStatus: "?",
        },
        "staged",
      ),
    ).toBe(false);

    expect(
      matchesFileFilter(
        {
          status: "untracked",
          stagedStatus: "?",
          unstagedStatus: "?",
        },
        "untracked",
      ),
    ).toBe(true);
  });
});

describe("loadRepositorySnapshot", () => {
  it("includes staged and untracked files in the working tree diff", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "diffvision-snapshot-"));

    try {
      await runGit(["init"], repoRoot);
      await runGit(["config", "user.name", "DiffVision Test"], repoRoot);
      await runGit(
        ["config", "user.email", "diffvision@example.com"],
        repoRoot,
      );

      await writeFile(
        path.join(repoRoot, "tracked.ts"),
        "export const tracked = 1;\n",
      );
      await runGit(["add", "tracked.ts"], repoRoot);
      await runGit(["commit", "-m", "initial"], repoRoot);

      await writeFile(
        path.join(repoRoot, "staged.ts"),
        "export const staged = true;\n",
      );
      await runGit(["add", "staged.ts"], repoRoot);
      await writeFile(path.join(repoRoot, "notes.md"), "# scratch\n");

      const snapshot = await loadRepositorySnapshot(repoRoot);
      const stagedFile = snapshot.files.find(
        (file) => file.path === "staged.ts",
      );
      const untrackedFile = snapshot.files.find(
        (file) => file.path === "notes.md",
      );

      expect(snapshot.stagedFiles).toBe(1);
      expect(snapshot.untrackedFiles).toBe(1);
      expect(snapshot.files.map((file) => file.path)).toEqual(
        expect.arrayContaining(["staged.ts", "notes.md"]),
      );

      expect(stagedFile).toEqual(
        expect.objectContaining({
          status: "added",
          stagedStatus: "A",
        }),
      );
      expect(stagedFile?.rawPatch).toContain("export const staged = true;");

      expect(untrackedFile).toEqual(
        expect.objectContaining({
          status: "untracked",
          stagedStatus: "?",
          unstagedStatus: "?",
        }),
      );
      expect(untrackedFile?.rawPatch).toContain("# scratch");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("createReviewJsonPayload", () => {
  it("creates a minifiable correction payload with review anchors", () => {
    const snapshot: RepositorySnapshot = {
      repoRoot: "C:/tmp/repo",
      repoName: "repo",
      branch: "feature/review-json",
      compareRef: "feature/review-json..main",
      compareBaseRef: "main",
      compareTargetRef: "feature/review-json",
      compareNewInRef: "main",
      compareRelativeToRef: "feature/review-json",
      head: "abc123",
      isDetached: false,
      ahead: 0,
      behind: 0,
      changedFiles: 1,
      stagedFiles: 0,
      unstagedFiles: 1,
      untrackedFiles: 0,
      totalAdditions: 1,
      totalDeletions: 1,
      lastUpdated: "2026-05-12T12:00:00.000Z",
      config: {
        theme: "dark",
        openBrowser: false,
        defaultView: "unified",
        port: 3210,
        host: "127.0.0.1",
        compareRef: "main",
        compareTargetRef: "feature/review-json",
      },
      files: [
        {
          path: "src/app.ts",
          status: "modified",
          stagedStatus: " ",
          unstagedStatus: "M",
          additions: 1,
          deletions: 1,
          isBinary: false,
          hunks: [],
          rawPatch: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
    };

    const payload = createReviewJsonPayload(
      snapshot,
      "Fix exactly what was flagged.",
      [
        {
          id: "c1",
          reviewId: "review-1",
          filePath: "src/app.ts",
          line: 10,
          endLine: 12,
          startColumn: 5,
          endColumn: 18,
          category: "bug",
          severity: "major",
          body: "Collapse duplicated logic into a single helper.",
          snippet: "const value = a ? x() : x()",
          author: "you",
          when: "just now",
        },
      ],
      "Review JSON",
      {
        reviews: [
          {
            id: "review-1",
            version: 1,
            createdAt: "2026-05-12T11:55:00.000Z",
            exportedAt: "2026-05-12T12:00:00.000Z",
          },
        ],
        activeReviewId: "review-1",
        selection: { scope: "complete" },
      },
    );

    expect(payload.prompt).toContain("Apply the requested code corrections");
    expect(payload.prompt).toContain("Base ref: feature/review-json.");
    expect(payload.prompt).toContain("Included reviews: v1.");
    expect(payload.context.branch).toBe("feature/review-json");
    expect(payload.context.scope).toBe("complete");
    expect(payload.context.includedReviews).toEqual([
      expect.objectContaining({ id: "review-1", label: "v1" }),
    ]);
    expect(payload.data).toEqual([
      expect.objectContaining({
        filePath: "src/app.ts",
        reviewId: "review-1",
        reviewVersion: 1,
        reviewLabel: "v1",
        lines: { start: 10, end: 12 },
        columns: { start: 5, end: 18 },
        comment: "Collapse duplicated logic into a single helper.",
        snippet: "const value = a ? x() : x()",
      }),
    ]);
    expect(JSON.stringify(payload)).not.toContain("\n");
  });

  it("groups exported comments by review iteration when metadata is provided", () => {
    const snapshot: RepositorySnapshot = {
      repoRoot: "C:/tmp/repo",
      repoName: "repo",
      branch: "main",
      compareRef: "HEAD",
      compareBaseRef: "HEAD",
      compareTargetRef: undefined,
      compareNewInRef: "HEAD",
      compareRelativeToRef: undefined,
      head: "abc123",
      isDetached: false,
      ahead: 0,
      behind: 0,
      changedFiles: 1,
      stagedFiles: 0,
      unstagedFiles: 1,
      untrackedFiles: 0,
      totalAdditions: 1,
      totalDeletions: 1,
      lastUpdated: "2026-05-12T12:00:00.000Z",
      config: {
        theme: "dark",
        openBrowser: false,
        defaultView: "unified",
        port: 3210,
        host: "127.0.0.1",
        compareRef: "HEAD",
        compareTargetRef: undefined,
      },
      files: [
        {
          path: "src/app.ts",
          status: "modified",
          stagedStatus: " ",
          unstagedStatus: "M",
          additions: 1,
          deletions: 1,
          isBinary: false,
          hunks: [],
          rawPatch: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
    };

    const markdown = createMarkdownReport(
      snapshot,
      undefined,
      [
        {
          id: "c1",
          reviewId: "review-1",
          filePath: "src/app.ts",
          line: 10,
          category: "bug",
          severity: "major",
          body: "First pass issue.",
          author: "you",
          when: "just now",
        },
        {
          id: "c2",
          reviewId: "review-2",
          filePath: "src/app.ts",
          line: 14,
          category: "suggestion",
          severity: "minor",
          body: "Second pass cleanup.",
          author: "you",
          when: "just now",
        },
      ],
      "History export",
      {
        reviews: [
          {
            id: "review-1",
            version: 1,
            createdAt: "2026-05-12T11:00:00.000Z",
            exportedAt: "2026-05-12T11:30:00.000Z",
          },
          {
            id: "review-2",
            version: 2,
            createdAt: "2026-05-12T11:31:00.000Z",
          },
        ],
        activeReviewId: "review-2",
        selection: { scope: "complete" },
      },
    );

    expect(markdown).toContain("Review scope: complete history");
    expect(markdown).toContain("### v1");
    expect(markdown).toContain("### v2");
    expect(markdown).toContain("#### src/app.ts");
    expect(markdown).toContain("First pass issue.");
    expect(markdown).toContain("Second pass cleanup.");
  });
});

describe("readReviewHistory", () => {
  it("migrates a legacy flat comments file into v1 history", async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), "diffvision-history-"));

    try {
      const storage = await ensureStorage(repoRoot);
      await writeFile(
        storage.comments,
        `${JSON.stringify(
          [
            {
              id: "legacy-1",
              filePath: "src/app.ts",
              line: 7,
              category: "bug",
              severity: "major",
              body: "Legacy comment.",
              author: "you",
              when: "just now",
            },
          ],
          null,
          2,
        )}\n`,
        "utf8",
      );

      const history = await readReviewHistory(repoRoot);

      expect(history.activeReviewId).toBe("review-1");
      expect(history.reviews).toEqual([
        expect.objectContaining({ id: "review-1", version: 1 }),
      ]);
      expect(history.comments).toEqual([
        expect.objectContaining({
          id: "legacy-1",
          reviewId: "review-1",
          filePath: "src/app.ts",
        }),
      ]);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
