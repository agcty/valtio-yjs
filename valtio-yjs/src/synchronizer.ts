/* eslint @typescript-eslint/no-explicit-any: "off" */
import * as Y from 'yjs';
import { VALTIO_YJS_ORIGIN } from './constants.js';
import { reconcileValtioMap, reconcileValtioArray } from './reconciler.js';

/**
 * Sets up a one-way listener from Yjs to Valtio.
 * On remote changes, it notifies the correct controller proxy to trigger UI updates.
 * @returns A dispose function to clean up the listener.
 */
export function setupSyncListener(doc: Y.Doc, yRoot: Y.Map<any> | Y.Array<any>): () => void {
  const handleAfterTransaction = (transaction: Y.Transaction) => {
    // Ignore changes originating from our own proxy setters.
    if (transaction.origin === VALTIO_YJS_ORIGIN) {
      return;
    }

    // Always reconcile from root to ensure lazy materialization of newly added subtrees.
    if (yRoot instanceof Y.Map) {
      // eslint-disable-next-line no-console
      console.debug('[valtio-yjs] reconcile root Map');
      reconcileValtioMap(yRoot, doc);
    } else if (yRoot instanceof Y.Array) {
      // eslint-disable-next-line no-console
      console.debug('[valtio-yjs] reconcile root Array');
      reconcileValtioArray(yRoot, doc);
    }

    // Reconcile all changed parent types
    transaction.changedParentTypes.forEach((_, yType) => {
      if (yType instanceof Y.Map) {
        // eslint-disable-next-line no-console
        console.debug('[valtio-yjs] reconcile changed Map');
        reconcileValtioMap(yType, doc);
      } else if (yType instanceof Y.Array) {
        // eslint-disable-next-line no-console
        console.debug('[valtio-yjs] reconcile changed Array');
        reconcileValtioArray(yType, doc);
      }
    });
  };

  // 'afterTransaction' is a robust way to listen for all changes, batched.
  doc.on('afterTransaction', handleAfterTransaction);

  return () => {
    doc.off('afterTransaction', handleAfterTransaction);
  };
}


