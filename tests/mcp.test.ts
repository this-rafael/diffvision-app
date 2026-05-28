import { describe, expect, it } from "vitest";
import {
  MCP_CLI_VERSION,
  parseMcpCliOptions,
  resolveMcpComparisonSettings,
} from "../src/cli/mcp";
import {
  appendReviewComment,
  createReviewHistory,
} from "../src/shared/reviews";

describe("parseMcpCliOptions", () => {
  it("accepts --version as an early-return flag", () => {
    expect(parseMcpCliOptions(["--version"])).toEqual(
      expect.objectContaining({ version: true }),
    );
    expect(MCP_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("treats a positional ref as --relative-to and keeps author", () => {
    expect(parseMcpCliOptions(["main", "--author", "copilot"])).toEqual(
      expect.objectContaining({
        relativeTo: "main",
        author: "copilot",
      }),
    );
  });

  it("rejects invalid log modes", () => {
    expect(() => parseMcpCliOptions(["--logs", "verbose"])).toThrow(
      "Invalid value for --logs. Supported value: all",
    );
  });

  it("rejects mixing a positional ref with explicit --relative-to", () => {
    expect(() =>
      parseMcpCliOptions(["main", "--relative-to", "develop"]),
    ).toThrow("Use either a positional ref or --relative-to/--target");
  });
});

describe("appendReviewComment", () => {
  it("normalizes and appends comments into the active review", () => {
    const history = createReviewHistory([], "2026-05-15T12:00:00.000Z");
    const next = appendReviewComment(history, {
      id: "c-fixed",
      filePath: "src/app.ts",
      line: 8,
      endLine: 2,
      startColumn: 0,
      endColumn: 0,
      category: "bug",
      severity: "major",
      body: "  Guard against undefined access.  ",
      snippet: "  foo?.bar  ",
      author: "copilot",
      when: "2026-05-15T12:05:00.000Z",
    });

    expect(next.comments).toEqual([
      expect.objectContaining({
        id: "c-fixed",
        reviewId: history.activeReviewId,
        filePath: "src/app.ts",
        line: 8,
        endLine: 8,
        startColumn: undefined,
        endColumn: undefined,
        category: "bug",
        severity: "major",
        body: "Guard against undefined access.",
        snippet: "foo?.bar",
        author: "copilot",
        when: "2026-05-15T12:05:00.000Z",
      }),
    ]);
  });
});

describe("resolveMcpComparisonSettings", () => {
  it("lets each MCP call override the diff selection", () => {
    expect(
      resolveMcpComparisonSettings(
        {
          compareRef: "HEAD",
          compareTargetRef: "main",
        },
        {},
        {
          newIn: "feature/review",
          relativeTo: "develop",
        },
      ),
    ).toEqual({
      compareRef: "feature/review",
      compareTargetRef: "develop",
    });
  });

  it("allows a tool call to clear a default relative-to ref", () => {
    expect(
      resolveMcpComparisonSettings(
        {
          compareRef: "HEAD",
          compareTargetRef: "main",
        },
        {
          relativeTo: "release",
        },
        {
          relativeTo: "",
        },
      ),
    ).toEqual({
      compareRef: "HEAD",
      compareTargetRef: undefined,
    });
  });
});
