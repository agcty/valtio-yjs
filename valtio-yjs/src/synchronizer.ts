/* eslint @typescript-eslint/no-explicit-any: "off" */
// Synchronizer layer
//
// Responsibility:
// - Listen to Yjs deep events and trigger reconciliation.
// - Ignore transactions with our origin (VALTIO_YJS_ORIGIN) to prevent loops.
// - For each deep event, walk up to the nearest materialized ancestor and
//   reconcile that container to support lazy materialization.
import * as Y from 'yjs';
import { VALTIO_YJS_ORIGIN } from './constants.js';
import { reconcileValtioMap, reconcileValtioArray } from './reconciler.js';
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
  yRoot: Y.Map<any> | Y.Array<any>,
): () => void {
  const handleDeep = (events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    if (transaction.origin === VALTIO_YJS_ORIGIN) {
      return;
    }
    const toReconcile = new Set<Y.AbstractType<any>>();
    for (const event of events) {
      let boundary: Y.AbstractType<any> | null = event.target as Y.AbstractType<any>;
      while (boundary && !getValtioProxyForYType(context, boundary)) {
        boundary = (boundary as unknown as { parent: Y.AbstractType<any> | null }).parent ?? null;
      }
      if (!boundary) {
        boundary = yRoot as Y.AbstractType<any>;
      }
      toReconcile.add(boundary);
    }
    for (const target of toReconcile) {
      if (target instanceof Y.Map) {
        reconcileValtioMap(context, target, doc);
      } else if (target instanceof Y.Array) {
        reconcileValtioArray(context, target, doc);
      }
    }
  };

  yRoot.observeDeep(handleDeep);
  return () => {
    yRoot.unobserveDeep(handleDeep);
  };
}


