import { Activity, Check, Palette } from "lucide-react";
import type { CSSProperties } from "react";
import { themeGroups, themes, type ThemeId } from "../theme";

interface ThemeBootstrapProps {
  themeId: ThemeId;
  loading: boolean;
  error: string | null;
  onSelectTheme: (themeId: ThemeId) => void;
  onContinue: () => void;
  onRetry: () => void;
}

const groupDescriptions: Record<string, string> = {
  "Dark Accent": "Deeper contrast and denser chrome for long review sessions.",
  "Light Accent":
    "Cleaner light surfaces tuned for daylight and document-heavy work.",
};

function buildPreviewStyle(theme: (typeof themes)[number]): CSSProperties {
  return {
    ["--theme-preview-bg" as string]: theme.preview.background,
    ["--theme-preview-surface" as string]: theme.preview.surface,
    ["--theme-preview-text" as string]: theme.preview.text,
    ["--theme-preview-accent" as string]: theme.preview.accent,
    ["--theme-preview-keyword" as string]: theme.preview.keyword,
    ["--theme-preview-string" as string]: theme.preview.string,
    ["--theme-preview-diff" as string]: theme.preview.diff,
  };
}

export function ThemeBootstrap({
  themeId,
  loading,
  error,
  onSelectTheme,
  onContinue,
  onRetry,
}: ThemeBootstrapProps) {
  const selectedTheme =
    themes.find((theme) => theme.id === themeId) ?? themes[0];

  return (
    <main className="bootstrap-shell">
      <section className="bootstrap-panel">
        <div className="bootstrap-hero">
          <span className="bootstrap-eyebrow">
            <Palette size={14} />
            Theme bootstrap
          </span>
          <h1>Choose the visual language for DiffVision</h1>
          <p className="bootstrap-subtitle">
            The same selection drives page chrome and syntax highlighting. You
            can change it later from the top bar without leaving the workspace.
          </p>
        </div>

        <div className="bootstrap-status">
          <div
            className={
              loading
                ? "bootstrap-status-chip is-loading"
                : error
                  ? "bootstrap-status-chip is-error"
                  : "bootstrap-status-chip is-ready"
            }
          >
            <Activity className={loading ? "spin" : undefined} size={13} />
            <span>
              {loading
                ? "Bootstrapping repository"
                : error
                  ? "Repository status unavailable"
                  : "Repository ready"}
            </span>
          </div>
          <p className="bootstrap-status-copy">
            {error
              ? error
              : loading
                ? "DiffVision is loading your repository in the background while you pick the startup theme."
                : `${selectedTheme.label} is selected and ready to open the workspace.`}
          </p>
        </div>

        <div className="bootstrap-groups">
          {themeGroups.map((group) => (
            <section key={group.label} className="bootstrap-group">
              <div className="bootstrap-group-header">
                <div>
                  <h2>{group.label}</h2>
                  <p>
                    {groupDescriptions[group.label] ??
                      "Curated palettes for code review and navigation."}
                  </p>
                </div>
              </div>

              <div className="bootstrap-grid">
                {group.themes.map((theme) => {
                  const isActive = theme.id === themeId;

                  return (
                    <button
                      key={theme.id}
                      type="button"
                      className={
                        isActive ? "bootstrap-card is-active" : "bootstrap-card"
                      }
                      style={buildPreviewStyle(theme)}
                      onClick={() => onSelectTheme(theme.id)}
                      aria-pressed={isActive}
                    >
                      <div className="bootstrap-card-head">
                        <div className="bootstrap-card-copy">
                          <span className="bootstrap-card-title">
                            {theme.label}
                          </span>
                          <span className="bootstrap-card-meta">
                            {theme.mode}
                          </span>
                        </div>
                        {isActive ? (
                          <span
                            className="bootstrap-card-check"
                            aria-hidden="true"
                          >
                            <Check size={14} />
                          </span>
                        ) : null}
                      </div>

                      <p className="bootstrap-card-description">
                        {theme.description}
                      </p>

                      <div className="bootstrap-preview" aria-hidden="true">
                        <div className="bootstrap-preview-toolbar">
                          <span className="bootstrap-preview-toolbar-dot" />
                          <span className="bootstrap-preview-toolbar-dot" />
                          <span className="bootstrap-preview-toolbar-dot" />
                        </div>

                        <div className="bootstrap-preview-code">
                          <span className="theme-preview-token theme-preview-keyword">
                            const
                          </span>{" "}
                          <span className="theme-preview-token theme-preview-accent">
                            review
                          </span>{" "}
                          <span className="theme-preview-token">=</span>{" "}
                          <span className="theme-preview-token theme-preview-string">
                            &quot;{theme.label}&quot;
                          </span>
                        </div>

                        <div className="bootstrap-preview-row">
                          <span className="bootstrap-preview-pill">page</span>
                          <span className="bootstrap-preview-pill is-accent">
                            code
                          </span>
                          <span className="bootstrap-preview-diff">+ diff</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="bootstrap-actions">
          <p className="bootstrap-actions-copy">
            <strong>{selectedTheme.label}</strong> will be saved locally and
            used the next time this workspace opens.
          </p>
          <div className="bootstrap-actions-row">
            {error ? (
              <button
                type="button"
                className="secondary-button"
                onClick={onRetry}
              >
                Retry repository load
              </button>
            ) : null}
            <button
              type="button"
              className="primary-button"
              onClick={onContinue}
            >
              {loading ? "Apply theme and keep booting" : "Open workspace"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
