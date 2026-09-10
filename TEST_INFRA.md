# Cortex E2E Test Infrastructure & Methodology (`TEST_INFRA.md`)

## 1. Overview and Testing Philosophy

The **Cortex Cognitive Hub** in Kaoz.1 is a local-first cognitive architecture combining semantic graphs, persistent chat memories, episodic feedback, procedural rules, omnichannel conversation archiving (Flow, Telegram, Discord), and observed identity linking.

To guarantee robustness, performance, data preservation, and strict regression resistance during the refactoring process, this E2E test suite operates as an **authoritative, requirement-driven, opaque-box verification system**.

### Inviolable Principles
1. **Opaque-Box Requirement-Driven**: Tests assert on observable inputs, outputs, persisted states, and interface contracts—not internal implementation trivia. Tests verify *what* the system must deliver per `PROJECT.md` and `docs/TEAMWORK_REFATORAMENTO_CORTEX.md`.
2. **Deterministic Independence**: Every test generates an isolated, cryptographically unique temporary environment (`%TEMP%/kaoz1-test-*`). Tests create their own state, run independently of execution order, and reliably clean up resources.
3. **No Synthetic Mocking of Truth**: When asserting on storage, actual SQLite (`node:sqlite` WAL mode) and atomic filesystem JSON engines are executed in isolated sandboxes.
4. **Progressive Testability**: Tests are designed to validate baseline contracts immediately while providing progressive verification hooks for the subsequent implementation milestones (M1: Shell, M2: APIs, M3: Graph, M4: Memories & Conversations, M5: Final Hardening).
5. **Zero Telemetry & Local Compliance**: Verifies that 100% of operations remain local, private, and execute cleanly on Windows environments with `npm.cmd` and `node`.

---

## 2. Test Architecture & Directory Layout

The E2E test suite is located in `tests/e2e/cortex/` and structured as follows:

```
tests/e2e/cortex/
├── test-runner.mjs                  # Standalone CLI test runner (exit 0 on pass, exit 1 on fail)
├── harness.mjs                      # Test harness: sandboxes, assertions, models, fixtures
├── tier1-feature-coverage.test.mjs  # Tier 1: Happy-path coverage of all 33 features
├── tier2-boundary-corner.test.mjs   # Tier 2: Edge cases, limits, corruption recovery, concurrency
├── tier3-cross-feature.test.mjs     # Tier 3: Pairwise interactions between subsystems
└── tier4-application.test.mjs       # Tier 4: Real-world end-to-end user workload sessions
```

### Supporting Infrastructure at Project Root:
- `TEST_INFRA.md`: Architectural specification and methodology (this document).
- `TEST_READY.md`: Delivery report with feature matrix, tier coverage table, and execution guide.

---

## 3. Four-Tier Test Taxonomy

The test suite divides requirements into four complementary tiers, ensuring layered depth from individual feature contracts up to multi-step real-world workloads:

```
┌─────────────────────────────────────────────────────────────┐
│  Tier 4: Real-World Workload Scenarios                     │
│  (Cognitive Consolidation, Graph Discovery, Archive Recall) │
├─────────────────────────────────────────────────────────────┤
│  Tier 3: Cross-Feature Interactions                         │
│  (Memory + Graph, Conversation Cascade, Identity Unlink)    │
├─────────────────────────────────────────────────────────────┤
│  Tier 2: Boundary & Corner Cases                            │
│  (Corrupt JSON/SQLite Recovery, Max Limits, FTS5 Fuzzing)   │
├─────────────────────────────────────────────────────────────┤
│  Tier 1: Feature Coverage (33 Features from PROJECT.md)     │
│  (Navigation, Metrics, Atomic Storage, Physics, Modals...)  │
└─────────────────────────────────────────────────────────────┘
```

### Tier 1: Feature Coverage (33 Features from PROJECT.md)
Validates the canonical happy path and primary interface contracts for each of the 33 features in the PROJECT.md Feature Inventory:
- **F1–F5 (Shell & Overview)**: Tabbed section navigation, narrow viewport layout rules, uniform UI states (loading, empty, error with retry, updating), real-data metrics calculation, and operational health monitoring.
- **F6–F14 (APIs & Data Robustness)**: Unified API response envelopes (`{ success, data }` / `{ success, error }`), atomic JSON read-modify-write (`updateMemory`), corrupt JSON protection (`.corrupt-timestamp`), elimination of synthetic seeds on empty graphs, route error protection, Flow route backwards compatibility, memory reject status audit trail (`'rejected'`), cyclomatic complexity constraints (<= 10), and automated route test coverage.
- **F15–F22 (Cognitive Graph)**: Modular decomposition architecture, decoupled pure physics engine, high-DPI canvas coordinate scaling, dynamic container resize (`ResizeObserver`), `requestAnimationFrame` visibility pausing, node coordinate stability during background polling, full mutation preservation (nodes, edges, rules, feedback), and keyboard accessibility shortcuts.
- **F23–F29 (Memories, Conversations & Modals)**: Memory search/filter/pagination, search race condition prevention (`AbortController`), genuine empty search state (no fallback to full list), accessible focus-trapping confirm modal, memory deletion confirmation, conversation cascade deletion modal with rollback, and identity linking with derived memory impact.
- **F30–F33 (System Quality & Hardening)**: Zero telemetry / 100% local operation, Windows & Electron compatibility, 100% E2E test suite validation, and adversarial coverage hardening.

### Tier 2: Boundary & Corner Cases
Subjects the Cortex subsystems to extreme operating conditions and unexpected inputs:
- **Empty States**: Empty graphs, zero chat memories, unseeded conversation archives, empty procedural rules, and empty search results.
- **Max Limits & Caps**: 1500-token hot budget limit enforcement, physics velocity clamping (`MAX_NODE_SPEED = 9`), extreme zoom boundaries (`0.15x` to `4.0x`), and query pagination limits.
- **Corrupt Data Recovery**: Automatic detection and non-catastrophic isolation of corrupted JSON files (`.corrupt-timestamp` backup) and malformed SQLite databases without application crashes.
- **Special Characters & Encodings**: FTS5 search queries with formatting tokens (`"`, `*`, `AND`, `OR`, `()`, emojis, accents `ação`, `café`, CJK glyphs, and control characters); memory content containing HTML/markdown.
- **High Concurrency & Race Conditions**: Simultaneous writes to JSON storage (20+ parallel operations via mutex queue), concurrent SQLite message insertions, and out-of-order asynchronous search responses.

### Tier 3: Cross-Feature Interactions
Validates pairwise and multi-system integration touchpoints:
- **Memory + Graph Synchronization**: Concepts registered in cognitive memories correlating with semantic nodes, and error pattern resolution impacting overview metrics.
- **Conversation Deletion + Memory Cascade**: Testing `forgetDerived=true` (removes messages and wipes derived chat memories tied to those message IDs) versus `forgetDerived=false` (deletes conversation turns while preserving derived memories).
- **Identity Link / Unlink + Derived Memories**: Linking external channels (`telegram`, `discord`) to the local profile, and unlinking with selective memory purge.
- **Procedural Rules + Episode Feedback**: Linking episodic negative feedback to procedural rule creation and prompt generation.
- **Flow Import + Archive Search**: Idempotent import of legacy Flow chat logs into SQLite, followed by immediate FTS5 full-text recall and stats synchronization.

### Tier 4: Real-World Workload Scenarios
Simulates realistic, multi-phase user sessions from beginning to end:
- **Scenario 1: Cognitive Memory Consolidation & Lifecycle**: Candidate extraction, tag classification, preference updates with `supersedesId` audit lineage, prompt context generation within 1500 tokens, and category-wide forget operations.
- **Scenario 2: Graph Knowledge Discovery & Physics Convergence**: Knowledge network initialization, force-directed convergence, error pattern node detection, procedural rule creation, and error resolution to concept.
- **Scenario 3: Omnichannel Archive Search & Recall**: Multi-channel message archiving, channel filtering, intent-driven recall with neighborhood context snippets and untrusted data markers.
- **Scenario 4: Multi-Identity Management & Data Hygiene**: Inbound external account detection, profile association, unlinking with memory purging, and verified isolation of unrelated profiles.

---

## 4. Test Runner Architecture (`test-runner.mjs`)

The standalone test runner is built in pure Node.js (ESM) with zero external test runner dependencies. It executes cleanly on Windows with `node tests/e2e/cortex/test-runner.mjs`.

### Features:
- **Zero Configuration**: Runs with standard Node.js without requiring third-party test harnesses or pre-compilation.
- **Deterministic Exit Codes**: Exits with code `0` when all tests pass; exits with code `1` if any test fails.
- **Selective Tier Execution**: Supports running all tiers or targeting specific tiers via CLI flags:
  ```powershell
  node tests/e2e/cortex/test-runner.mjs                  # Run all 4 tiers
  node tests/e2e/cortex/test-runner.mjs --tier=1         # Run Tier 1 only
  node tests/e2e/cortex/test-runner.mjs --tier=2         # Run Tier 2 only
  node tests/e2e/cortex/test-runner.mjs --tier=3         # Run Tier 3 only
  node tests/e2e/cortex/test-runner.mjs --tier=4         # Run Tier 4 only
  node tests/e2e/cortex/test-runner.mjs --filter=search  # Run matching tests only
  node tests/e2e/cortex/test-runner.mjs --verbose        # Detailed step tracing
  ```
- **Execution Timing & Metrics**: Measures and reports millisecond-level execution duration for each test, each tier, and the entire suite.
- **Human-Readable Reporting**: Formats results with ANSI-colored terminal output, clear error tracebacks, and an executive summary table.

---

## 5. Quality Thresholds & Acceptance Criteria

To ensure Cortex maintains enterprise-grade reliability, the test infrastructure enforces the following thresholds:

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| **Pass Rate** | 100% (Zero Failures) | No known regressions permitted |
| **Suite Run Time** | < 10 seconds total | Fast feedback cycle in development |
| **Flakiness** | 0% (Strictly Deterministic) | Isolated temp folders, no shared state |
| **Feature Coverage** | 33 / 33 Features | Complete coverage of PROJECT.md inventory |
| **Data Preservation** | Zero Unintended Loss | Atomic writes and backup on corruption |
| **Local Isolation** | 100% Local / Zero Remote | Strict privacy guarantee |

---

## 6. Guide for Milestone Implementers

When working on milestones M1 through M5, implementers must follow this verification cycle:

1. **Pre-Change Baseline**: Execute `node tests/e2e/cortex/test-runner.mjs` to ensure the existing suite is green.
2. **Implement Feature**: Implement the designated module or route according to `PROJECT.md § Interface Contracts`.
3. **Run Targeted Tests**: Execute the relevant tier (e.g. `node tests/e2e/cortex/test-runner.mjs --tier=1`).
4. **Run Full Verification**: Execute the full runner `node tests/e2e/cortex/test-runner.mjs` and project checks (`npm.cmd run typecheck`, `npm.cmd run test:memory`, `npm.cmd run test:memory-archive`).
5. **Report in Handoff**: Include the runner output and execution duration in the agent handoff report.
