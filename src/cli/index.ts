#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import boxen from "boxen";
import chalk from "chalk";
import getPort from "get-port";
import open from "open";
import ora from "ora";
import { isCliEntrypoint } from "./entrypoint";
import {
  configureLogs,
  isAllLogsEnabled,
  logAll,
  logAllError,
} from "../lib/logger";
import { discoverRepository, loadRepositorySnapshot } from "../lib/repository";
import { defaultConfig, readConfig } from "../lib/storage";
import { startServer, resolveEmbeddedUiDirectory } from "../server/index";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version: string };

export const CLI_VERSION = packageJson.version;

export interface CliOptions {
  host?: string;
  port?: number;
  open?: boolean;
  cwd?: string;
  uiOrigin?: string;
  compare?: string;
  newIn?: string;
  relativeTo?: string;
  base?: string;
  target?: string;
  logs?: string;
  help?: boolean;
  version?: boolean;
}

function printHelp() {
  console.log(`
DiffVision

Usage:
  diffvision [relative-to-ref] [options]

Options:
  --host <host>       Host to bind the local server
  --port <port>       Preferred port to bind
  --compare <ref>     Base ref (legacy alias for --base)
  --new-in <ref>      Show what is new in this ref
  --relative-to <ref> Compare the new-in ref relative to this ref
  --base <ref>        Legacy alias for --new-in
  --target <ref>      Legacy alias for --relative-to
  --open              Force browser launch
  --no-open           Disable automatic browser launch
  --cwd <path>        Inspect a repository different from the current directory
  --ui-origin <url>   Development UI origin override
  --logs <mode>       Enable terminal logs (all for full internal logs)
  --help              Show this help
  --version           Print the installed DiffVision version

Shortcuts:
  diffvision main     Compare what is new in the current branch (HEAD) vs main
`);
}

export function parseCliOptions(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      host: { type: "string" },
      port: { type: "string" },
      compare: { type: "string" },
      "new-in": { type: "string" },
      "relative-to": { type: "string" },
      base: { type: "string" },
      target: { type: "string" },
      open: { type: "boolean" },
      "no-open": { type: "boolean" },
      cwd: { type: "string" },
      "ui-origin": { type: "string" },
      logs: { type: "string" },
      help: { type: "boolean" },
      version: { type: "boolean" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    return { help: true };
  }

  if (values.version) {
    return { version: true };
  }

  if (values.logs && values.logs !== "all") {
    throw new Error("Invalid value for --logs. Supported value: all");
  }

  if (positionals.length > 1) {
    throw new Error(
      "Too many positional arguments. Use `diffvision <ref>` or the explicit flags.",
    );
  }

  const positionalRelativeTo = positionals[0]?.trim() || undefined;

  if (positionalRelativeTo && (values["relative-to"] || values.target)) {
    throw new Error(
      "Use either a positional ref or --relative-to/--target, not both.",
    );
  }

  return {
    host: values.host,
    port: values.port ? Number.parseInt(values.port, 10) : undefined,
    compare: values.compare,
    newIn: values["new-in"],
    relativeTo: values["relative-to"] ?? positionalRelativeTo,
    base: values.base,
    target: values.target,
    open: values.open ? true : values["no-open"] ? false : undefined,
    cwd: values.cwd,
    uiOrigin: values["ui-origin"],
    logs: values.logs,
    help: values.help,
    version: values.version,
  };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.version) {
    console.log(CLI_VERSION);
    return;
  }

  configureLogs(options.logs);
  logAll("cli", "parsed CLI options", { options });
  const cwd = path.resolve(options.cwd ?? process.cwd());

  const repoSpinner = ora("Detecting repository").start();
  const repoRoot = await discoverRepository(cwd);
  logAll("cli", "repository detection finished", { cwd, repoRoot });

  if (!repoRoot) {
    repoSpinner.fail("No Git repository detected in current directory.");
    console.error(
      boxen(
        `${chalk.red("DiffVision could not find a Git repository.")}\n\nRun ${chalk.cyan("diffvision")} inside any tracked project or pass ${chalk.cyan("--cwd <path>")}.`,
        {
          padding: 1,
          borderColor: "red",
          title: "DiffVision",
        },
      ),
    );
    process.exit(1);
  }

  repoSpinner.succeed(`Repository detected: ${chalk.cyan(repoRoot)}`);

  const config = {
    ...defaultConfig,
    ...(await readConfig(repoRoot)),
  };
  logAll("cli", "loaded config", { config });

  const desiredPort = options.port ?? config.port;
  const port = await getPort({ port: desiredPort });
  const host = options.host ?? config.host;
  const compareRef =
    options.newIn ?? options.base ?? options.compare ?? config.compareRef;
  const compareTargetRef =
    options.relativeTo ?? options.target ?? config.compareTargetRef;
  const openBrowser = options.open ?? config.openBrowser;
  logAll("cli", "resolved runtime settings", {
    desiredPort,
    port,
    host,
    compareRef,
    compareTargetRef,
    openBrowser,
  });

  const metadataSpinner = ora("Loading git metadata").start();
  const snapshot = await loadRepositorySnapshot(repoRoot, {
    host,
    port,
    openBrowser,
    compareRef,
    compareTargetRef,
  });
  metadataSpinner.succeed(
    `Loaded ${chalk.cyan(String(snapshot.changedFiles))} changed files on ${chalk.cyan(snapshot.branch)}`,
  );

  const serverSpinner = ora("Starting local server").start();
  const app = await startServer({
    repoRoot,
    host,
    port,
    staticDir: resolveEmbeddedUiDirectory(),
    uiOrigin: options.uiOrigin,
    configOverride: {
      ...snapshot.config,
      host,
      port,
      openBrowser,
      compareRef,
      compareTargetRef,
    },
  });
  logAll("cli", "server started", { host, port });
  serverSpinner.succeed(
    `Server listening on ${chalk.cyan(`http://${host}:${port}`)}`,
  );

  const url = `http://${host}:${port}`;

  if (openBrowser) {
    const browserSpinner = ora("Launching UI").start();
    await open(url);
    logAll("cli", "browser launch requested", { url });
    browserSpinner.succeed("Browser launched");
  }

  if (port !== desiredPort) {
    console.log(
      chalk.yellow(
        `Preferred port ${desiredPort} was unavailable. Using ${port}.`,
      ),
    );
  }

  console.log(
    boxen(
      [
        `${chalk.green("DiffVision running")}`,
        "",
        `${chalk.dim("Repository")}: ${chalk.white(snapshot.repoName)}`,
        `${chalk.dim("Branch")}: ${chalk.white(snapshot.branch)}`,
        `${chalk.dim("Compare")}: ${chalk.white(snapshot.compareRef)}`,
        `${chalk.dim("Files")}: ${chalk.white(String(snapshot.changedFiles))}`,
        `${chalk.dim("URL")}: ${chalk.cyan(url)}`,
      ].join("\n"),
      {
        padding: 1,
        borderColor: "blue",
        title: "DiffVision",
      },
    ),
  );

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (isAllLogsEnabled()) {
    console.log(chalk.gray("Internal logging is enabled (--logs all)."));
  }
}

const isDirectRun = isCliEntrypoint(import.meta.url, process.argv[1], [
  "diffvision",
]);

if (isDirectRun) {
  main().catch((error) => {
    logAllError("cli", "startup failed", error);
    console.error(
      boxen(
        chalk.red(
          error instanceof Error
            ? error.message
            : "Unexpected DiffVision failure",
        ),
        {
          padding: 1,
          borderColor: "red",
          title: "DiffVision",
        },
      ),
    );
    process.exit(1);
  });
}
