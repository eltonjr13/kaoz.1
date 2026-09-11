/**
 * components/cortex/cortex-graph-client.tsx
 *
 * Backward-compatibility adapter re-exporting CortexGraph from the decoupled
 * modular subsystem in components/cortex/graph/.
 *
 * Feature References: F15 (Decomposition), F20 (Stability), F21 (Mutations)
 */

"use client";

import { CortexGraph } from "./graph/cortex-graph.tsx";

export { CortexGraph, CortexGraph as CortexGraphClient };
export default CortexGraph;
