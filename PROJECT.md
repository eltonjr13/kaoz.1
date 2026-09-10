# Project: Cortex Refactoring (Kaoz.1)

## Architecture
Refactoring of the Cortex tab in Kaoz.1 (Windows/Electron, Next.js 14 local-first) into a modular, reliable, high-performance cognitive hub.

### High-Level Components
1. **Unified Shell (`components/cortex/cortex-shell.tsx`)**:
   - Sectional navigation: `Visão Geral`, `Grafo`, `Memórias`, `Conversas`, `Identidades`.
   - Accessible keyboard tablist, narrow viewport responsive design.
   - Unified state handling: Loading, Empty, Error with Retry, Updating.
   - Real-data overview metrics (episodic/semantic nodes, active rules, conversations, identities).
2. **Robust Local Data & APIs (`app/api/**`, `lib/cognitive-memory/**`, `services/conversation-memory/**`)**:
   - Standardized API contracts: `/api/memory/**`, `/api/cortex/**`, `/api/conversations/**`.
   - Atomic persistence via `JsonStorageProvider.updateMemory()` without data loss.
   - Corrupt JSON protection (backup `.corrupt-timestamp` rather than catastrophic empty overwrite).
   - Zero synthetic seed injection on empty states (preserve genuine empty lists).
   - SQLite conversation store integrity (WAL mode, transactions, FTS5).
   - Strict backward compatibility with external consumers (especially Flow).
3. **Decoupled Cognitive Graph (`components/cortex/graph/**`)**:
   - Layout & Physics (`cortex-graph-physics.ts`, `cortex-graph-layout.ts`): Force-directed simulation separated from React state mutations.
   - Canvas Renderer (`cortex-graph-canvas.tsx`): High-DPI support (`devicePixelRatio`), `ResizeObserver`, paused rAF on `document.visibilityState === 'hidden'`.
   - Controls & HUD (`cortex-graph-controls.tsx`, `cortex-graph-details.tsx`): Node/edge inspection, rule editing, episode feedback.
   - Position Stability: Background polling preserves node coordinates; only new nodes are positioned.
4. **Data Management & Accessible Dialogs (`components/cortex/**`)**:
   - Memory List (`cortex-chat-memories.tsx`): Search, filters (scope, status, type), pagination, review actions.
   - Conversation Archive (`cortex-conversation-archive.tsx`): Search with `AbortController`, genuine empty search states, identity association.
   - Accessible Confirm Modal (`components/cortex/cortex-confirm-modal.tsx`): Focus-trapping, Escape/Cancel, progress feedback, safe rollback (replacing `window.confirm`).
5. **E2E Test Suite & Adversarial Hardening (`tests/e2e/cortex/**`)**:
   - Requirement-driven opaque-box test suite (Tiers 1-4).
   - White-box adversarial testing (Tier 5).

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Tabbed Section Navigation | Keyboard-accessible tab navigation between Visão Geral, Grafo, Memórias, Conversas, Identidades | M1 | R1, survey |
| 2 | Narrow Viewport Layout | Responsive design adapting gracefully to narrow and split windows without layout overflow | M1 | R1, survey |
| 3 | Explicit UI States | Uniform Loading, Empty, Error with Retry, and Updating feedback across all Cortex views | M1 | R1, survey |
| 4 | Real Overview Metrics | Overview summary stats (nodes, edges, rules, memories, conversations, identities) calculated strictly from real data | M1 | R1, survey |
| 5 | Overview Operational Status | Real-time health status of local storage engines (JSON memory & SQLite DB) | M1 | R1, survey |
| 6 | Unified API Response Envelope | Standardized `{ success: true, data }` and `{ success: false, error: { code, message, details } }` contracts | M2 | R2, survey |
| 7 | Atomic JSON Persistence | Enforce `updateMemory()` across all routes and subsystems to eliminate lost updates | M2 | R2, survey |
| 8 | Corrupt JSON Protection | Safe backup to `.corrupt-timestamp` on syntax error instead of silent `emptyMemory()` overwrite | M2 | R2, survey |
| 9 | Elimination of Synthetic Seeds | Remove fake node/edge generation in `/api/memory/graph` when graph is empty | M2 | R2, survey |
| 10 | Route Error Protection | Complete `try/catch` coverage across all Cortex API routes with appropriate HTTP status codes | M2 | R2, survey |
| 11 | Flow Route Compatibility | Preserve `/api/conversations` (POST, PATCH, DELETE with `externalConversationId`) required by Flow | M2 | R2, survey |
| 12 | Memory Reject Status Fix | Update status to `'rejected'` instead of deleting memory record on review reject | M2 | R2, survey |
| 13 | Cyclomatic Complexity Reduction | Refactor high-complexity route handlers (`complexity > 10`) to satisfy ESLint standards | M2 | R2, survey |
| 14 | API Automated Tests | Create focused integration tests for memory, graph, and conversation route handlers | M2 | R2, survey |
| 15 | Graph Modular Decomposition | Split monolithic 2,152-line graph client into layout/physics, canvas renderer, and controls/details | M3 | R3, survey |
| 16 | Pure Physics Engine | Decouple force simulation from React render cycle and eliminate direct state mutations | M3 | R3, survey |
| 17 | High-DPI Canvas Rendering | Implement `devicePixelRatio` scaling to eliminate blurry rendering on retina/4K displays | M3 | R3, survey |
| 18 | Canvas Dynamic Resize | Replace `window.resize` with `ResizeObserver` for robust layout responsiveness (e.g. sidebar collapse) | M3 | R3, survey |
| 19 | RAF Visibility Pausing | Pause `requestAnimationFrame` loop and polling when tab/window is hidden (`visibilitychange`) | M3 | R3, survey |
| 20 | Node Coordinate Stability | Preserve existing node coordinates during 30s background polling without resetting layout | M3 | R3, survey |
| 21 | Graph Mutation Preservation | Preserve node creation/editing, connection management, procedural rule editing, and episode feedback | M3 | R3, survey |
| 22 | Graph Keyboard Accessibility | Provide keyboard navigation and shortcuts for zooming, panning, and node selection | M3 | R3, survey |
| 23 | Memory Search & Filtering | Add text search, type filters, and pagination to the Chat Memories section | M4 | R4, survey |
| 24 | Search Race Condition Prevention | Use `AbortController` and sequential request IDs to ensure slow responses do not overwrite recent queries | M4 | R4, survey |
| 25 | Genuine Empty Search Results | Fix conversation search fallback bug where empty results rendered the full conversation list | M4 | R4, survey |
| 26 | Accessible Confirm Modal | Focus-trapping accessible modal dialog replacing synchronous `window.confirm` and `window.alert` | M4 | R4, survey |
| 27 | Memory Deletion Confirmation | Require explicit modal confirmation before forgetting/deleting cognitive memories | M4 | R4, survey |
| 28 | Conversation Deletion Modal | Provide accessible multi-step confirmation (cascade delete options) with rollback on failure | M4 | R4, survey |
| 29 | Identity Linking Management | Manage observed identity links with explicit feedback on derived memory impact | M4 | R4, survey |
| 30 | Zero Telemetry Guarantee | Enforce 100% local operation without external network requests or telemetry | M5 | R5, survey |
| 31 | Windows & Electron Compatibility | Verify operational readiness under Windows with `npm.cmd` and Electron desktop shell | M5 | R5, survey |
| 32 | E2E Test Suite Validation | 100% pass across all Tier 1-4 tests published by the E2E Testing Track | M5 | Final, survey |
| 33 | Adversarial Coverage Hardening | Tier 5 white-box stress testing and edge-case bug hunting via Challenger loop | M5 | Final, survey |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Design test runner, Tiers 1-4 opaque-box test suites, publish `TEST_READY.md` | none | DONE |
| M2 | Robustez de APIs e Contratos Locais | Standardization of API routes, atomic JSON storage, SQLite WAL transactions, elimination of fake seed data, error handling | none | DONE |
| M1 | Shell Unificado e Visão Geral | Unified navigation shell, Visão Geral dashboard with real metrics, explicit UI states, keyboard accessibility | M2 | PLANNED |
| M3 | Grafo Cognitivo Desacoplado e Otimizado | Decomposition of graph monolith into physics, canvas renderer (DPI, ResizeObserver, visibility pause), controls/details, node stability | M2 | PLANNED |
| M4 | Gestão de Memórias, Conversas, Identidades e Modais | Search/filter/pagination with AbortController, accessible focus-trap confirmation modals, identity management | M1, M2 | PLANNED |
| M5 | Final Milestone: Validação E2E e Hardening | Phase 1 (100% E2E test pass) + Phase 2 (Adversarial Coverage Hardening Tier 5) + Forensic Audit | E2E, M1, M2, M3, M4 | PLANNED |

---

## Interface Contracts

### 1. API Envelope Contract
All Cortex API routes return:
```ts
// Success
{ success: true, data: T }

// Error
{ success: false, error: { code: string, message: string, details?: unknown } }
```

### 2. Cognitive Memory Storage Contract
`lib/cognitive-memory/storage/JsonStorageProvider.ts`:
- `updateMemory<T>(mutator: (data: CognitiveMemoryData) => Promise<T> | T): Promise<T>` must be used for all state mutations.
- `readMemory()` must verify JSON syntax; on parse error, backup corrupted file to `${filePath}.corrupt-${Date.now()}` and throw an explicit error rather than silently returning empty state.

### 3. Graph Component Decomposition Contract
`components/cortex/graph/`:
- `cortex-graph-types.ts`: Shared domain types (nodes, edges, physics particles, viewport state).
- `cortex-graph-physics.ts`: Pure simulation functions taking positions/velocities and returning updated state without mutating React refs.
- `cortex-graph-canvas.tsx`: Canvas rendering component handling `devicePixelRatio`, `ResizeObserver`, hit testing, and `visibilitychange` pausing.
- `cortex-graph-controls.tsx`: Zoom/pan buttons, search bar, legend, filter toggles.
- `cortex-graph-details.tsx`: Inspector panel for selected node/edge, procedural rule editor, episode feedback.

### 4. Dialog Modal Contract
`components/cortex/cortex-confirm-modal.tsx`:
```tsx
interface CortexConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}
```
Traps keyboard focus (`Tab`, `Shift+Tab`), closes on `Escape`, restores focus to trigger element on close.

---

## Code Layout
```
app/
├── (dashboard)/
│   └── cortex/
│       └── page.tsx                         # Unified entry point rendering CortexShell
└── api/
    ├── memory/
    │   ├── graph/route.ts                   # Graph semantic nodes & edges
    │   ├── graph/stats/route.ts             # Overview metrics
    │   ├── rules/route.ts                   # Procedural rules
    │   └── episodes/route.ts                # Episodic memory queries & feedback
    ├── cortex/
    │   ├── chat-memories/route.ts           # Chat memories list & review
    │   ├── chat-memories/[id]/route.ts      # Forget memory
    │   ├── identities/route.ts              # Observed identities
    │   └── identities/[id]/route.ts         # Identity details & link/unlink
    └── conversations/
        ├── route.ts                         # Conversation CRUD (Flow-compatible)
        ├── [id]/route.ts                    # Single conversation
        ├── search/route.ts                  # FTS5 search
        └── import/route.ts                  # Import archive

components/
└── cortex/
    ├── cortex-shell.tsx                     # Unified shell with section tabs & real metrics
    ├── cortex-overview.tsx                  # Visão Geral dashboard
    ├── cortex-chat-memories.tsx             # Memories management with search & filter
    ├── cortex-conversation-archive.tsx      # Conversations archive with race-free search
    ├── cortex-identities.tsx                # Identities management
    ├── cortex-confirm-modal.tsx             # Accessible focus-trapping confirm dialog
    └── graph/
        ├── cortex-graph.tsx                 # High-level container wiring state & subcomponents
        ├── cortex-graph-canvas.tsx          # High-DPI canvas renderer with visibility pause
        ├── cortex-graph-physics.ts          # Pure physics simulation & position caching
        ├── cortex-graph-controls.tsx        # Viewport controls, zoom, pan, search
        ├── cortex-graph-details.tsx         # Node/edge inspector & rule/feedback forms
        └── cortex-graph-types.ts            # Type definitions

tests/
├── cognitive-memory.test.ts                 # Existing cognitive memory tests
├── conversation-memory.test.ts              # Existing conversation memory tests
└── e2e/
    └── cortex/                              # E2E Testing Track test suites
        ├── test-runner.mjs                  # Standalone test runner
        ├── tier1-feature-coverage.test.mjs  # Tier 1 tests
        ├── tier2-boundary-corner.test.mjs   # Tier 2 tests
        ├── tier3-cross-feature.test.mjs     # Tier 3 tests
        └── tier4-application.test.mjs       # Tier 4 tests
```
