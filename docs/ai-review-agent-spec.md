# AI Review Agent Integration Spec

Status: Draft
Date: 2026-05-19
Scope: DiffVision local-first AI-assisted review flow

## 1. Summary

This spec defines how DiffVision should add an integrated AI review flow backed by agentic coding providers selected by the user.

The feature must:

- let the user choose a provider from the UI
- capture provider-specific configuration without forcing one generic form
- help the user build a review guide before the first review
- categorize the review guide into editable rule cards
- run AI review against the active diff
- show live progress as observable agent activity
- land the final findings directly in the existing inline review system

The design must stay consistent with DiffVision's existing local-first model:

- repository state lives under `.diffvision`
- the browser UI remains a local client
- the backend wraps provider CLIs, SDKs, or local agent protocols
- existing review comments, history, exports, and diff viewer remain the source of truth for review output

## 2. Existing Product Anchors

The current codebase already contains the main surfaces needed for this feature:

- `src/server/index.ts` already exposes local API endpoints and a WebSocket channel
- `src/lib/storage.ts` already persists repo-scoped state under `.diffvision`
- `src/shared/types.ts` already defines `ReviewComment`, `ReviewHistory`, and repository snapshot models
- `src/ui/components/DiffViewer.tsx` already renders editable inline comments against a diff
- `src/ui/App.tsx` already owns workspace bootstrap and review state
- `src/ui/components/ThemeBootstrap.tsx` already demonstrates a first-run guided UI flow
- `src/lib/process.ts` already spawns commands, but only buffers final stdout and stderr; it is not suitable for live agent progress as-is

These anchors mean the feature should be implemented as an extension of the current review model, not as a parallel product.

## 3. Problem Statement

DiffVision already supports local inline review, versioned review history, export, and MCP access. What it does not provide yet is a first-class way to run a provider-backed AI review workflow inside the product.

The product problem is not just "send a diff to a model".

The actual problem is:

- users need help bootstrapping review rules before the first run
- provider auth and execution models differ materially
- AI review guidance must become visible, editable, and durable
- review execution needs live progress without exposing hidden chain-of-thought
- final findings must land in the same editable review system the product already uses

## 4. Goals

### 4.1 Product goals

- Add a first-run AI review bootstrap flow.
- Add a normal recurring flow that starts from saved review cards instead of restarting setup.
- Keep provider choice explicit and user-controlled.
- Keep review guidance editable after AI-assisted generation.
- Reuse the existing inline comment model for final findings.
- Preserve DiffVision's local-first behavior.

### 4.2 Technical goals

- Normalize all providers behind one backend adapter contract.
- Support both subprocess-backed and SDK-backed providers.
- Stream review progress to the UI as structured events.
- Persist non-secret review configuration per repository.
- Keep provider secrets out of DiffVision-owned storage whenever possible.

## 5. Non-goals

- DiffVision will not become a credential vault in V1.
- DiffVision will not expose hidden chain-of-thought in V1 or V2.
- DiffVision will not replace provider-native auth, policy, or permission systems.
- DiffVision will not depend on cloud-hosted orchestration owned by DiffVision.
- DiffVision will not introduce a second comment system separate from `ReviewComment`.
- DiffVision will not require every provider to support the exact same advanced capability set on day one.

## 6. Research-backed Decisions

### 6.1 Provider integration model

Research shows there are two viable transport families:

1. SDK or daemon-backed providers
2. subprocess-backed providers

This leads to one core decision:

DiffVision should implement a shared provider contract and allow multiple transport strategies behind it.

Proposed transport classes:

- `SdkAgentProvider`
- `DaemonAgentProvider`
- `CliProcessAgentProvider`
- `ProtocolAgentProvider`

### 6.2 Provider-specific conclusions

#### Claude Code

- Strongest Node and TypeScript integration target.
- Official CLI supports `-p`, `--output-format json`, `--output-format stream-json`, `--json-schema`, and partial streaming.
- Official Agent SDK supports structured outputs and typed streaming events.
- Best reference implementation for the adapter contract, even if business sequencing delays full release.

#### Gemini CLI

- Strong subprocess candidate.
- Official headless mode supports `-p`, `--output-format json`, and `--output-format stream-json`.
- Good fit for a backend wrapper that spawns a process and parses event lines.

#### Qwen Code

- Good fit for flexible, multi-provider, or locally routed setups.
- Headless mode supports `-p`, `json`, `stream-json`, partial events, and session continuation.
- `qwen serve` adds a daemon-style option over HTTP plus SSE, but it is still experimental and should be treated as a later optimization.

#### GitHub Copilot CLI

- Must be treated differently from the archived `gh copilot` path.
- For machine-friendly integration, ACP is the correct target rather than parsing normal CLI text.
- ACP support is useful but still in preview, so Copilot should be marked accordingly in product language unless maturity improves.

### 6.3 Structured output strategy

The review guide categorization and final review findings must not rely on free-form text parsing.

DiffVision should require a normalized structured output step for:

- review guide category extraction
- per-card review findings
- final result normalization

Decision:

- use JSON Schema as the normalization boundary
- validate all provider output on the backend
- allow at most one repair pass when a provider returns invalid shape

### 6.4 Progress and observability strategy

The product requirement is to show the AI "thinking". The safe and supportable way to do that is to show observable execution activity, not hidden reasoning.

Decision:

- show text deltas when a provider exposes them
- show tool start and stop events when available
- show permission requests when available
- show retries, session start, card start, card completion, warnings, and final summary
- do not attempt to expose private chain-of-thought

### 6.5 Credential strategy

Decision:

- store only non-secret provider configuration in `.diffvision`
- prefer provider-native auth stores, keychains, env vars, and local config homes
- allow the user to point DiffVision at a custom executable path or provider home when needed
- keep secret entry and long-lived auth in provider-native flows where possible

## 7. User Flows

### 7.1 Bootstrap flow

This flow runs when the repository does not yet have a complete AI review profile.

Screen sequence:

1. Choose agent
2. Provider setup
3. Review guide setup
4. Review guide categorization
5. Editable rule cards
6. Start review
7. Live review progress
8. Diff viewer with AI comments loaded

Behavior details:

- `Choose agent` shows supported providers and their readiness level
- `Provider setup` renders provider-specific fields and readiness checks
- `Review guide setup` accepts manual text, project standards, and optional saved templates
- V2 adds project introspection to propose an initial guide automatically
- `Review guide categorization` runs the chosen provider to convert the guide into rule groups
- `Editable rule cards` lets the user edit, reorder, enable, or disable cards before execution
- `Start review` launches the orchestrator against the active diff
- `Live review progress` shows structured run events
- `Diff viewer with AI comments loaded` opens the normal review workspace, not a second results-only UI

### 7.2 Regular flow

When the profile already exists, the entry point should skip provider and guide bootstrap.

Screen sequence:

1. Editable rule cards
2. Start review
3. Live review progress
4. Diff viewer with AI comments loaded

### 7.3 V2 introspection mode

V2 adds an optional guided mode where the provider inspects the project before the user writes the review guide.

Proposed V2 flow:

1. Detect project file types
2. Sample representative files by language and directory
3. Infer frameworks, naming patterns, architectural conventions, and likely review concerns
4. Draft a review guide proposal
5. Ask the provider to categorize that proposal into rule cards
6. Let the user edit and approve before review starts

## 8. Core Product Model

### 8.1 Profile model

Persist the review profile under `.diffvision/ai-review.json`.

Proposed shape:

```json
{
  "version": 1,
  "bootstrapComplete": true,
  "provider": {
    "id": "gemini-cli",
    "displayName": "Gemini CLI",
    "transport": "cli-process",
    "command": "gemini",
    "args": [],
    "workingDirectoryMode": "repo-root",
    "config": {
      "model": "gemini-2.5-flash",
      "approvalMode": "default",
      "outputFormat": "stream-json"
    }
  },
  "guide": {
    "source": "manual",
    "rawText": "...",
    "lastGeneratedAt": "2026-05-19T20:00:00.000Z"
  },
  "cards": [
    {
      "id": "architecture",
      "title": "Architecture",
      "enabled": true,
      "order": 1,
      "body": "...",
      "lastEditedAt": "2026-05-19T20:05:00.000Z"
    }
  ],
  "defaults": {
    "authorLabel": "ai:gemini",
    "commentSeverityFallback": "major"
  }
}
```

### 8.2 Run model

Persist run metadata and event logs under `.diffvision/ai-review-runs/`.

Suggested files:

- `.diffvision/ai-review-runs/<run-id>.json`
- `.diffvision/ai-review-runs/<run-id>.jsonl`

The JSON file stores summary state.
The JSONL file stores event playback.

### 8.3 Finding model

Final AI findings should normalize into a provider-agnostic intermediate shape before conversion to `ReviewComment`.

Proposed shape:

```json
{
  "filePath": "src/server/index.ts",
  "line": 120,
  "endLine": 128,
  "category": "security",
  "severity": "major",
  "title": "Permission boundary is too broad",
  "body": "The provider can write outside the intended review scope.",
  "snippet": "...",
  "ruleCardId": "security",
  "confidence": "high"
}
```

Normalization rule:

- every final finding must be convertible to the existing `ReviewComment` model
- provider-specific metadata may be stored in the run log, but not required by the diff viewer

## 9. Review Execution Model

### 9.1 Why cards matter operationally

The editable cards are not only a UI artifact.

They should also be the execution unit for review orchestration because that gives DiffVision:

- better progress reporting
- clearer enable and disable behavior
- smaller context windows per pass
- easier retry boundaries
- simpler cost attribution per review category

### 9.2 Proposed orchestration

V1 should execute cards sequentially.

For each enabled card:

1. build the provider prompt from the active diff plus that card's instructions
2. request structured findings
3. validate provider output against schema
4. repair once if validation fails
5. normalize findings
6. emit per-card completion event

After all cards finish:

1. merge all findings
2. de-duplicate overlapping results
3. convert normalized findings into `ReviewComment`
4. write them into the active DiffVision review draft

Sequential execution is preferred in V1 because it is easier to support and reason about on local machines.

V2 may add controlled parallel card execution for providers that support it well.

## 10. Backend Architecture

### 10.1 Proposed modules

Suggested new module layout:

- `src/ai/types.ts`
- `src/ai/profile.ts`
- `src/ai/storage.ts`
- `src/ai/orchestrator.ts`
- `src/ai/schema.ts`
- `src/ai/providers/base.ts`
- `src/ai/providers/claude.ts`
- `src/ai/providers/gemini.ts`
- `src/ai/providers/qwen.ts`
- `src/ai/providers/copilot.ts`
- `src/ai/transports/process.ts`
- `src/ai/transports/acp.ts`

### 10.2 Provider contract

Proposed contract:

```ts
interface AiReviewProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: {
    structuredOutput: boolean;
    streaming: boolean;
    permissions: boolean;
    projectIntrospection: boolean;
    daemonMode: boolean;
  };

  checkAvailability(input: ProviderCheckInput): Promise<ProviderCheckResult>;
  validateConfig(input: ProviderConfigInput): Promise<ProviderConfigResult>;
  categorizeGuide(input: CategorizeGuideInput): AsyncIterable<AiRunEvent>;
  reviewCard(input: ReviewCardInput): AsyncIterable<AiRunEvent>;
  cancel(runId: string): Promise<void>;
}
```

### 10.3 Process transport requirement

`src/lib/process.ts` should not be overloaded with streaming semantics if its current role is final buffered command execution.

Decision:

- keep the current helper for buffered commands
- add a separate streaming process utility for AI providers

That helper must support:

- incremental stdout parsing
- incremental stderr parsing
- process cancellation
- timeout control
- exit code reporting
- Windows-safe process spawning

### 10.4 API surface

Suggested endpoints:

- `GET /api/ai-review/providers`
- `GET /api/ai-review/profile`
- `PUT /api/ai-review/profile`
- `POST /api/ai-review/guide/categorize`
- `POST /api/ai-review/introspect`
- `POST /api/ai-review/runs`
- `GET /api/ai-review/runs/:runId`
- `POST /api/ai-review/runs/:runId/cancel`

Suggested live channel:

- dedicated WebSocket route such as `/ws/ai-review/:runId`

Do not overload the existing repository snapshot channel with high-volume agent events.

### 10.5 Event model

Suggested event union:

- `run:started`
- `run:provider-ready`
- `card:started`
- `card:text-delta`
- `card:tool-started`
- `card:tool-finished`
- `card:permission-requested`
- `card:warning`
- `card:completed`
- `run:merge-started`
- `run:comments-written`
- `run:completed`
- `run:failed`
- `run:cancelled`

This event model is what powers the "AI thinking" screen.

## 11. Frontend Architecture

### 11.1 New surfaces

Suggested UI components:

- `src/ui/components/ai-review/ProviderPicker.tsx`
- `src/ui/components/ai-review/ProviderConfigForm.tsx`
- `src/ui/components/ai-review/GuideEditor.tsx`
- `src/ui/components/ai-review/GuideCategorizationScreen.tsx`
- `src/ui/components/ai-review/RuleCardsBoard.tsx`
- `src/ui/components/ai-review/ReviewRunScreen.tsx`

### 11.2 State machine

The AI review flow should be implemented as an explicit finite state machine owned at the `App` level or by a dedicated reducer or hook mounted from `App`.

This is required because the feature combines:

- bootstrap-only screens
- recurring screens that skip bootstrap
- long-running async work for categorization and review execution
- repo-scoped persistence that must survive refresh or restart

Primary UI states:

- `loading-profile`
- `provider-selection`
- `provider-config`
- `guide-setup`
- `guide-categorizing`
- `cards-editing`
- `review-running`
- `workspace-results`
- `fatal-error`

Suggested entry logic:

- no complete profile -> enter bootstrap states starting at `provider-selection`
- complete profile -> enter `cards-editing`
- existing in-flight categorization -> re-enter `guide-categorizing`
- existing in-flight run -> re-enter `review-running`

#### 11.2.1 Machine context

Suggested machine context:

```ts
interface AiReviewUiContext {
  phase: AiReviewUiState;
  providerCatalog: AiReviewProviderDescriptor[];
  profile: AiReviewProfile | null;
  providerDraft: AiReviewProviderDraft | null;
  guideDraft: string;
  cards: AiReviewRuleCard[];
  activeRunId: string | null;
  lastCompletedRunId: string | null;
  highlightedCommentId: string | null;
  error: {
    scope: "profile" | "provider" | "guide" | "run";
    message: string;
  } | null;
}
```

Rules:

- `profile` is the persisted repo-scoped source of truth
- `providerDraft`, `guideDraft`, and `cards` are editable working state hydrated from the profile
- `activeRunId` binds the UI to one persisted run summary and one live event stream
- `highlightedCommentId` is optional convenience state for focusing the first AI finding when the run completes

#### 11.2.2 Events

Suggested machine events:

- `app:boot`
- `profile:loaded`
- `profile:missing`
- `profile:load-failed`
- `provider:selected`
- `provider:config:submitted`
- `provider:config:validated`
- `provider:config:failed`
- `guide:changed`
- `guide:categorize:started`
- `guide:categorize:succeeded`
- `guide:categorize:failed`
- `cards:updated`
- `review:start`
- `run:attached`
- `run:event`
- `run:completed`
- `run:failed`
- `run:cancelled`
- `flow:reset`

#### 11.2.3 Guards

Suggested guards:

- `hasCompleteProfile`
- `hasValidProviderDraft`
- `hasGuideText`
- `hasCategorizedCards`
- `hasEnabledCards`
- `hasActiveRun`
- `canResumeCategorization`
- `canResumeRun`

#### 11.2.4 Transition table

| Current state        | Event                        | Guard                   | Next state           | Required side effect                                                         |
| -------------------- | ---------------------------- | ----------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `loading-profile`    | `profile:loaded`             | `hasCompleteProfile`    | `cards-editing`      | hydrate provider draft, guide draft, and cards from persisted profile        |
| `loading-profile`    | `profile:missing`            | none                    | `provider-selection` | create empty in-memory draft state                                           |
| `loading-profile`    | `run:attached`               | `canResumeRun`          | `review-running`     | load run summary, subscribe to live stream, hydrate cards from profile       |
| `loading-profile`    | `profile:load-failed`        | none                    | `fatal-error`        | show repo-scoped recovery action                                             |
| `provider-selection` | `provider:selected`          | none                    | `provider-config`    | create provider draft using chosen provider defaults                         |
| `provider-config`    | `provider:config:validated`  | `hasValidProviderDraft` | `guide-setup`        | persist provider block into profile draft                                    |
| `provider-config`    | `provider:config:failed`     | none                    | `provider-config`    | keep form dirty state and show field-level errors                            |
| `guide-setup`        | `guide:categorize:started`   | `hasGuideText`          | `guide-categorizing` | create categorization job and attach to event stream                         |
| `guide-categorizing` | `guide:categorize:succeeded` | `hasCategorizedCards`   | `cards-editing`      | persist guide and categorized cards to profile                               |
| `guide-categorizing` | `guide:categorize:failed`    | none                    | `guide-setup`        | keep guide draft and surface retryable error                                 |
| `cards-editing`      | `review:start`               | `hasEnabledCards`       | `review-running`     | create run summary, persist current cards, attach run stream                 |
| `review-running`     | `run:completed`              | none                    | `workspace-results`  | write comments to active review draft and capture first AI comment for focus |
| `review-running`     | `run:failed`                 | none                    | `cards-editing`      | preserve card state and show retry affordance                                |
| `review-running`     | `run:cancelled`              | none                    | `cards-editing`      | preserve partial results only in run log, not in comments                    |
| `workspace-results`  | `flow:reset`                 | none                    | `cards-editing`      | keep provider, guide, and cards but clear transient run state                |

#### 11.2.5 Persistence and recovery rules

The state machine should persist at different boundaries depending on data criticality.

Persist immediately:

- validated provider configuration
- successful guide categorization output
- card edits that change enablement, order, title, or body
- run summary creation and completion state

Persist on debounce or blur:

- guide draft text while the user edits it

Do not persist as product state:

- modal open state
- unsent transient field validation errors
- temporary visual focus state outside the active session

Recovery behavior:

- if `.diffvision/ai-review.json` exists but `bootstrapComplete` is false, return to the first incomplete bootstrap step
- if the latest run summary is `running` or `merging`, enter `review-running`
- if the latest run summary is `completed` and comments were written, enter `workspace-results`
- if the latest run summary is `failed` or `cancelled`, re-enter `cards-editing` with the last persisted cards intact

#### 11.2.6 Component ownership

Suggested ownership split:

- `src/ui/App.tsx`: machine owner, entry routing, recovery, and workspace integration
- `ProviderPicker.tsx`: stateless provider selection and readiness rendering
- `ProviderConfigForm.tsx`: local form editing with submit or validate actions only
- `GuideEditor.tsx`: local guide editing, save and categorize actions
- `GuideCategorizationScreen.tsx`: event stream projection for categorization only
- `RuleCardsBoard.tsx`: card editing, ordering, enablement, and review start action
- `ReviewRunScreen.tsx`: long-running run projection and cancel action

This keeps the route logic centralized while the step screens remain focused and replaceable.

### 11.3 Results integration

The final screen is not a custom AI-only results page.

Decision:

- AI findings should be written into the current active review draft
- the final surface remains the normal workspace with `DiffViewer`
- AI comments are editable, removable, and exportable using the same UX as manual comments

## 12. Provider Matrix

| Provider           | Recommended transport              | Structured output        | Live progress  | Readiness | Notes                                                            |
| ------------------ | ---------------------------------- | ------------------------ | -------------- | --------- | ---------------------------------------------------------------- |
| Claude Code        | SDK first, CLI second              | Strong                   | Strong         | Highest   | Best contract reference for Node and TypeScript                  |
| Gemini CLI         | CLI subprocess                     | Good                     | Good           | High      | Simplest headless wrapper in V1                                  |
| Qwen Code          | CLI subprocess in V1, daemon later | Good                     | Good           | High      | Strong flexibility, daemon path is promising but experimental    |
| GitHub Copilot CLI | ACP                                | Medium to strong via ACP | Strong via ACP | Medium    | ACP is the correct integration path, but maturity is still lower |

## 13. Recommended Release Plan

### 13.1 V1

Must include:

- provider selection UI
- provider-specific config UI
- manual review guide input
- AI categorization into editable cards
- sequential per-card review execution
- live run event screen
- write final findings into existing review draft
- profile persistence under `.diffvision/ai-review.json`

Recommended V1 provider stance:

- Gemini and Qwen as strong CLI-based targets
- Claude either included as first-class if timeline allows or used as the contract reference even if delayed
- Copilot behind preview labeling if ACP maturity or support burden remains high

### 13.2 V2

Can add:

- project introspection to draft the review guide automatically
- daemon-backed Qwen mode
- richer Claude SDK integration if not already included
- controlled parallel card execution
- rule templates and reusable org presets
- stronger provider capability checks and diagnostics

### 13.3 V1 implementation plan by file

The recommended V1 implementation order is to land shared contracts and persistence first, then backend orchestration, then the UI state machine and screens, and only then widen provider coverage.

#### 13.3.1 Phase A: contracts and repo-scoped persistence

- `src/shared/types.ts`: add `AiReviewProviderId`, provider capability descriptors, profile types, rule card types, run summary types, run event types, and normalized AI finding types.
- `src/lib/storage.ts`: add `getAiReviewPaths`, `readAiReviewProfile`, `writeAiReviewProfile`, `readAiReviewRunSummary`, `writeAiReviewRunSummary`, `appendAiReviewRunEvent`, and `listAiReviewRuns`.
- `src/shared/reviews.ts`: add helpers to convert normalized AI findings into `ReviewComment` objects with stable author labels such as `ai:gemini`.
- `tests/ai-storage.test.ts`: cover missing-file recovery, invalid JSON recovery, profile defaults, JSONL append semantics, and run resume lookup.

Phase A validation:

- `pnpm test` with new storage and normalization tests

#### 13.3.2 Phase B: backend orchestration and provider abstraction

- `src/ai/types.ts`: define internal provider contracts, orchestration inputs, and runtime event types.
- `src/ai/schema.ts`: define and validate schemas for guide categorization payloads and review finding payloads.
- `src/ai/profile.ts`: implement bootstrap completeness checks, provider readiness helpers, and profile defaults.
- `src/ai/storage.ts`: wrap raw storage helpers with AI-review-specific read and write semantics.
- `src/ai/orchestrator.ts`: implement sequential per-card execution, repair-once behavior, merge and dedupe hooks, and comment writing.
- `src/ai/providers/base.ts`: shared adapter utilities for event normalization, stderr handling, and validation plumbing.
- `src/ai/transports/process.ts`: add a streaming spawn utility that supports incremental stdout and stderr, cancellation, timeouts, and Windows-safe command execution.
- `src/ai/transports/acp.ts`: add ACP session helpers for Copilot preview support.
- `src/server/index.ts`: add AI review endpoints, run lifecycle APIs, and a dedicated run event WebSocket channel.
- `tests/ai-orchestrator.test.ts`: cover sequential card execution, repair pass limits, dedupe hooks, and failure paths.
- `tests/ai-api.test.ts`: cover profile reads and writes, run creation, run cancellation, and event channel startup semantics.

Phase B validation:

- `pnpm test`
- `pnpm build`

#### 13.3.3 Phase C: first shipping providers

- `src/ai/providers/gemini.ts`: implement the first production-ready CLI subprocess adapter using `-p` plus `--output-format stream-json`.
- `src/ai/providers/qwen.ts`: implement the second production-ready CLI subprocess adapter using `stream-json` and partial event support.
- `src/ai/providers/claude.ts`: implement the contract-reference adapter, initially behind a feature flag if release sequencing needs it.
- `src/ai/providers/copilot.ts`: implement ACP-backed preview integration with explicit preview labeling in returned metadata.
- `tests/ai-provider-gemini.test.ts`: cover event parsing, structured output extraction, and error normalization.
- `tests/ai-provider-qwen.test.ts`: cover partial message parsing, retry event handling, and final result normalization.
- `tests/ai-provider-claude.test.ts`: cover JSON-schema happy path and streaming event mapping if the adapter ships in V1 code.
- `tests/ai-provider-copilot.test.ts`: cover ACP session initialization and permission-request event mapping if preview support ships immediately.

Phase C validation:

- `pnpm test`
- `pnpm build`

#### 13.3.4 Phase D: UI state machine and bootstrap flow

- `src/ui/App.tsx`: add machine-owned entry routing, profile loading, run recovery, AI review step selection, and result handoff back into the workspace.
- `src/ui/components/ai-review/ProviderPicker.tsx`: render provider cards, readiness labels, capability badges, and preview markers.
- `src/ui/components/ai-review/ProviderConfigForm.tsx`: render provider-specific forms from capability and config descriptors.
- `src/ui/components/ai-review/GuideEditor.tsx`: implement guide drafting, template paste, and categorize action entry.
- `src/ui/components/ai-review/GuideCategorizationScreen.tsx`: render categorization progress from streamed events and show retry on failure.
- `src/ui/components/ai-review/RuleCardsBoard.tsx`: implement card editing, enabling, ordering, and start review action.
- `src/ui/components/ai-review/ReviewRunScreen.tsx`: render live run progress, cancel action, and final handoff into the workspace.
- `src/ui/components/CommandPalette.tsx`: add commands to open AI review setup, reopen cards, and resume active runs.
- `src/ui/styles.css`: add step flow, provider form, cards board, and run event presentation styles.
- `src/ui/theme.ts`: add tokens only if the new screens require distinct surfaces beyond existing theme primitives.

Phase D validation:

- `pnpm build`
- `pnpm lint`

#### 13.3.5 Phase E: workspace integration and release surface

- `src/ui/components/DiffViewer.tsx`: ensure AI-created comments can be focused reliably after run completion.
- `src/ui/components/ReviewHistoryPanel.tsx`: show AI-authored comments without introducing a second review history model.
- `src/shared/reviews.ts`: keep export and versioning behavior consistent when AI comments land in the active draft.
- `README.md`: document AI review bootstrap, provider expectations, and local secret handling expectations once the feature ships.
- `CHANGELOG.md`: add a release note entry when the feature is published.

Phase E validation:

- `pnpm lint`
- `pnpm test`
- `pnpm build`

### 13.4 Suggested delivery order

Recommended landing order:

1. Phase A with no UI changes beyond hidden plumbing.
2. Phase B with a fake or stub provider to validate end-to-end orchestration.
3. Phase D with the real UI state machine wired to the stub provider.
4. Phase C for Gemini as the first production-ready provider.
5. Phase C for Qwen as the second production-ready provider.
6. Claude adapter behind a flag if needed.
7. Copilot ACP adapter as preview support.

This order keeps the riskiest provider-specific work out of the earliest structural changes.

## 14. Risks and Constraints

### 14.1 Technical risks

- provider auth flows differ and may not be fully automatable from a browser-only interaction
- Copilot ACP is still preview
- Qwen daemon mode is attractive but not yet the safest default
- streaming event formats differ and need adapter-specific parsing
- large diffs may exceed practical provider context limits

### 14.2 Product risks

- too much generic abstraction in the provider config UI may hide important provider differences
- exposing too much raw agent noise may hurt readability of the progress screen
- low-quality category extraction will make the cards feel decorative instead of operational
- writing AI comments into the main draft without clear attribution may confuse manual and AI review ownership

### 14.3 Security risks

- auto-approval modes can be dangerous outside isolated environments
- provider logs and telemetry can leak repository content if not configured carefully
- storing secrets in `.diffvision` would violate the local-first trust model

## 15. Acceptance Criteria

The feature is considered complete for the first release when all of the following are true:

- a new repository can complete bootstrap without leaving DiffVision for product-owned steps
- the provider form changes based on the selected provider
- guide text can be converted into editable cards
- cards can be enabled, disabled, edited, and saved
- a review run emits live progress events visible in the UI
- final findings appear as normal inline comments in the active review draft
- the profile survives restart through `.diffvision`
- secrets are not written into DiffVision profile storage by default

## 16. Open Questions

- Should the first release ship with Claude enabled, or only design for it while launching other providers first?
- Should Copilot be visible in the provider picker on day one if it is labeled preview?
- What is the minimum provider-specific config surface we want DiffVision to own versus deferring to provider-native setup?
- What de-duplication heuristic should merge overlapping findings from multiple cards?
- Do we want AI findings written into the current draft immediately, or staged for user confirmation before commit to review history?

## 17. Source Material

Primary external references used in the research that informed this spec:

- GitHub Copilot CLI docs and ACP server docs
- Gemini CLI official README and docs
- Qwen Code official README and headless mode docs
- Claude Code CLI, headless, structured outputs, streaming, permissions, and authentication docs

Primary internal product anchors used in the research:

- `src/server/index.ts`
- `src/lib/process.ts`
- `src/lib/storage.ts`
- `src/shared/types.ts`
- `src/shared/reviews.ts`
- `src/ui/App.tsx`
- `src/ui/components/DiffViewer.tsx`
- `src/ui/components/ThemeBootstrap.tsx`

## 18. Final Direction

DiffVision should add AI review as a guided, local-first extension of the existing review workflow.

The most important architectural decisions are:

- provider adapters with multiple transport strategies
- repo-scoped persistence under `.diffvision`
- structured output as the normalization boundary
- live observable event streaming instead of hidden chain-of-thought
- final findings written into the existing `ReviewComment` system

If these five decisions are held constant, provider rollout order can change without forcing a redesign of the product.
