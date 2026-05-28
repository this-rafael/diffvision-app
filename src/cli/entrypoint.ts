import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function matchesCommandName(entryBasename: string, commandName: string) {
  const normalizedEntry = entryBasename.toLowerCase();
  const normalizedCommand = commandName.toLowerCase();

  return (
    normalizedEntry === normalizedCommand ||
    normalizedEntry === `${normalizedCommand}.cmd` ||
    normalizedEntry === `${normalizedCommand}.ps1` ||
    normalizedEntry === `${normalizedCommand}.bat` ||
    normalizedEntry === `${normalizedCommand}.exe`
  );
}

function resolveComparablePath(filePath: string) {
  const resolvedPath = path.resolve(filePath);

  try {
    return realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export function isCliEntrypoint(
  moduleUrl: string,
  argv1 = process.argv[1],
  commandNames: string[] = [],
) {
  if (!argv1) {
    return false;
  }

  const resolvedEntry = resolveComparablePath(argv1);
  const resolvedModule = resolveComparablePath(fileURLToPath(moduleUrl));

  if (resolvedEntry === resolvedModule) {
    return true;
  }

  const entryBasename = path.basename(resolvedEntry);
  return commandNames.some((commandName) =>
    matchesCommandName(entryBasename, commandName),
  );
}
