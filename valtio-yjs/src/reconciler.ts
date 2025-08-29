/* eslint @typescript-eslint/no-explicit-any: "off" */
import * as Y from 'yjs';
import { createYjsController, getValtioProxyForYType } from './controller.js';
import { SynchronizationContext } from './context.js';

// Reconciler layer
//
// Responsibility:
// - Apply Yjs -> Valtio updates in a structural way, ensuring the Valtio
//   proxies exist (materialized) and match the Y tree shape.
// - No deepEqual. Only add missing keys, remove extra keys, and create
//   nested controllers for Y types as needed.
// - Uses runWithoutValtioReflection to avoid reflecting these changes back
//   to Yjs.
/**
 * Reconciles the structure of a Valtio proxy to match its underlying Y.Map.
 * It creates/deletes properties on the proxy to ensure the "scaffolding" is correct.
 */
export function reconcileValtioMap(context: SynchronizationContext, yMap: Y.Map<any>, doc: Y.Doc): void {
  const valtioProxy = getValtioProxyForYType(context, yMap) as Record<string, any> | undefined;
  if (!valtioProxy) {
    // This map hasn't been materialized yet, so there's nothing to reconcile.
    console.debug('[valtio-yjs] reconcileValtioMap skipped (no proxy)');
    return;
  }

  context.withReconcilingLock(() => {
    const yKeys = new Set(Array.from(yMap.keys()).map((k) => String(k)));
    const valtioKeys = new Set(Object.keys(valtioProxy));

    // Add missing keys to Valtio proxy
    for (const key of yKeys) {
      if (!valtioKeys.has(key)) {
        const yValue = yMap.get(key);
        if (yValue instanceof Y.AbstractType) {

          console.debug('[valtio-yjs] materialize nested controller for key', key);
          (valtioProxy as any)[key] = createYjsController(context, yValue, doc);
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

    // Update existing primitive values for common keys
    for (const key of yKeys) {
      if (valtioKeys.has(key)) {
        const yValue = yMap.get(key);
        if (!(yValue instanceof Y.AbstractType)) {
          const current = (valtioProxy as any)[key];
          if (current !== yValue) {
            console.debug('[valtio-yjs] update primitive key', key);
            (valtioProxy as any)[key] = yValue;
          }
        }
      }
    }
  });
}

// TODO: Implement granular delta-based reconciliation for arrays.
// For now, perform a coarse structural sync using splice.
export function reconcileValtioArray(context: SynchronizationContext, yArray: Y.Array<any>, doc: Y.Doc): void {
  const valtioProxy = getValtioProxyForYType(context, yArray) as any[] | undefined;
  if (!valtioProxy) return;

  context.withReconcilingLock(() => {
    const newContent = yArray.toArray().map((item) =>
      item instanceof Y.AbstractType ? createYjsController(context, item, doc) : item,
    );
    console.debug('[valtio-yjs] reconcile array splice', newContent.length);
    (valtioProxy as any[]).splice(0, (valtioProxy as any[]).length, ...newContent);
  });
}


