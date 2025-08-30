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
    console.log('[valtio-yjs] reconcileValtioMap skipped (no proxy)');
    return;
  }

  context.withReconcilingLock(() => {
    try {
      console.log('[valtio-yjs] reconcileValtioMap start', {
        yKeys: Array.from(yMap.keys()),
        valtioKeys: Object.keys(valtioProxy),
        yJson: typeof yMap.toJSON === 'function' ? yMap.toJSON() : undefined,
      });
    } catch { void 0; }
    const yKeys = new Set(Array.from(yMap.keys()).map((k) => String(k)));
    const valtioKeys = new Set(Object.keys(valtioProxy));

    // Add missing keys to Valtio proxy
    for (const key of yKeys) {
      if (!valtioKeys.has(key)) {
        const yValue = yMap.get(key);
        if (yValue instanceof Y.AbstractType) {
          console.log('[valtio-yjs] materialize nested controller for key', key);
          (valtioProxy as any)[key] = createYjsController(context, yValue, doc);
        } else {
          console.log('[valtio-yjs] set primitive key', key);
          (valtioProxy as any)[key] = yValue;
        }
      }
    }

    // Remove extra keys from Valtio proxy
    for (const key of valtioKeys) {
      if (!yKeys.has(key)) {
        console.log('[valtio-yjs] delete key', key);
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
            console.log('[valtio-yjs] update primitive key', key);
            (valtioProxy as any)[key] = yValue;
          }
        }
      }
    }
    try {
      console.log('[valtio-yjs] reconcileValtioMap end', {
        valtioKeys: Object.keys(valtioProxy),
      });
    } catch { void 0; }
  });
}

// TODO: Implement granular delta-based reconciliation for arrays.
// For now, perform a coarse structural sync using splice.
export function reconcileValtioArray(context: SynchronizationContext, yArray: Y.Array<any>, doc: Y.Doc): void {
  const valtioProxy = getValtioProxyForYType(context, yArray) as any[] | undefined;
  if (!valtioProxy) return;

  context.withReconcilingLock(() => {
    try {
      console.log('[valtio-yjs] reconcileValtioArray start', {
        yLength: yArray.length,
        valtioLength: (valtioProxy as any[]).length,
      });
    } catch { void 0; }
    const newContent = yArray.toArray().map((item) =>
      item instanceof Y.AbstractType ? createYjsController(context, item, doc) : item,
    );
    console.log('[valtio-yjs] reconcile array splice', newContent.length);
    (valtioProxy as any[]).splice(0, (valtioProxy as any[]).length, ...newContent);
    try {
      console.log('[valtio-yjs] reconcileValtioArray end', {
        valtioLength: (valtioProxy as any[]).length,
      });
    } catch { void 0; }
  });
}

/**
 * Applies a granular Yjs delta to the Valtio array proxy, avoiding full re-splices.
 * The delta format follows Yjs ArrayEvent.changes.delta: an array of ops
 * where each op is one of { retain: number } | { delete: number } | { insert: any[] }.
 */
export function reconcileValtioArrayWithDelta(
  context: SynchronizationContext,
  yArray: Y.Array<any>,
  doc: Y.Doc,
  delta: Array<{ retain?: number; delete?: number; insert?: any[] }>,
): void {
  const valtioProxy = getValtioProxyForYType(context, yArray) as any[] | undefined;
  if (!valtioProxy) return;

  context.withReconcilingLock(() => {
    try {
      console.log('[valtio-yjs] reconcileValtioArrayWithDelta start', {
        delta,
        valtioLength: (valtioProxy as any[]).length,
      });
    } catch { void 0; }

    let position = 0;
    for (const d of delta) {
      if (d.retain && d.retain > 0) {
        position += d.retain;
        continue;
      }
      if (d.delete && d.delete > 0) {
        const deleteCount = d.delete;
        if (deleteCount > 0) {
          (valtioProxy as any[]).splice(position, deleteCount);
        }
        continue;
      }
      if (d.insert && d.insert.length > 0) {
        const converted = d.insert.map((item) =>
          item instanceof Y.AbstractType ? createYjsController(context, item, doc) : item,
        );
        (valtioProxy as any[]).splice(position, 0, ...converted);
        position += converted.length;
        continue;
      }
      // Unknown or empty op: skip
    }

    try {
      console.log('[valtio-yjs] reconcileValtioArrayWithDelta end', {
        valtioLength: (valtioProxy as any[]).length,
      });
    } catch { void 0; }
  });
}


