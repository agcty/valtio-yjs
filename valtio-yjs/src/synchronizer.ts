/* eslint @typescript-eslint/no-explicit-any: "off" */
import * as Y from 'yjs';
import { proxy, subscribe } from 'valtio/vanilla';
// origin symbol is provided by caller to avoid cycles
import { yTypeToPlainObject, plainObjectToYType } from './converter.js';

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
  const areDeepEqual = (a: any, b: any): boolean => {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!areDeepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!areDeepEqual(a[key], b[key])) return false;
    }
    return true;
  };
  // Prevent feedback loop: when applying Yjs -> Valtio, temporarily ignore Valtio -> Yjs
  let isApplyingYjsToValtio = false;
  // Yjs -> Valtio listener (coarse first pass: mirror whole root on any change)
  const handleYjsChanges = (_events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    if (transaction.origin === origin) {
      console.count('[valtio-yjs] Ignore Yjs -> Valtio (own origin)');
      return;
    }

    isApplyingYjsToValtio = true;
    try {
      console.count('[valtio-yjs] Applying Yjs -> Valtio');
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
      console.count('[valtio-yjs] Skip Valtio -> Yjs (from Yjs)');
      return;
    }
    console.count('[valtio-yjs] Applying Valtio -> Yjs');
    // Compare with existing Y state and bail if identical to avoid update bounces
    const current = stateProxy as any;
    const existing = yTypeToPlainObject(yRoot);
    if (areDeepEqual(existing, current)) {
      return;
    }
    doc.transact(() => {
      // Apply minimal changes
      if (yRoot instanceof Y.Map && typeof current === 'object' && !Array.isArray(current)) {
        // delete keys missing in proxy (read only from integrated yRoot)
        Array.from(yRoot.keys()).forEach((k) => {
          if (!Object.prototype.hasOwnProperty.call(current, k)) {
            yRoot.delete(k);
          }
        });
        // set changed keys from proxy (convert values on-the-fly)
        const existingPlain = existing as any;
        Object.entries(current).forEach(([key, value]) => {
          if (!areDeepEqual(existingPlain?.[key], value)) {
            yRoot.set(key, plainObjectToYType(value));
          }
        });
      } else if (yRoot instanceof Y.Array && Array.isArray(current)) {
        if (!areDeepEqual(existing, current)) {
          yRoot.delete(0, yRoot.length);
          if (current.length > 0) {
            const items = current.map(plainObjectToYType);
            yRoot.insert(0, items);
          }
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


