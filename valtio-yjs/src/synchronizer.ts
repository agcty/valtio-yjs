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
    // Track boundaries to reconcile and capture array deltas when available
    const toReconcile = new Set<YSharedContainer>();
    const arrayBoundaryToDelta = new Map<Y.Array<unknown>, YArrayDelta>();
    for (const event of events) {
      let boundary: YSharedContainer | null = isYSharedContainer(event.target) ? event.target : null;
      while (boundary && !getValtioProxyForYType(context, boundary)) {
        const parent = boundary.parent;
        boundary = parent && isYSharedContainer(parent) ? parent : null;
      }
      if (!boundary) {
        boundary = yRoot;
      }
      toReconcile.add(boundary);
      // Only store delta when the event target is the materialized boundary.
      // For nested, unmaterialized arrays, we fall back to full reconciliation on the boundary.
      if (isYArrayEvent(event) && event.target === boundary) {
        if (event.changes.delta && event.changes.delta.length > 0) {
          arrayBoundaryToDelta.set(boundary as Y.Array<unknown>, event.changes.delta);
        }
      }
    }
    for (const target of toReconcile) {
      if (isYMap(target)) {
        reconcileValtioMap(context, target, doc);
      } else if (isYArray(target)) {
        const delta = arrayBoundaryToDelta.get(target);
        if (delta && delta.length > 0) {
          reconcileValtioArrayWithDelta(context, target, doc, delta);
        } else {
          reconcileValtioArray(context, target, doc);
        }
      }
    }
  };

  yRoot.observeDeep(handleDeep);

  return () => {
    yRoot.unobserveDeep(handleDeep);
  };
}


