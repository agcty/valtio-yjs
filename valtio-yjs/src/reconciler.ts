/* eslint @typescript-eslint/no-explicit-any: "off" */
import * as Y from 'yjs';
import {
  createYjsController,
  getValtioProxyForYType,
  runWithoutValtioReflection,
} from './controller.js';

/**
 * Reconciles the structure of a Valtio proxy to match its underlying Y.Map.
 * It creates/deletes properties on the proxy to ensure the "scaffolding" is correct.
 */
export function reconcileValtioMap(yMap: Y.Map<any>, doc: Y.Doc): void {
  const valtioProxy = getValtioProxyForYType(yMap) as Record<string, any> | undefined;
  if (!valtioProxy) {
    // This map hasn't been materialized yet, so there's nothing to reconcile.
    console.debug('[valtio-yjs] reconcileValtioMap skipped (no proxy)');
    return;
  }

  runWithoutValtioReflection(yMap, () => {
    const yKeys = new Set(Array.from(yMap.keys()).map((k) => String(k)));
    const valtioKeys = new Set(Object.keys(valtioProxy));

    // Add missing keys to Valtio proxy
    for (const key of yKeys) {
      if (!valtioKeys.has(key)) {
        const yValue = yMap.get(key);
        if (yValue instanceof Y.AbstractType) {

          console.debug('[valtio-yjs] materialize nested controller for key', key);
          (valtioProxy as any)[key] = createYjsController(yValue, doc);
        } else {
          console.debug('[valtio-yjs] set primitive key', key);
          (valtioProxy as any)[key] = yValue;
        }
      }
    }

    // Remove extra keys from Valtio proxy
    for (const key of valtioKeys) {
      if (!yKeys.has(key)) {
        console.debug('[valtio-yjs] delete key', key);
        delete (valtioProxy as any)[key];
      }
    }
  });
}

// TODO: Implement granular delta-based reconciliation for arrays.
// For now, perform a coarse structural sync using splice.
export function reconcileValtioArray(yArray: Y.Array<any>, doc: Y.Doc): void {
  const valtioProxy = getValtioProxyForYType(yArray) as any[] | undefined;
  if (!valtioProxy) return;

  runWithoutValtioReflection(yArray, () => {
    const newContent = yArray.toArray().map((item) =>
      item instanceof Y.AbstractType ? createYjsController(item, doc) : item,
    );
    console.debug('[valtio-yjs] reconcile array splice', newContent.length);
    (valtioProxy as any[]).splice(0, (valtioProxy as any[]).length, ...newContent);
  });
}


