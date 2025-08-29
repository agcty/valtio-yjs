/* eslint @typescript-eslint/no-explicit-any: "off" */
// Synchronizer layer
//
// Responsibility:
// - Listen to Yjs transactions and trigger reconciliation.
// - Ignore transactions with our origin (VALTIO_YJS_ORIGIN) to prevent loops.
// - Reconcile from the root each time to ensure lazy materialization of new subtrees,
//   then reconcile all changed parent types for minimal updates.
import * as Y from 'yjs';
import { VALTIO_YJS_ORIGIN } from './constants.js';
import { reconcileValtioMap, reconcileValtioArray } from './reconciler.js';
import { SynchronizationContext } from './context.js';
import { getValtioProxyForYType } from './controller.js';
// Synchronization strategy
//
// We use a single doc-level `afterTransaction` listener combined with
// `transaction.changedParentTypes` to drive reconciliation. This yields:
// - Correctness: never miss updates (doc-level visibility) and handle
//   lazy materialization by walking up to the nearest materialized ancestor.
// - Performance: reconcile only parent containers that actually changed
//   in the transaction, not the whole tree.
// - Simplicity: one listener, clear responsibility (no overlapping deep
//   observers). Fallback to `yRoot` covers cases with no materialized
//   ancestor.

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
  const handleAfterTransaction = (transaction: Y.Transaction) => {
    if (transaction.origin === VALTIO_YJS_ORIGIN) return;
    const reconciled = new Set<Y.AbstractType<any>>();
    // changedParentTypes: Map<Y.AbstractType<any>, any>
    const parentsIter = (transaction as unknown as { changedParentTypes?: Map<Y.AbstractType<any>, unknown> }).changedParentTypes?.keys();
    const parents = parentsIter ? Array.from(parentsIter) : [];
    if (parents.length === 0) {
      // Fallback: reconcile root
      if (yRoot instanceof Y.Map) reconcileValtioMap(context, yRoot, doc);
      else if (yRoot instanceof Y.Array) reconcileValtioArray(context, yRoot, doc);
      return;
    }
    for (const yType of parents) {
      let target: Y.AbstractType<any> | null = yType;
      while (target && !getValtioProxyForYType(context, target)) {
        target = (target as unknown as { parent: Y.AbstractType<any> | null }).parent ?? null;
      }
      if (!target) {
        // Fallback to root when no materialized ancestor
        target = yRoot as Y.AbstractType<any>;
      }
      if (reconciled.has(target)) continue;
      if (target instanceof Y.Map) reconcileValtioMap(context, target, doc);
      else if (target instanceof Y.Array) reconcileValtioArray(context, target, doc);
      reconciled.add(target);
    }
  };

  doc.on('afterTransaction', handleAfterTransaction);

  return () => {
    doc.off('afterTransaction', handleAfterTransaction);
  };
}


