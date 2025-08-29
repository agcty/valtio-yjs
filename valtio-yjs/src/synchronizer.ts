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
    if (transaction.origin === VALTIO_YJS_ORIGIN) return;

    for (const ev of events) {
      let target: Y.AbstractType<any> | null = ev.target as Y.AbstractType<any>;

      // Walk up to the nearest materialized ancestor
      while (target && !getValtioProxyForYType(context, target)) {
        // Yjs types have a possibly-null `parent` reference
        target = (target as unknown as { parent: Y.AbstractType<any> | null }).parent ?? null;
      }

      if (!target) {
        // Bootstrap materialization from root if nothing found
        if (yRoot instanceof Y.Map) {
          reconcileValtioMap(context, yRoot, doc);
        } else if (yRoot instanceof Y.Array) {
          reconcileValtioArray(context, yRoot, doc);
        }
        continue;
      }

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


