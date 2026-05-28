import { describe, expect, it } from "vitest";
import { CLI_VERSION, parseCliOptions } from "../src/cli/index";

describe("parseCliOptions", () => {
  it("accepts --version as an early-return flag", () => {
    expect(parseCliOptions(["--version"])).toEqual(
      expect.objectContaining({ version: true }),
    );
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("treats a single positional ref as --relative-to", () => {
    expect(parseCliOptions(["main"])).toEqual(
      expect.objectContaining({ relativeTo: "main" }),
    );
  });

  it("allows combining positional relative-to with --new-in", () => {
    expect(parseCliOptions(["main", "--new-in", "feature/foo"])).toEqual(
      expect.objectContaining({
        relativeTo: "main",
        newIn: "feature/foo",
      }),
    );
  });

  it("rejects mixing a positional ref with explicit --relative-to", () => {
    expect(() => parseCliOptions(["main", "--relative-to", "develop"])).toThrow(
      "Use either a positional ref or --relative-to/--target",
    );
  });

  it("rejects more than one positional ref", () => {
    expect(() => parseCliOptions(["main", "develop"])).toThrow(
      "Too many positional arguments",
    );
  });
});
