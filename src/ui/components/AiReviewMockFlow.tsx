import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bot,
  Brain,
  CheckCheck,
  ChevronRight,
  FileCode2,
  Play,
  Settings2,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import type {
  DiffFile,
  DiffLine,
  RepositorySnapshot,
  ReviewCommentCategory,
  ReviewCommentSeverity,
} from "../../shared/types";

type MockFlowStep =
  | "provider-selection"
  | "provider-config"
  | "guide-setup"
  | "guide-categorizing"
  | "cards-editing"
  | "review-running";

interface MockProviderField {
  key: string;
  label: string;
  helper: string;
  placeholder: string;
  defaultValue: string;
}

interface MockProviderDefinition {
  id: string;
  label: string;
  status: "ready" | "preview";
  summary: string;
  features: string[];
  fields: MockProviderField[];
}

export interface MockAiReviewCard {
  id: string;
  title: string;
  summary: string;
  instructions: string;
  enabled: boolean;
  commentCategory: ReviewCommentCategory;
}

export interface MockAiReviewProfile {
  version: 1;
  bootstrapComplete: boolean;
  providerId: string;
  providerLabel: string;
  providerConfig: Record<string, string>;
  guideText: string;
  cards: MockAiReviewCard[];
  updatedAt: string;
  lastRunAt?: string;
  lastGeneratedCount?: number;
}

export interface MockAiReviewGeneratedComment {
  filePath: string;
  line: number;
  endLine?: number;
  category: ReviewCommentCategory;
  severity: ReviewCommentSeverity;
  body: string;
  snippet?: string;
}

interface AiReviewMockFlowProps {
  open: boolean;
  snapshot: RepositorySnapshot | null;
  profile: MockAiReviewProfile | null;
  onClose: () => void;
  onSaveProfile: (profile: MockAiReviewProfile) => void;
  onCompleteReview: (payload: {
    profile: MockAiReviewProfile;
    comments: MockAiReviewGeneratedComment[];
  }) => void;
}

const providerDefinitions: MockProviderDefinition[] = [
  {
    id: "github-copilot-cli",
    label: "GitHub Copilot CLI",
    status: "preview",
    summary:
      "Mocked ACP-backed flow for teams that want GitHub-native review framing.",
    features: ["ACP transport", "GitHub context", "Tool approvals"],
    fields: [
      {
        key: "command",
        label: "Executable",
        helper: "CLI entrypoint that DiffVision would wrap from the backend.",
        placeholder: "copilot",
        defaultValue: "copilot",
      },
      {
        key: "transport",
        label: "Transport",
        helper: "Machine-facing mode the backend would use for this provider.",
        placeholder: "ACP stdio",
        defaultValue: "ACP stdio",
      },
      {
        key: "policy",
        label: "Approval mode",
        helper: "How aggressive the mock run should appear in the UI.",
        placeholder: "Plan first",
        defaultValue: "Plan first",
      },
    ],
  },
  {
    id: "qwen-code",
    label: "Qwen Code",
    status: "ready",
    summary:
      "Mocked local-first flow for flexible provider routing and structured event streaming.",
    features: ["stream-json", "Local model routing", "Session resume"],
    fields: [
      {
        key: "command",
        label: "Executable",
        helper:
          "Binary or shim DiffVision would call for headless review runs.",
        placeholder: "qwen",
        defaultValue: "qwen",
      },
      {
        key: "model",
        label: "Model",
        helper: "Default model shown in the mocked profile and rule cards.",
        placeholder: "qwen3-coder-plus",
        defaultValue: "qwen3-coder-plus",
      },
      {
        key: "mode",
        label: "Approval mode",
        helper: "Displayed execution posture for the simulated run.",
        placeholder: "auto_edit",
        defaultValue: "auto_edit",
      },
    ],
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    status: "ready",
    summary:
      "Mocked subprocess wrapper tuned for quick structured review passes.",
    features: ["json output", "stream-json", "Workspace trust"],
    fields: [
      {
        key: "command",
        label: "Executable",
        helper: "Mocked CLI path used for headless automation.",
        placeholder: "gemini",
        defaultValue: "gemini",
      },
      {
        key: "model",
        label: "Model",
        helper: "Displayed review model for the mocked run.",
        placeholder: "gemini-2.5-flash",
        defaultValue: "gemini-2.5-flash",
      },
      {
        key: "auth",
        label: "Auth source",
        helper: "Provider auth path shown in the setup step.",
        placeholder: "Google account or API key",
        defaultValue: "Google account",
      },
    ],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    status: "ready",
    summary:
      "Mocked premium path with schema-validated outputs and rich streaming activity.",
    features: ["JSON schema", "SDK-ready", "Worktree isolation"],
    fields: [
      {
        key: "command",
        label: "Executable",
        helper: "CLI or SDK surface to present in the mocked provider form.",
        placeholder: "claude",
        defaultValue: "claude",
      },
      {
        key: "model",
        label: "Model alias",
        helper: "Displayed model alias for the review session.",
        placeholder: "sonnet",
        defaultValue: "sonnet",
      },
      {
        key: "permissions",
        label: "Permission mode",
        helper: "How the simulated run will report tool approvals.",
        placeholder: "acceptEdits",
        defaultValue: "acceptEdits",
      },
    ],
  },
];

const providerStepOrder: MockFlowStep[] = [
  "provider-selection",
  "provider-config",
  "guide-setup",
  "guide-categorizing",
  "cards-editing",
  "review-running",
];

const stepTitles: Record<MockFlowStep, string> = {
  "provider-selection": "Choose your agent",
  "provider-config": "Configure provider",
  "guide-setup": "Draft the review guide",
  "guide-categorizing": "Categorize review rules",
  "cards-editing": "Edit review cards",
  "review-running": "Run mocked review",
};

const defaultGuideTemplate = [
  "Naming conventions: keep route, component, and hook names explicit.",
  "Architecture: keep UI state thin and isolate transport logic from presentation.",
  "Risk review: call out auth, permissions, and destructive automation boundaries.",
  "Performance: watch repeated diff parsing and full-tree recomputation in interactive paths.",
].join("\n");

function createProviderConfig(
  provider: MockProviderDefinition,
  current?: Record<string, string>,
) {
  return Object.fromEntries(
    provider.fields.map((field) => [
      field.key,
      current?.[field.key] ?? field.defaultValue,
    ]),
  );
}

function resolveInitialStep(profile: MockAiReviewProfile | null): MockFlowStep {
  if (!profile) {
    return "provider-selection";
  }

  if (profile.bootstrapComplete && profile.cards.length > 0) {
    return "cards-editing";
  }

  if (profile.guideText.trim()) {
    return "guide-setup";
  }

  if (profile.providerId) {
    return "provider-config";
  }

  return "provider-selection";
}

function buildMockCards(
  guideText: string,
  providerLabel: string,
): MockAiReviewCard[] {
  const guideLines = guideText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const seededCards = [
    {
      id: "naming-patterns",
      title: "Naming patterns",
      summary: "Keep labels, handler names, and storage keys legible.",
      instructions:
        guideLines[0] ??
        "Prefer explicit identifiers for flows, components, and persisted review state.",
      enabled: true,
      commentCategory: "readability" as const,
    },
    {
      id: "architecture-boundaries",
      title: "Architecture",
      summary:
        "Spot UI concerns leaking into orchestration and persistence paths.",
      instructions:
        guideLines[1] ??
        "Call out places where orchestration, transport, and presentation are too tightly coupled.",
      enabled: true,
      commentCategory: "bug" as const,
    },
    {
      id: "design-patterns",
      title: "Design patterns used",
      summary:
        "Check whether the active slice follows the product's current abstractions.",
      instructions:
        guideLines[2] ??
        "Review whether adapters, storage helpers, and state transitions still fit the surrounding patterns.",
      enabled: true,
      commentCategory: "refactor" as const,
    },
    {
      id: "risk-and-performance",
      title: `Risk focus with ${providerLabel}`,
      summary:
        "Bias the mocked run toward risky hunk boundaries and expensive UI paths.",
      instructions:
        guideLines[3] ??
        "Prefer concrete comments about permission scope, repeated work, and high-cost view updates.",
      enabled: true,
      commentCategory: "performance" as const,
    },
  ];

  return seededCards;
}

function pickLineCandidate(file: DiffFile, preferredType?: DiffLine["type"]) {
  const candidates = file.hunks.filter(
    (line) =>
      line.type !== "hunk" &&
      typeof (line.newNumber ?? line.oldNumber) === "number",
  );

  if (!candidates.length) {
    return {
      line: 1,
      endLine: undefined,
      snippet: undefined,
    };
  }

  const preferred =
    (preferredType
      ? candidates.find((line) => line.type === preferredType)
      : undefined) ?? candidates[0];

  return {
    line: preferred.newNumber ?? preferred.oldNumber ?? 1,
    endLine:
      preferred.type === "added" || preferred.type === "removed"
        ? undefined
        : preferred.newNumber && preferred.oldNumber
          ? undefined
          : undefined,
    snippet: preferred.text.trim() || undefined,
  };
}

function severityForCategory(
  category: ReviewCommentCategory,
  index: number,
): ReviewCommentSeverity {
  if (category === "bug") {
    return index === 0 ? "critical" : "major";
  }

  if (category === "security" || category === "performance") {
    return "major";
  }

  if (category === "readability" || category === "refactor") {
    return "minor";
  }

  return "info";
}

function buildMockComments(
  snapshot: RepositorySnapshot,
  cards: MockAiReviewCard[],
  providerLabel: string,
): MockAiReviewGeneratedComment[] {
  const reviewableFiles = snapshot.files.filter(
    (file) => !file.isBinary && file.hunks.some((line) => line.type !== "hunk"),
  );

  if (!reviewableFiles.length) {
    return [];
  }

  return cards.map((card, index) => {
    const file = reviewableFiles[index % reviewableFiles.length];
    const preferredType =
      card.commentCategory === "performance"
        ? "context"
        : card.commentCategory === "bug"
          ? "added"
          : undefined;
    const target = pickLineCandidate(file, preferredType);

    return {
      filePath: file.path,
      line: target.line,
      endLine: target.endLine,
      category: card.commentCategory,
      severity: severityForCategory(card.commentCategory, index),
      body: `[Mocked ${providerLabel}] ${card.title} flagged this hunk as a review hotspot. Validate the surrounding diff before acting on this note; it exists to demonstrate how provider findings would land inline in DiffVision.`,
      snippet: target.snippet,
    };
  });
}

export function AiReviewMockFlow({
  open,
  snapshot,
  profile,
  onClose,
  onSaveProfile,
  onCompleteReview,
}: AiReviewMockFlowProps) {
  const [step, setStep] = useState<MockFlowStep>("provider-selection");
  const [selectedProviderId, setSelectedProviderId] = useState(
    providerDefinitions[0].id,
  );
  const [providerConfig, setProviderConfig] = useState<Record<string, string>>(
    () => createProviderConfig(providerDefinitions[0]),
  );
  const [guideText, setGuideText] = useState(defaultGuideTemplate);
  const [cards, setCards] = useState<MockAiReviewCard[]>([]);
  const [categorizationLog, setCategorizationLog] = useState<string[]>([]);
  const [reviewLog, setReviewLog] = useState<string[]>([]);
  const [reviewStatus, setReviewStatus] = useState<
    "idle" | "running" | "complete"
  >("idle");
  const [pendingComments, setPendingComments] = useState<
    MockAiReviewGeneratedComment[]
  >([]);

  const selectedProvider = useMemo(
    () =>
      providerDefinitions.find(
        (provider) => provider.id === selectedProviderId,
      ) ?? providerDefinitions[0],
    [selectedProviderId],
  );

  const enabledCards = useMemo(
    () => cards.filter((card) => card.enabled),
    [cards],
  );

  const flowSummary = useMemo(() => {
    if (!snapshot) {
      return "Repository snapshot unavailable";
    }

    return `${snapshot.repoName} · ${snapshot.changedFiles} changed files · ${snapshot.totalAdditions} additions · ${snapshot.totalDeletions} deletions`;
  }, [snapshot]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const initialProvider =
      providerDefinitions.find(
        (provider) => provider.id === profile?.providerId,
      ) ?? providerDefinitions[0];
    setSelectedProviderId(initialProvider.id);
    setProviderConfig(
      createProviderConfig(initialProvider, profile?.providerConfig),
    );
    setGuideText(
      profile?.guideText?.trim() ? profile.guideText : defaultGuideTemplate,
    );
    setCards(profile?.cards ?? []);
    setCategorizationLog([]);
    setReviewLog([]);
    setReviewStatus("idle");
    setPendingComments([]);
    setStep(resolveInitialStep(profile));
  }, [open, profile]);

  useEffect(() => {
    if (!open || step !== "guide-categorizing") {
      return;
    }

    const logSteps = [
      `Sampling repository signals from ${snapshot?.repoName ?? "the current repo"}.`,
      `Mapping ${selectedProvider.label} review heuristics onto the draft guide.`,
      "Separating cross-cutting rules into edit-friendly review cards.",
      "Packing the mocked provider output into structured categories.",
    ];

    setCategorizationLog([]);
    const timers = logSteps.map((entry, index) =>
      window.setTimeout(
        () => {
          setCategorizationLog((current) => [...current, entry]);

          if (index === logSteps.length - 1) {
            const nextCards = buildMockCards(guideText, selectedProvider.label);
            const nextProfile: MockAiReviewProfile = {
              version: 1,
              bootstrapComplete: true,
              providerId: selectedProvider.id,
              providerLabel: selectedProvider.label,
              providerConfig,
              guideText,
              cards: nextCards,
              updatedAt: new Date().toISOString(),
              lastRunAt: profile?.lastRunAt,
              lastGeneratedCount: profile?.lastGeneratedCount,
            };

            setCards(nextCards);
            onSaveProfile(nextProfile);
            window.setTimeout(() => setStep("cards-editing"), 260);
          }
        },
        520 * (index + 1),
      ),
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [
    guideText,
    onSaveProfile,
    open,
    profile?.lastGeneratedCount,
    profile?.lastRunAt,
    providerConfig,
    selectedProvider.id,
    selectedProvider.label,
    snapshot?.repoName,
    step,
  ]);

  useEffect(() => {
    if (!open || step !== "review-running" || reviewStatus !== "idle") {
      return;
    }

    if (!snapshot) {
      return;
    }

    const nextComments = buildMockComments(
      snapshot,
      enabledCards,
      selectedProvider.label,
    );

    const logSteps = [
      `Starting mocked ${selectedProvider.label} session in ${snapshot.repoName}.`,
      ...enabledCards.map(
        (card, index) =>
          `Reviewing ${snapshot.files[index % Math.max(1, snapshot.files.length)]?.path ?? "changed file"} through ${card.title}.`,
      ),
      "Merging overlapping findings across the enabled review cards.",
      `Prepared ${nextComments.length} mocked inline comments for the active draft.`,
    ];

    setReviewLog([]);
    setReviewStatus("running");

    const timers = logSteps.map((entry, index) =>
      window.setTimeout(
        () => {
          setReviewLog((current) => [...current, entry]);

          if (index === logSteps.length - 1) {
            setPendingComments(nextComments);
            setReviewStatus("complete");
          }
        },
        520 * (index + 1),
      ),
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [
    enabledCards,
    open,
    reviewStatus,
    selectedProvider.label,
    snapshot,
    step,
  ]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        commitDraftAndClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!open) {
    return null;
  }

  function buildProfile(
    nextCards = cards,
    bootstrapComplete = nextCards.length > 0,
  ) {
    const updatedProfile: MockAiReviewProfile = {
      version: 1,
      bootstrapComplete,
      providerId: selectedProvider.id,
      providerLabel: selectedProvider.label,
      providerConfig,
      guideText,
      cards: nextCards,
      updatedAt: new Date().toISOString(),
      lastRunAt: profile?.lastRunAt,
      lastGeneratedCount: profile?.lastGeneratedCount,
    };

    return updatedProfile;
  }

  function commitDraftAndClose() {
    onSaveProfile(buildProfile(cards, cards.length > 0));
    onClose();
  }

  function handleProviderSelect(providerId: string) {
    const nextProvider =
      providerDefinitions.find((provider) => provider.id === providerId) ??
      providerDefinitions[0];
    setSelectedProviderId(nextProvider.id);
    setProviderConfig(createProviderConfig(nextProvider));
  }

  function handleCardFieldChange(
    cardId: string,
    patch: Partial<MockAiReviewCard>,
  ) {
    setCards((current) =>
      current.map((card) =>
        card.id === cardId ? { ...card, ...patch } : card,
      ),
    );
  }

  function goBack() {
    const currentIndex = providerStepOrder.indexOf(step);
    if (currentIndex <= 0) {
      return;
    }

    if (step === "guide-categorizing" || step === "review-running") {
      return;
    }

    setStep(providerStepOrder[currentIndex - 1]);
  }

  function startCategorization() {
    setStep("guide-categorizing");
  }

  function startMockReview() {
    onSaveProfile(buildProfile(cards, true));
    setPendingComments([]);
    setReviewStatus("idle");
    setStep("review-running");
  }

  function finishReview() {
    const nextProfile: MockAiReviewProfile = {
      ...buildProfile(cards, true),
      lastRunAt: new Date().toISOString(),
      lastGeneratedCount: pendingComments.length,
    };

    onSaveProfile(nextProfile);
    onCompleteReview({
      profile: nextProfile,
      comments: pendingComments,
    });
  }

  const isProviderConfigValid = selectedProvider.fields.every((field) =>
    (providerConfig[field.key] ?? "").trim(),
  );

  return (
    <div className="overlay ai-review-overlay" role="dialog" aria-modal="true">
      <section className="ai-review-shell">
        <header className="ai-review-header">
          <div className="ai-review-header-copy">
            <span className="ai-review-eyebrow">
              <Sparkles size={13} />
              Mocked AI review flow
            </span>
            <h2>{stepTitles[step]}</h2>
            <p>
              UI prototype for the integrated review flow. Provider setup, rule
              cards, and findings are simulated locally so the workspace can be
              exercised before backend adapters exist.
            </p>
          </div>

          <button
            type="button"
            className="icon-button"
            onClick={commitDraftAndClose}
            aria-label="Close mocked AI review flow"
          >
            <X size={14} />
          </button>
        </header>

        <div className="ai-review-layout">
          <aside className="ai-review-rail">
            <div className="ai-review-rail-panel">
              <span className="ai-review-rail-label">Session</span>
              <strong>{selectedProvider.label}</strong>
              <p>{selectedProvider.summary}</p>
              <div className="ai-review-feature-list">
                {selectedProvider.features.map((feature) => (
                  <span key={feature} className="ai-review-feature-pill">
                    {feature}
                  </span>
                ))}
              </div>
            </div>

            <div className="ai-review-rail-panel">
              <span className="ai-review-rail-label">Repository</span>
              <strong>{snapshot?.repoName ?? "Workspace"}</strong>
              <p>{flowSummary}</p>
              {profile?.lastRunAt ? (
                <span className="ai-review-rail-meta">
                  Last mocked run:{" "}
                  {new Date(profile.lastRunAt).toLocaleString()}
                </span>
              ) : null}
            </div>

            <div
              className="ai-review-step-list"
              aria-label="AI review flow steps"
            >
              {providerStepOrder.map((entry) => {
                const entryIndex = providerStepOrder.indexOf(entry);
                const currentIndex = providerStepOrder.indexOf(step);
                const isActive = entry === step;
                const isComplete = currentIndex > entryIndex;

                return (
                  <div
                    key={entry}
                    className={
                      isActive
                        ? "ai-review-step-pill is-active"
                        : isComplete
                          ? "ai-review-step-pill is-complete"
                          : "ai-review-step-pill"
                    }
                  >
                    <span className="ai-review-step-index">
                      {isComplete ? <CheckCheck size={12} /> : entryIndex + 1}
                    </span>
                    <span>{stepTitles[entry]}</span>
                  </div>
                );
              })}
            </div>
          </aside>

          <div className="ai-review-stage">
            {step === "provider-selection" ? (
              <div className="ai-review-stage-panel ai-review-provider-grid">
                {providerDefinitions.map((provider) => {
                  const isSelected = provider.id === selectedProvider.id;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      className={
                        isSelected
                          ? "ai-review-provider-card is-selected"
                          : "ai-review-provider-card"
                      }
                      onClick={() => handleProviderSelect(provider.id)}
                    >
                      <div className="ai-review-provider-head">
                        <div>
                          <span className="ai-review-provider-status">
                            {provider.status}
                          </span>
                          <strong>{provider.label}</strong>
                        </div>
                        <Bot size={18} />
                      </div>
                      <p>{provider.summary}</p>
                      <div className="ai-review-feature-list">
                        {provider.features.map((feature) => (
                          <span
                            key={feature}
                            className="ai-review-feature-pill"
                          >
                            {feature}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {step === "provider-config" ? (
              <div className="ai-review-stage-panel ai-review-form-panel">
                <div className="ai-review-form-copy">
                  <span className="ai-review-section-tag">
                    <Settings2 size={13} />
                    Provider setup
                  </span>
                  <h3>{selectedProvider.label}</h3>
                  <p>
                    This mocked form mirrors provider-specific setup without
                    requiring real credentials or process execution.
                  </p>
                </div>
                <div className="ai-review-form-grid">
                  {selectedProvider.fields.map((field) => (
                    <label key={field.key} className="ai-review-form-field">
                      <span>{field.label}</span>
                      <input
                        className="ai-review-input"
                        value={providerConfig[field.key] ?? ""}
                        placeholder={field.placeholder}
                        onChange={(event) =>
                          setProviderConfig((current) => ({
                            ...current,
                            [field.key]: event.target.value,
                          }))
                        }
                      />
                      <small>{field.helper}</small>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {step === "guide-setup" ? (
              <div className="ai-review-stage-panel ai-review-form-panel">
                <div className="ai-review-form-copy">
                  <span className="ai-review-section-tag">
                    <Brain size={13} />
                    Review guide
                  </span>
                  <h3>Build the mocked review brief</h3>
                  <p>
                    This text will be transformed into editable review cards.
                    Keep it concrete so the mocked run produces believable
                    inline findings.
                  </p>
                </div>

                <textarea
                  className="ai-review-textarea"
                  value={guideText}
                  onChange={(event) => setGuideText(event.target.value)}
                />

                <div className="ai-review-guide-hint-grid">
                  <div className="ai-review-guide-hint-card">
                    <strong>Useful sections</strong>
                    <p>
                      Naming, architecture, risky boundaries, and performance
                      hotspots.
                    </p>
                  </div>
                  <div className="ai-review-guide-hint-card">
                    <strong>Mock behavior</strong>
                    <p>
                      The categorization step will derive four provider-colored
                      cards from this text.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {step === "guide-categorizing" ? (
              <div className="ai-review-stage-panel ai-review-log-panel">
                <div className="ai-review-form-copy">
                  <span className="ai-review-section-tag">
                    <Wand2 size={13} />
                    Categorizing
                  </span>
                  <h3>Turning the guide into editable review cards</h3>
                  <p>
                    The mocked provider is projecting repository context and
                    grouping the guide into review slices.
                  </p>
                </div>

                <div className="ai-review-log-stream">
                  {categorizationLog.map((entry) => (
                    <div key={entry} className="ai-review-log-entry">
                      <Activity className="spin" size={13} />
                      <span>{entry}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {step === "cards-editing" ? (
              <div className="ai-review-stage-panel ai-review-cards-panel">
                <div className="ai-review-form-copy">
                  <span className="ai-review-section-tag">
                    <FileCode2 size={13} />
                    Rule cards
                  </span>
                  <h3>Curate the mocked review pass</h3>
                  <p>
                    Enable or trim the cards before the simulated run writes
                    inline findings into the active DiffVision draft.
                  </p>
                </div>

                <div className="ai-review-cards-grid">
                  {cards.map((card) => (
                    <article key={card.id} className="ai-review-card-editor">
                      <div className="ai-review-card-head">
                        <label className="ai-review-card-toggle">
                          <input
                            type="checkbox"
                            checked={card.enabled}
                            onChange={(event) =>
                              handleCardFieldChange(card.id, {
                                enabled: event.target.checked,
                              })
                            }
                          />
                          <span>{card.title}</span>
                        </label>
                        <span className="ai-review-card-category">
                          {card.commentCategory}
                        </span>
                      </div>

                      <label className="ai-review-form-field">
                        <span>Summary</span>
                        <input
                          className="ai-review-input"
                          value={card.summary}
                          onChange={(event) =>
                            handleCardFieldChange(card.id, {
                              summary: event.target.value,
                            })
                          }
                        />
                      </label>

                      <label className="ai-review-form-field">
                        <span>Instructions</span>
                        <textarea
                          className="ai-review-card-textarea"
                          value={card.instructions}
                          onChange={(event) =>
                            handleCardFieldChange(card.id, {
                              instructions: event.target.value,
                            })
                          }
                        />
                      </label>
                    </article>
                  ))}
                </div>

                <div className="ai-review-summary-bar">
                  <span>
                    {enabledCards.length} enabled card
                    {enabledCards.length === 1 ? "" : "s"}
                  </span>
                  <span>
                    {profile?.lastGeneratedCount
                      ? `${profile.lastGeneratedCount} mocked findings in last run`
                      : "No mocked findings generated yet"}
                  </span>
                </div>
              </div>
            ) : null}

            {step === "review-running" ? (
              <div className="ai-review-stage-panel ai-review-log-panel">
                <div className="ai-review-form-copy">
                  <span className="ai-review-section-tag">
                    <Play size={13} />
                    Mock run
                  </span>
                  <h3>
                    {reviewStatus === "complete"
                      ? "Mocked review is ready"
                      : `Running ${selectedProvider.label} against the current diff`}
                  </h3>
                  <p>
                    The event feed below simulates the observable progress that
                    the real provider adapters would stream back into
                    DiffVision.
                  </p>
                </div>

                <div className="ai-review-log-stream">
                  {reviewLog.map((entry) => (
                    <div key={entry} className="ai-review-log-entry">
                      {reviewStatus === "complete" &&
                      entry === reviewLog.at(-1) ? (
                        <CheckCheck size={13} />
                      ) : (
                        <Activity className="spin" size={13} />
                      )}
                      <span>{entry}</span>
                    </div>
                  ))}
                </div>

                {reviewStatus === "complete" ? (
                  <div className="ai-review-complete-panel">
                    <strong>
                      {pendingComments.length} inline mocked findings prepared
                    </strong>
                    <p>
                      Opening the workspace will append these comments into the
                      active review draft with an{" "}
                      <code>ai:{selectedProvider.id}</code> author label.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <footer className="ai-review-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={
                  step === "provider-selection" ? commitDraftAndClose : goBack
                }
                disabled={
                  step === "guide-categorizing" || reviewStatus === "running"
                }
              >
                {step === "provider-selection" ? (
                  "Close mock"
                ) : (
                  <>
                    <ArrowLeft size={13} />
                    Back
                  </>
                )}
              </button>

              <div className="ai-review-actions-right">
                {step === "provider-selection" ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setStep("provider-config")}
                  >
                    Continue
                    <ChevronRight size={13} />
                  </button>
                ) : null}

                {step === "provider-config" ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setStep("guide-setup")}
                    disabled={!isProviderConfigValid}
                  >
                    Save provider mock
                    <ChevronRight size={13} />
                  </button>
                ) : null}

                {step === "guide-setup" ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={startCategorization}
                    disabled={!guideText.trim()}
                  >
                    Categorize guide
                    <Wand2 size={13} />
                  </button>
                ) : null}

                {step === "cards-editing" ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={startMockReview}
                    disabled={!enabledCards.length || !snapshot?.files.length}
                  >
                    Start mocked review
                    <Play size={13} />
                  </button>
                ) : null}

                {step === "review-running" && reviewStatus === "complete" ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={finishReview}
                  >
                    Open findings in workspace
                    <CheckCheck size={13} />
                  </button>
                ) : null}
              </div>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}
