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
import type { AnySharedType } from './context.js';
import { SynchronizationContext } from './context.js';
import { getValtioProxyForYType } from './controller.js';
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
  const handleDeep = (events: Y.YEvent<Y.Map<unknown> | Y.Array<unknown>>[], transaction: Y.Transaction) => {
    if (transaction.origin === VALTIO_YJS_ORIGIN) {
      return;
    }
    // Track boundaries to reconcile and capture array deltas when available
    const toReconcile = new Set<AnySharedType>();
    const arrayBoundaryToDelta = new Map<
      Y.Array<unknown>,
      Array<{ retain?: number; delete?: number; insert?: unknown[] }>
    >();
    for (const event of events) {
      let boundary: AnySharedType | null = event.target as unknown as AnySharedType;
      while (boundary && !getValtioProxyForYType(context, boundary as AnySharedType)) {
        boundary = (boundary as unknown as { parent: AnySharedType | null }).parent ?? null;
      }
      if (!boundary) {
        boundary = yRoot as unknown as AnySharedType;
      }
      toReconcile.add(boundary);
      // If the event target is an array, capture its delta and ensure we reconcile it.
      if ((event.target as unknown) instanceof Y.Array) {
        const targetArray = event.target as unknown as Y.Array<unknown>;
        const maybeDelta = (event as unknown as { changes?: { delta?: unknown } }).changes?.delta as
          | Array<{ retain?: number; delete?: number; insert?: unknown[] }>
          | undefined;
        if (Array.isArray(maybeDelta)) {
          arrayBoundaryToDelta.set(targetArray, maybeDelta);
        }
        toReconcile.add(targetArray as unknown as AnySharedType);
      }
    }
    for (const target of toReconcile) {
      if (target instanceof Y.Map) {
        reconcileValtioMap(context, target, doc);
      } else if (target instanceof Y.Array) {
        const delta = arrayBoundaryToDelta.get(target as Y.Array<unknown>);
        if (delta && delta.length > 0) {
          reconcileValtioArrayWithDelta(context, target as Y.Array<unknown>, doc, delta);
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


