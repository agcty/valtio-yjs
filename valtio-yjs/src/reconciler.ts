import * as Y from 'yjs';
import { createYjsController, getValtioProxyForYType } from './controller.js';
import { SynchronizationContext } from './context.js';
import type { AnySharedType } from './context.js';
import { isSharedType } from './guards.js';

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
export function reconcileValtioMap(context: SynchronizationContext, yMap: Y.Map<unknown>, doc: Y.Doc): void {
  const valtioProxy = getValtioProxyForYType(context, yMap) as Record<string, unknown> | undefined;
  if (!valtioProxy) {
    // This map hasn't been materialized yet, so there's nothing to reconcile.
    console.log('[valtio-yjs] reconcileValtioMap skipped (no proxy)');
    return;
  }

  context.withReconcilingLock(() => {
    console.log('[valtio-yjs] reconcileValtioMap start', {
      yKeys: Array.from(yMap.keys()),
      valtioKeys: Object.keys(valtioProxy),
      yJson: typeof yMap.toJSON === 'function' ? yMap.toJSON() : undefined,
    });
    const yKeys = new Set(Array.from(yMap.keys()).map((k) => String(k)));
    const valtioKeys = new Set(Object.keys(valtioProxy));

    // Add missing keys to Valtio proxy
    for (const key of yKeys) {
      if (!valtioKeys.has(key)) {
        const yValue = yMap.get(key);
        if (isSharedType(yValue)) {
          console.log('[valtio-yjs] materialize nested controller for key', key);
          (valtioProxy as Record<string, unknown>)[key] = createYjsController(context, yValue as AnySharedType, doc);
        } else {
          console.log('[valtio-yjs] set primitive key', key);
          (valtioProxy as Record<string, unknown>)[key] = yValue as unknown;
        }
      }
    }

    // Remove extra keys from Valtio proxy
    for (const key of valtioKeys) {
      if (!yKeys.has(key)) {
        console.log('[valtio-yjs] delete key', key);
        delete (valtioProxy as Record<string, unknown>)[key];
      }
    }

    // Update existing primitive values for common keys
    for (const key of yKeys) {
      if (valtioKeys.has(key)) {
        const yValue = yMap.get(key);
        if (!isSharedType(yValue)) {
          const current = (valtioProxy as Record<string, unknown>)[key];
          if (current !== yValue) {
            console.log('[valtio-yjs] update primitive key', key);
            (valtioProxy as Record<string, unknown>)[key] = yValue as unknown;
          }
        }
      }
    }
    console.log('[valtio-yjs] reconcileValtioMap end', {
      valtioKeys: Object.keys(valtioProxy),
    });
  });
}

// TODO: Implement granular delta-based reconciliation for arrays.
// For now, perform a coarse structural sync using splice.
export function reconcileValtioArray(context: SynchronizationContext, yArray: Y.Array<unknown>, doc: Y.Doc): void {
  const valtioProxy = getValtioProxyForYType(context, yArray) as unknown[] | undefined;
  if (!valtioProxy) return;

  context.withReconcilingLock(() => {
    console.log('[valtio-yjs] reconcileValtioArray start', {
      yLength: yArray.length,
      valtioLength: (valtioProxy as unknown[]).length,
    });
    const newContent = yArray
      .toArray()
      .map((item) => (item instanceof Y.Map || item instanceof Y.Array ? createYjsController(context, item as AnySharedType, doc) : item));
    console.log('[valtio-yjs] reconcile array splice', newContent.length);
    (valtioProxy as unknown[]).splice(0, (valtioProxy as unknown[]).length, ...newContent as unknown[]);
    console.log('[valtio-yjs] reconcileValtioArray end', {
      valtioLength: (valtioProxy as unknown[]).length,
    });
  });
}

/**
 * Applies a granular Yjs delta to the Valtio array proxy, avoiding full re-splices.
 * The delta format follows Yjs ArrayEvent.changes.delta: an array of ops
 * where each op is one of { retain: number } | { delete: number } | { insert: any[] }.
 */
export function reconcileValtioArrayWithDelta(
  context: SynchronizationContext,
  yArray: Y.Array<unknown>,
  doc: Y.Doc,
  delta: Array<{ retain?: number; delete?: number; insert?: unknown[] }>,
): void {
  const valtioProxy = getValtioProxyForYType(context, yArray) as unknown[] | undefined;
  if (!valtioProxy) return;

  context.withReconcilingLock(() => {
    console.log('[valtio-yjs] reconcileValtioArrayWithDelta start', {
      delta,
      valtioLength: (valtioProxy as unknown[]).length,
    });

    let position = 0;
    let step = 0;
    for (const d of delta) {
      console.log('[valtio-yjs] delta.step', { step: step++, d, position });
      if (d.retain && d.retain > 0) {
        position += d.retain;
        continue;
      }
      if (d.delete && d.delete > 0) {
        const deleteCount = d.delete;
        if (deleteCount > 0) {
          (valtioProxy as unknown[]).splice(position, deleteCount);
        }
        continue;
      }
      if (d.insert && d.insert.length > 0) {
        const converted = d.insert.map((item) =>
          item instanceof Y.Map || item instanceof Y.Array ? createYjsController(context, item as AnySharedType, doc) : item,
        );
        console.log('[valtio-yjs] delta.insert', { at: position, count: converted.length });
        (valtioProxy as unknown[]).splice(position, 0, ...converted as unknown[]);
        position += converted.length;
        continue;
      }
      // Unknown or empty op: skip
    }

    console.log('[valtio-yjs] reconcileValtioArrayWithDelta end', {
      valtioLength: (valtioProxy as unknown[]).length,
    });
  });
}


