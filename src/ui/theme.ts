export type ThemeMode = "dark" | "light";

interface ThemePreview {
  background: string;
  surface: string;
  text: string;
  accent: string;
  keyword: string;
  string: string;
  diff: string;
}

interface ThemeDefinition {
  id: string;
  label: string;
  group: string;
  mode: ThemeMode;
  description: string;
  preview: ThemePreview;
}

export const themes = [
  {
    id: "dark",
    label: "Dark",
    group: "Dark Accent",
    mode: "dark",
    description:
      "Current DiffVision palette with glassy dark chrome and electric syntax accents.",
    preview: {
      background: "oklch(0.16 0.005 270)",
      surface: "oklch(0.19 0.006 270)",
      text: "oklch(0.96 0.005 270)",
      accent: "oklch(0.78 0.14 250)",
      keyword: "oklch(0.78 0.16 285)",
      string: "oklch(0.84 0.16 135)",
      diff: "oklch(0.78 0.18 145)",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    group: "Dark Accent",
    mode: "dark",
    description:
      "Official Dracula contrast with violet chrome, neon pink keywords and acid strings.",
    preview: {
      background: "#282A36",
      surface: "#343746",
      text: "#F8F8F2",
      accent: "#BD93F9",
      keyword: "#FF79C6",
      string: "#F1FA8C",
      diff: "#50FA7B",
    },
  },
  {
    id: "lust",
    label: "Lust",
    group: "Dark Accent",
    mode: "dark",
    description:
      "Warm cocoa dark theme with dusty rose keywords and soft peach code highlights.",
    preview: {
      background: "#1D1716",
      surface: "#24201F",
      text: "#E8E7E7",
      accent: "#DEADE4",
      keyword: "#DEADE4",
      string: "#E8BA98",
      diff: "#6CB6A0",
    },
  },
  {
    id: "one-light",
    label: "OneLight",
    group: "Light Accent",
    mode: "light",
    description:
      "Atom-inspired light editor with crisp neutrals, blue functions and clean green strings.",
    preview: {
      background: "#FAFAFA",
      surface: "#FFFFFF",
      text: "#383A42",
      accent: "#4078F2",
      keyword: "#A626A4",
      string: "#50A14F",
      diff: "#50A14F",
    },
  },
  {
    id: "min-light",
    label: "MinTheme",
    group: "Light Accent",
    mode: "light",
    description:
      "Minimal light chrome with restrained neutrals and editorial blue-red syntax contrast.",
    preview: {
      background: "#FFFFFF",
      surface: "#F6F6F6",
      text: "#212121",
      accent: "#1976D2",
      keyword: "#D32F2F",
      string: "#2B5581",
      diff: "#77CC00",
    },
  },
  {
    id: "papercolor-light",
    label: "PaperColor",
    group: "Light Accent",
    mode: "light",
    description:
      "Paper-like light palette with pragmatic editor contrast and vivid review signals.",
    preview: {
      background: "#F3F3F3",
      surface: "#EEEEEE",
      text: "#444444",
      accent: "#005F87",
      keyword: "#D70087",
      string: "#5F8700",
      diff: "#008700",
    },
  },
] as const satisfies readonly ThemeDefinition[];

export type ThemeId = (typeof themes)[number]["id"];

export const themeGroups = [
  {
    label: "Dark Accent",
    themes: [themes[0], themes[1], themes[2]],
  },
  {
    label: "Light Accent",
    themes: [themes[3], themes[4], themes[5]],
  },
] as const;

export const themeStorageKey = "diffvision:theme";
export const defaultThemeId: ThemeId = "dark";

const themeIds = new Set<ThemeId>(themes.map((theme) => theme.id));

export function loadPersistedThemeId(): ThemeId | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(themeStorageKey);
    return typeof rawValue === "string" && themeIds.has(rawValue as ThemeId)
      ? (rawValue as ThemeId)
      : null;
  } catch {
    return null;
  }
}

export function resolveThemeId(value: unknown): ThemeId {
  return typeof value === "string" && themeIds.has(value as ThemeId)
    ? (value as ThemeId)
    : defaultThemeId;
}

export function loadStoredThemeId(): ThemeId {
  return loadPersistedThemeId() ?? defaultThemeId;
}

export function saveTheme(themeId: ThemeId) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(themeStorageKey, themeId);
  } catch {
    // Ignore storage failures and keep the in-memory selection.
  }
}

export function applyTheme(themeId: ThemeId) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const theme = themes.find((option) => option.id === themeId) ?? themes[0];
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.mode;
}
