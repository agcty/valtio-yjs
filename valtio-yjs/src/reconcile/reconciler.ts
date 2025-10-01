import * as Y from 'yjs';
import { ref } from 'valtio/vanilla';
import { getOrCreateValtioProxy, getValtioProxyForYType } from '../bridge/valtio-bridge';
import { SynchronizationContext } from '../core/context';

import { isYSharedContainer, isYArray, isYMap, isYLeafType } from '../core/guards';
import { yTypeToJSON } from '../core/types';
import { setupLeafNodeReactivity, setupLeafNodeReactivityInArray } from '../bridge/leaf-reactivity';

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
    context.log.debug('reconcileValtioMap skipped (no proxy)');
    return;
  }

  context.withReconcilingLock(() => {
    context.log.debug('reconcileValtioMap start', {
      yKeys: Array.from(yMap.keys()),
      valtioKeys: Object.keys(valtioProxy),
      yJson: yTypeToJSON(yMap),
    });
    const yKeys = new Set(Array.from(yMap.keys()).map((k) => String(k)));
    const valtioKeys = new Set(Object.keys(valtioProxy));
    const allKeys = new Set<string>([...yKeys, ...valtioKeys]);

    for (const key of allKeys) {
      const inY = yKeys.has(key);
      const inValtio = valtioKeys.has(key);

      if (inY && !inValtio) {
        const yValue = yMap.get(key);
        // Check leaf types first (before container check) since some leaf types extend containers
        // (e.g., Y.XmlHook extends Y.Map)
        if (isYLeafType(yValue)) {
          context.log.debug('[ADD] set leaf node (wrapped in ref)', key);
          valtioProxy[key] = ref(yValue);
          setupLeafNodeReactivity(context, valtioProxy, key, yValue);
        } else if (isYSharedContainer(yValue)) {
          context.log.debug('[ADD] create controller', key);
          valtioProxy[key] = getOrCreateValtioProxy(context, yValue, doc);
          if (isYMap(yValue)) {
            context.log.debug('[RECONCILE-CHILD] map', key);
            reconcileValtioMap(context, yValue as Y.Map<unknown>, doc);
          } else if (isYArray(yValue)) {
            context.log.debug('[RECONCILE-CHILD] array', key);
            reconcileValtioArray(context, yValue as Y.Array<unknown>, doc);
          }
        } else {
          context.log.debug('[ADD] set primitive', key);
          valtioProxy[key] = yValue;
        }
        continue;
      }

      if (!inY && inValtio) {
        context.log.debug('[DELETE] remove key', key);
        delete valtioProxy[key];
        continue;
      }

      if (inY && inValtio) {
        const yValue = yMap.get(key);
        const current = valtioProxy[key];
        // Check leaf types first (before container check) since some leaf types extend containers
        // (e.g., Y.XmlHook extends Y.Map)
        if (isYLeafType(yValue)) {
          // For leaf nodes, check if it's a different instance
          if (current !== yValue) {
            context.log.debug('[REPLACE] replace leaf node', key);
            valtioProxy[key] = ref(yValue);
            setupLeafNodeReactivity(context, valtioProxy, key, yValue);
          }
          // If same instance, reactivity is already setup, no action needed
        } else if (isYSharedContainer(yValue)) {
          const desired = getOrCreateValtioProxy(context, yValue, doc);
          if (current !== desired) {
            context.log.debug('[REPLACE] replace controller', key);
            valtioProxy[key] = desired;
          }
          if (isYMap(yValue)) {
            context.log.debug('[RECONCILE-CHILD] map', key);
            reconcileValtioMap(context, yValue as Y.Map<unknown>, doc);
          } else if (isYArray(yValue)) {
            context.log.debug('[RECONCILE-CHILD] array', key);
            reconcileValtioArray(context, yValue as Y.Array<unknown>, doc);
          }
        } else {
          if (current !== yValue) {
            context.log.debug('[UPDATE] primitive', key);
            valtioProxy[key] = yValue;
          }
        }
      }
    }
    context.log.debug('reconcileValtioMap end', {
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
    // Skip structural reconcile if this array has a delta in the current sync pass
    if (context.shouldSkipArrayStructuralReconcile(yArray)) {
      context.log.debug('reconcileValtioArray skipped due to pending delta', {
        yLength: yArray.length,
        valtioLength: valtioProxy.length,
      });
      return;
    }
    context.log.debug('reconcileValtioArray start', {
      yLength: yArray.length,
      valtioLength: valtioProxy.length,
      yJson: yTypeToJSON(yArray),
    });
    const newContent = yArray.toArray().map((item) => {
      if (isYSharedContainer(item)) {
        return getOrCreateValtioProxy(context, item, doc);
      } else if (isYLeafType(item)) {
        return ref(item);
      } else {
        return item;
      }
    });
    context.log.debug('reconcile array splice', newContent.length);
    valtioProxy.splice(0, valtioProxy.length, ...newContent);
    
    // Setup reactivity for leaf nodes after splice
    yArray.toArray().forEach((item, index) => {
      if (isYLeafType(item)) {
        setupLeafNodeReactivityInArray(context, valtioProxy, index, item);
      }
    });
    context.log.debug('reconcileValtioArray end', {
      valtioLength: valtioProxy.length,
    });

    // Eagerly ensure nested children of shared containers are also materialized
    for (let i = 0; i < newContent.length; i++) {
      const item = yArray.get(i) as unknown;
      if (item && isYSharedContainer(item)) {
        if (isYMap(item)) {
          reconcileValtioMap(context, item as Y.Map<unknown>, doc);
        } else if (isYArray(item)) {
          reconcileValtioArray(context, item as Y.Array<unknown>, doc);
        }
      }
    }
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
    context.log.debug('reconcileValtioArrayWithDelta start', {
      delta,
      valtioLength: valtioProxy.length,
    });

    let position = 0;
    let step = 0;
    for (const d of delta) {
      context.log.debug('delta.step', { step: step++, d, position });
      if (d.retain && d.retain > 0) {
        position += d.retain;
        continue;
      }
      if (d.delete && d.delete > 0) {
        const deleteCount = d.delete;
        if (deleteCount > 0) {
          valtioProxy.splice(position, deleteCount);
        }
        continue;
      }
      if (d.insert && d.insert.length > 0) {
        const converted = d.insert.map((item) => {
          if (isYSharedContainer(item)) {
            return getOrCreateValtioProxy(context, item, doc);
          } else if (isYLeafType(item)) {
            return ref(item);
          } else {
            return item;
          }
        });
        // Idempotency guard: if the exact converted items already exist at this position
        // (e.g., due to a prior structural reconcile in the same sync pass), skip inserting.
        const existingSlice = valtioProxy.slice(position, position + converted.length);
        const alreadyPresent = converted.length > 0 && converted.every((v, i) => existingSlice[i] === v);
        if (alreadyPresent) {
          context.log.debug('delta.insert (skipped: already present)', { at: position, count: converted.length });
          position += converted.length;
          continue;
        }
        context.log.debug('delta.insert', { at: position, count: converted.length });
        valtioProxy.splice(position, 0, ...converted);
        
        // Setup reactivity for inserted leaf nodes
        d.insert.forEach((item, offset) => {
          if (isYLeafType(item)) {
            setupLeafNodeReactivityInArray(context, valtioProxy, position + offset, item);
          }
        });
        
        position += converted.length;
        continue;
      }
      // Unknown or empty op: skip
    }

    context.log.debug('reconcileValtioArrayWithDelta end', {
      valtioLength: valtioProxy.length,
    });
  });
}


