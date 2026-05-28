import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DiffFile, DiffFileStatus, DiffLine } from "../shared/types";

export interface StatusEntry {
  path: string;
  oldPath?: string;
  indexStatus: string;
  workTreeStatus: string;
  status: DiffFileStatus;
}

function inferStatus(code: string, rawPath: string): StatusEntry {
  const indexStatus = code[0] ?? " ";
  const workTreeStatus = code[1] ?? " ";
  const [fromPath, toPath] = rawPath.includes(" -> ")
    ? rawPath.split(" -> ")
    : [undefined, rawPath];

  let status: DiffFileStatus = "modified";

  if (code === "??") {
    status = "untracked";
  } else if (indexStatus === "R" || workTreeStatus === "R") {
    status = "renamed";
  } else if (indexStatus === "A" || workTreeStatus === "A") {
    status = "added";
  } else if (indexStatus === "D" || workTreeStatus === "D") {
    status = "deleted";
  }

  return {
    path: toPath,
    oldPath: fromPath,
    indexStatus,
    workTreeStatus,
    status,
  };
}

export function parseStatusPorcelain(output: string): StatusEntry[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => inferStatus(line.slice(0, 2), line.slice(3)));
}

export function parseDiffNameStatus(output: string): StatusEntry[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [rawCode, ...paths] = line.split("\t");
      const statusCode = rawCode?.trim()[0] ?? "M";

      if (statusCode === "R" && paths.length >= 2) {
        return {
          path: paths[1],
          oldPath: paths[0],
          indexStatus: " ",
          workTreeStatus: " ",
          status: "renamed" as const,
        };
      }

      return {
        path: paths[0] ?? "unknown",
        indexStatus: " ",
        workTreeStatus: " ",
        status:
          statusCode === "A"
            ? "added"
            : statusCode === "D"
              ? "deleted"
              : "modified",
      };
    });
}

function createEmptyFile(entry: StatusEntry): DiffFile {
  return {
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    stagedStatus: entry.indexStatus,
    unstagedStatus: entry.workTreeStatus,
    additions: 0,
    deletions: 0,
    isBinary: false,
    hunks: [],
    rawPatch: "",
  };
}

function parseHunkHeader(value: string) {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(value);
  if (!match) {
    return {
      oldStart: 0,
      newStart: 0,
    };
  }

  return {
    oldStart: Number.parseInt(match[1], 10),
    newStart: Number.parseInt(match[3], 10),
  };
}

export function parseUnifiedDiff(
  diffText: string,
  statusEntries: StatusEntry[],
): DiffFile[] {
  const entriesByPath = new Map(
    statusEntries.map((entry) => [entry.path, entry]),
  );
  const files = new Map<string, DiffFile>();
  const lines = diffText.split(/\r?\n/);

  let current: DiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;
  let patchLines: string[] = [];

  const finalize = () => {
    if (!current) {
      return;
    }

    current.rawPatch = patchLines.join("\n").trim();
    files.set(current.path, current);
    current = null;
    patchLines = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      finalize();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      const nextPath =
        match?.[2] ??
        line
          .replace(/^diff --git a\//, "")
          .split(" b/")
          .at(-1) ??
        "unknown";
      const entry = entriesByPath.get(nextPath) ?? {
        path: nextPath,
        indexStatus: " ",
        workTreeStatus: "M",
        status: "modified" as DiffFileStatus,
      };
      current = createEmptyFile(entry);
      patchLines.push(line);
      continue;
    }

    if (!current) {
      continue;
    }

    patchLines.push(line);

    if (line.startsWith("rename from ")) {
      current.oldPath = line.slice("rename from ".length);
      current.status = "renamed";
      continue;
    }

    if (line.startsWith("rename to ")) {
      current.path = line.slice("rename to ".length);
      continue;
    }

    if (line === "GIT binary patch" || line.startsWith("Binary files ")) {
      current.isBinary = true;
      current.status = "binary";
      continue;
    }

    if (line.startsWith("new file mode ")) {
      current.status = "added";
      continue;
    }

    if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
      continue;
    }

    if (line.startsWith("@@")) {
      const { oldStart, newStart } = parseHunkHeader(line);
      oldLine = oldStart;
      newLine = newStart;
      current.hunks.push({
        id: `${current.path}-hunk-${current.hunks.length}`,
        type: "hunk",
        text: line,
      });
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
      current.hunks.push({
        id: `${current.path}-line-${current.hunks.length}`,
        type: "added",
        text: line.slice(1),
        newNumber: newLine,
      });
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
      current.hunks.push({
        id: `${current.path}-line-${current.hunks.length}`,
        type: "removed",
        text: line.slice(1),
        oldNumber: oldLine,
      });
      oldLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      current.hunks.push({
        id: `${current.path}-line-${current.hunks.length}`,
        type: "context",
        text: line.slice(1),
        oldNumber: oldLine,
        newNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }

  finalize();

  for (const entry of statusEntries) {
    if (!files.has(entry.path)) {
      files.set(entry.path, createEmptyFile(entry));
    }
  }

  return [...files.values()];
}

export async function buildSyntheticDiff(
  repoRoot: string,
  entry: StatusEntry,
): Promise<DiffFile> {
  const absolutePath = path.join(repoRoot, entry.path);
  const text = await readFile(absolutePath, "utf8");
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const hunks: DiffLine[] = [
    {
      id: `${entry.path}-hunk-0`,
      type: "hunk",
      text: `@@ -0,0 +1,${lines.length} @@`,
    },
    ...lines.map((line, index) => ({
      id: `${entry.path}-line-${index}`,
      type: "added" as const,
      text: line,
      newNumber: index + 1,
    })),
  ];

  return {
    path: entry.path,
    oldPath: entry.oldPath,
    status: "untracked",
    stagedStatus: entry.indexStatus,
    unstagedStatus: entry.workTreeStatus,
    additions: lines.length,
    deletions: 0,
    isBinary: false,
    hunks,
    rawPatch: [
      `diff --git a/${entry.path} b/${entry.path}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${entry.path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join("\n"),
  };
}
