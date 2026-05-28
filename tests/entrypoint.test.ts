import { describe, expect, it } from "vitest";
import { isCliEntrypoint } from "../src/cli/entrypoint";

describe("isCliEntrypoint", () => {
  it("returns true when Node runs the module file directly", () => {
    expect(
      isCliEntrypoint(
        "file:///C:/repo/dist/cli/mcp.js",
        "C:/repo/dist/cli/mcp.js",
        ["diffvision-mcp"],
      ),
    ).toBe(true);
  });

  it("returns true for Windows command shims", () => {
    expect(
      isCliEntrypoint(
        "file:///C:/repo/dist/cli/mcp.js",
        "C:/Users/test/AppData/Local/fnm_multishells/123/diffvision-mcp.cmd",
        ["diffvision-mcp"],
      ),
    ).toBe(true);

    expect(
      isCliEntrypoint(
        "file:///C:/repo/dist/cli/mcp.js",
        "C:/Users/test/AppData/Local/fnm_multishells/123/diffvision-mcp.ps1",
        ["diffvision-mcp"],
      ),
    ).toBe(true);
  });

  it("returns false for unrelated processes", () => {
    expect(
      isCliEntrypoint(
        "file:///C:/repo/dist/cli/mcp.js",
        "C:/repo/node_modules/vitest/vitest.mjs",
        ["diffvision-mcp"],
      ),
    ).toBe(false);
  });
});
