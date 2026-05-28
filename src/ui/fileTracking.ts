import type { DiffFile } from "../shared/types";

export type FileTrackingFilter =
  | "all"
  | "modified"
  | "added"
  | "untracked"
  | "staged"
  | "unstaged"
  | "bookmarked";

export interface FileTrackingBadge {
  key: "untracked" | "staged" | "unstaged";
  label: string;
}

export const fileTrackingFilters = [
  "all",
  "modified",
  "added",
  "untracked",
  "staged",
  "unstaged",
  "bookmarked",
] as const satisfies readonly FileTrackingFilter[];

function hasMeaningfulGitStatus(value: string) {
  return value !== " " && value !== "?";
}

export function hasStagedChanges(
  file: Pick<DiffFile, "status" | "stagedStatus">,
) {
  return (
    file.status !== "untracked" && hasMeaningfulGitStatus(file.stagedStatus)
  );
}

export function hasUnstagedChanges(
  file: Pick<DiffFile, "status" | "unstagedStatus">,
) {
  return (
    file.status !== "untracked" && hasMeaningfulGitStatus(file.unstagedStatus)
  );
}

export function getTrackingBadges(
  file: Pick<DiffFile, "status" | "stagedStatus" | "unstagedStatus">,
): FileTrackingBadge[] {
  if (file.status === "untracked") {
    return [{ key: "untracked", label: "untracked" }];
  }

  const badges: FileTrackingBadge[] = [];

  if (hasStagedChanges(file)) {
    badges.push({ key: "staged", label: "staged" });
  }

  if (hasUnstagedChanges(file)) {
    badges.push({ key: "unstaged", label: "unstaged" });
  }

  return badges;
}

export function matchesFileFilter(
  file: Pick<DiffFile, "status" | "stagedStatus" | "unstagedStatus">,
  filter: Exclude<FileTrackingFilter, "bookmarked">,
) {
  switch (filter) {
    case "all":
      return true;
    case "staged":
      return hasStagedChanges(file);
    case "unstaged":
      return hasUnstagedChanges(file);
    case "untracked":
      return file.status === "untracked";
    default:
      return file.status === filter;
  }
}
