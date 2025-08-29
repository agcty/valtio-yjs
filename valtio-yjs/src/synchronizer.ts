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
// import { getValtioProxyForYType } from './controller.js';

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
    try {
      console.log('[valtio-yjs] afterTransaction reconciliation triggered');
    } catch { void 0; }
    if (yRoot instanceof Y.Map) {
      reconcileValtioMap(context, yRoot, doc);
    } else if (yRoot instanceof Y.Array) {
      reconcileValtioArray(context, yRoot, doc);
    }
  };

  doc.on('afterTransaction', handleAfterTransaction);

  return () => {
    doc.off('afterTransaction', handleAfterTransaction);
  };
}


