/* eslint @typescript-eslint/no-explicit-any: "off" */
import Debug from 'debug';
import * as Y from 'yjs';
import { proxy, subscribe } from 'valtio/vanilla';
// origin symbol is provided by caller to avoid cycles
import { yTypeToPlainObject, plainObjectToYType } from './converter.js';

const debug = Debug('valtio-yjs:synchronizer');

/**
 * Sets up the two-way synchronization between a Valtio proxy and a Yjs document.
 * @returns A dispose function to clean up all listeners.
 */
export function setupSyncListeners(
  stateProxy: ReturnType<typeof proxy>,
  doc: Y.Doc,
  yRoot: Y.Map<any> | Y.Array<any>,
  origin?: any,
): () => void {
  // Prevent feedback loop: when applying Yjs -> Valtio, temporarily ignore Valtio -> Yjs
  let isApplyingYjsToValtio = false;
  // Yjs -> Valtio listener (coarse first pass: mirror whole root on any change)
  const handleYjsChanges = (_events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    if (transaction.origin === origin) {
      debug('Ignore Yjs -> Valtio (own origin)');
      return;
    }

    isApplyingYjsToValtio = true;
    try {
      debug('Applying Yjs -> Valtio');
      const next = yTypeToPlainObject(yRoot);
      // Replace keys in the proxy to reflect yRoot; avoid replacing the object itself
      if (Array.isArray(next) && Array.isArray(stateProxy)) {
        stateProxy.splice(0, stateProxy.length, ...next);
        return;
      }
      if (!Array.isArray(next) && typeof next === 'object' && next) {
        // delete keys not in next
        Object.keys(stateProxy as any).forEach((k) => {
          if (!(k in (next as any))) {
            delete (stateProxy as any)[k];
          }
        });
        // assign new/updated keys
        Object.entries(next).forEach(([k, v]) => {
          (stateProxy as any)[k] = v as any;
        });
      }
    } finally {
      isApplyingYjsToValtio = false;
    }
  };

  yRoot.observeDeep(handleYjsChanges);

  // Valtio -> Yjs listener (coarse first pass: mirror whole root on any change)
  const handleValtioOps = (_ops: any[]) => {
    if (isApplyingYjsToValtio) {
      // Skip reflecting changes back to Yjs if they were caused by Yjs in the first place
      debug('Skip Valtio -> Yjs (from Yjs)');
      return;
    }
    debug('Applying Valtio -> Yjs');
    doc.transact(() => {
      // Build fresh y structure from current proxy value and replace yRoot content.
      const current = stateProxy as any;
      const yValue = plainObjectToYType(current);
      if (yRoot instanceof Y.Map && yValue instanceof Y.Map) {
        // delete keys missing in proxy
        Array.from(yRoot.keys()).forEach((k) => {
          if (!yValue.has(k)) yRoot.delete(k);
        });
        // set keys from proxy
        yValue.forEach((val: any, key: string) => {
          yRoot.set(key, val);
        });
      } else if (yRoot instanceof Y.Array && yValue instanceof Y.Array) {
        yRoot.delete(0, yRoot.length);
        if (yValue.length > 0) {
          yRoot.insert(0, yValue.toArray());
        }
      }
    }, origin);
  };

  const unsubscribeValtio = subscribe(stateProxy, handleValtioOps);

  return () => {
    yRoot.unobserveDeep(handleYjsChanges);
    unsubscribeValtio();
  };
}


