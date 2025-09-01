// Synchronizer layer
//
// Responsibility:
// - Listen to Yjs deep events and trigger reconciliation.
// - Ignore transactions with our origin (VALTIO_YJS_ORIGIN) to prevent loops.
// - For each deep event, walk up to the nearest materialized ancestor and
//   reconcile that container to support lazy materialization.
import * as Y from 'yjs';
import { VALTIO_YJS_ORIGIN } from './constants.js';
import { reconcileValtioMap, reconcileValtioArray, reconcileValtioArrayWithDelta } from './reconciler.js';
import type { YSharedContainer, YArrayDelta } from './yjs-types.js';
import { SynchronizationContext } from './context.js';
import { getValtioProxyForYType } from './valtio-bridge.js';
import { isYArrayEvent } from './yjs-events.js';
import { isYArray, isYMap, isYSharedContainer } from './guards.js';
// Synchronization strategy
//
// We use `observeDeep` on the chosen root container to detect any changes below.
// For each event, we determine the nearest materialized ancestor (boundary)
// and reconcile only that ancestor. This ensures correctness and performance.

/**
 * Sets up a one-way listener from Yjs to Valtio.
 * On remote changes, it notifies the correct controller proxy to trigger UI updates.
 * @returns A dispose function to clean up the listener.
 */
export function setupSyncListener(
  context: SynchronizationContext,
  doc: Y.Doc,
  yRoot: Y.Map<unknown> | Y.Array<unknown>,
): () => void {
  const handleDeep = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => {
    if (transaction.origin === VALTIO_YJS_ORIGIN) {
      return;
    }
    console.log('[valtio-yjs][sync] deep', {
      events: events.map((e) => ({
        target: e.target.constructor.name,
        path: (e.path ?? []).slice(),
        isArray: isYArray(e.target),
        isMap: isYMap(e.target),
      })),
    });
    // Two-phase strategy:
    // 1) Reconcile materialized ancestor boundaries to ensure structure and
    //    materialize any newly introduced child controllers.
    // 2) Apply granular array deltas to the actual array targets after their
    //    parents are materialized in phase 1.
    const boundaries = new Set<YSharedContainer>();
    const arrayTargetToDelta = new Map<Y.Array<unknown>, YArrayDelta>();
    for (const event of events) {
      const targetContainer = isYSharedContainer(event.target) ? (event.target as YSharedContainer) : null;
      let boundary: YSharedContainer | null = targetContainer;
      while (boundary && !getValtioProxyForYType(context, boundary)) {
        const parent = boundary.parent;
        boundary = parent && isYSharedContainer(parent) ? parent : null;
      }
      if (!boundary) {
        boundary = yRoot;
      }
      // Phase 1 target: boundary
      boundaries.add(boundary);
      // Record array delta by direct target (phase 2)
      if (isYArrayEvent(event)) {
        if (event.changes.delta && event.changes.delta.length > 0) {
          arrayTargetToDelta.set(event.target as unknown as Y.Array<unknown>, event.changes.delta);
        }
      }
    }
    // Phase 1: boundaries first (parents before children)
    const arraysWithDelta = new Set(arrayTargetToDelta.keys());
    for (const container of boundaries) {
      if (isYMap(container)) {
        reconcileValtioMap(context, container, doc);
      } else if (isYArray(container)) {
        // If this array has a delta recorded, skip structural reconciliation
        // to avoid applying the change twice (structural + delta).
        if (!arraysWithDelta.has(container)) {
          reconcileValtioArray(context, container, doc);
        }
      }
    }
    // Phase 2: apply granular array deltas to direct targets
    for (const [arr, delta] of arrayTargetToDelta) {
      if (delta && delta.length > 0) {
        reconcileValtioArrayWithDelta(context, arr, doc, delta);
      }
    }
  };

  yRoot.observeDeep(handleDeep);

  return () => {
    yRoot.unobserveDeep(handleDeep);
  };
}



