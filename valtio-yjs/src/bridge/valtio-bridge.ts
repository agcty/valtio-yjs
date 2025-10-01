// Bridge/Router layer
//
// Responsibility:
// - Materialize real Valtio proxies for Yjs shared types (currently Y.Map).
// - Maintain stable identity via caches (Y type <-> Valtio proxy) inside a context.
// - Reflect local Valtio writes back to Yjs minimally (set/delete) inside
//   transactions tagged with VALTIO_YJS_ORIGIN.
// - Lazily create nested controllers when a Y value is another Y type.
import * as Y from 'yjs';
import { proxy, subscribe, ref } from 'valtio/vanilla';
// import removed: origin tagging handled by context scheduler

import type { YSharedContainer } from '../core/yjs-types';
import { SynchronizationContext } from '../core/context';
import { isYSharedContainer, isYArray, isYMap, isYLeafType } from '../core/guards';
import { LOG_PREFIX } from '../core/constants';
import { planMapOps } from '../planning/map-ops-planner';
import { planArrayOps } from '../planning/array-ops-planner';
import { validateDeepForSharedState } from '../core/converter';
import { setupLeafNodeReactivity, setupLeafNodeReactivityInArray } from './leaf-reactivity';
import { 
  getContainerValue,
  setContainerValue,
  isRawSetMapOp,
  isRawSetArrayOp,
  type RawValtioOperation,
} from '../core/types';


// All caches are moved into SynchronizationContext

/**
 * Safely serialize operations for logging, handling Y types with circular references
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  
  const replacer = (_key: string, val: unknown): unknown => {
    // Handle Y types first
    if (val instanceof Y.AbstractType) {
      // Replace Y types with a simple representation to avoid circular references
      if (val instanceof Y.Text) {
        try {
          const text = val.toString();
          return `[Y.Text: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"]`;
        } catch {
          return '[Y.Text: <unreadable>]';
        }
      }
      if (val instanceof Y.Map) {
        return '[Y.Map]';
      }
      if (val instanceof Y.Array) {
        return '[Y.Array]';
      }
      return '[Y.AbstractType]';
    }
    
    // Handle plain objects and arrays with circular reference detection
    if (val !== null && typeof val === 'object') {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }
    
    return val;
  };
  
  try {
    return JSON.stringify(value, replacer);
  } catch (err) {
    // Fallback if serialization still fails
    return `[Serialization failed: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

function upgradeChildIfNeeded(
  context: SynchronizationContext,
  container: Record<string, unknown> | unknown[],
  key: string | number,
  yValue: unknown,
  doc: Y.Doc,
): void {
  const current = getContainerValue(container, key);
  // Optimize: single WeakMap lookup instead of .has() + potential .get()
  const underlyingYType = current && typeof current === 'object' ? context.valtioProxyToYType.get(current as object) : undefined;
  const isAlreadyController = underlyingYType !== undefined;
  
  // Check leaf types first (before container check) since some leaf types extend containers
  // (e.g., Y.XmlHook extends Y.Map)
  if (isYLeafType(yValue)) {
    // Leaf node: wrap in ref() and setup reactivity
    const wrappedLeaf = ref(yValue);
    context.withReconcilingLock(() => {
      setContainerValue(container, key, wrappedLeaf);
    });
    // Setup reactivity based on container type
    // Type assertion is safe here because isYLeafType guard confirmed the type
    const leafNode = yValue as Y.Text | Y.XmlFragment | Y.XmlElement | Y.XmlHook;
    if (Array.isArray(container)) {
      setupLeafNodeReactivityInArray(context, container, key as number, leafNode);
    } else {
      setupLeafNodeReactivity(context, container, key as string, leafNode);
    }
  } else if (!isAlreadyController && isYSharedContainer(yValue)) {
    // Upgrade plain object/array to container controller
    const newController = getOrCreateValtioProxy(context, yValue, doc);
    context.withReconcilingLock(() => {
      setContainerValue(container, key, newController);
    });
  }
}


// Subscribe to a Valtio array proxy and translate top-level index operations
// into minimal Y.Array operations.
// Valtio -> Yjs (array):
// - Only translate top-level index operations here. Nested edits are handled by
//   the nested controller's own subscription once a child has been upgraded to
//   a live controller proxy.
// - If a plain object/array is assigned, we eagerly upgrade it: create a Y type
//   and immediately replace the plain value in the Valtio proxy with a
//   controller under a reconciliation lock to avoid reflection loops.
function attachValtioArraySubscription(
  context: SynchronizationContext,
  yArray: Y.Array<unknown>,
  arrProxy: unknown[],
  _doc: Y.Doc,
): () => void {
  const unsubscribe = subscribe(arrProxy, (ops: unknown[]) => {
    if (context.isReconciling) return;
    context.log.debug('[controller][array] ops', safeStringify(ops));
    
    // Wrap planning + enqueue in try/catch to rollback local proxy on validation failure
    try {
      // Phase 1: Planning - categorize operations into explicit intents
      // Use Y.Array length as the start-of-batch baseline for deterministic planning
      const { sets, deletes, replaces } = planArrayOps(ops, yArray.length, context);
      context.log.debug('Controller plan (array):', {
        replaces: Array.from(replaces.keys()).sort((a, b) => a - b),
        deletes: Array.from(deletes.values()).sort((a, b) => a - b),
        sets: Array.from(sets.keys()).sort((a, b) => a - b),
        yLength: yArray.length,
      });
      
      // Phase 2: Scheduling - enqueue planned operations
      
      // Handle replaces first (splice replace operations: delete + set at same index)
      for (const [index, value] of replaces) {
        context.log.debug('[controller][array] enqueue.replace', { index });
        const normalized = value === undefined ? null : value;
        // Validate synchronously before enqueuing (deep)
        validateDeepForSharedState(normalized);
        context.enqueueArrayReplace(
          yArray,
          index,
          normalized, // Normalize undefined→null defensively
          (yValue: unknown) => upgradeChildIfNeeded(context, arrProxy, index, yValue, _doc),
        );
      }
      
      // Handle pure deletes
      for (const index of deletes) {
        context.log.debug('[controller][array] enqueue.delete', { index });
        context.enqueueArrayDelete(yArray, index);
      }
      
      // Handle pure sets (inserts/pushes/unshifts).
      for (const [index, value] of sets) {
        const normalized = value === undefined ? null : value;
        // Validate synchronously before enqueuing (deep validation to catch nested undefined)
        validateDeepForSharedState(normalized);
        context.log.debug('[controller][array] enqueue.set', {
          index,
          hasId: !!((normalized as { id?: unknown } | null)?.id),
          id: (normalized as { id?: unknown } | null)?.id,
        });
        context.enqueueArraySet(
          yArray,
          index,
          normalized, // Normalize undefined→null defensively
          (yValue: unknown) => upgradeChildIfNeeded(context, arrProxy, index, yValue, _doc),
        );
      }
    } catch (err) {
      // Rollback local proxy to previous values using ops metadata
      context.withReconcilingLock(() => {
        for (const op of ops as RawValtioOperation[]) {
          if (isRawSetArrayOp(op)) {
            const idx = op[1][0];
            const index = typeof idx === 'number' ? idx : Number.parseInt(String(idx), 10);
            const prev = op[3];
            arrProxy[index] = prev;
          }
        }
      });
      throw err;
    }
  }, true);
  return unsubscribe;
}

// Subscribe to a Valtio object proxy and translate top-level key operations
// into minimal Y.Map operations. Nested edits are handled by nested controllers.
// Valtio -> Yjs (map):
// - Only handle direct children (path.length === 1). No nested routing here; once
//   a child is upgraded to a controller, its own subscription translates nested edits.
// - Eagerly upgrade assigned plain objects/arrays into Y types and replace the plain
//   values with controller proxies under a reconciliation lock to avoid loops.
function attachValtioMapSubscription(
  context: SynchronizationContext,
  yMap: Y.Map<unknown>,
  objProxy: Record<string, unknown>,
  doc: Y.Doc,
): () => void {
  const unsubscribe = subscribe(objProxy, (ops: unknown[]) => {
    if (context.isReconciling) return;
    
    // Filter out operations on internal properties of Y.js leaf types
    // These operations occur because Valtio deep-proxies leaf types before
    // reconciliation adds them to refSet. We should ignore these internal
    // Y.js property changes and only track top-level assignments.
    const filteredOps = ops.filter((op) => {
      const rawOp = op as RawValtioOperation;
      if (isRawSetMapOp(rawOp)) {
        const path = rawOp[1] as (string | number)[];
        // If path has more than 1 element, it's a nested property change
        // Only allow top-level changes (path.length === 1)
        return path.length === 1;
      }
      return true; // Keep delete ops
    });
    
    if (filteredOps.length === 0) {
      // All ops were filtered out (all were nested Y.js internal changes)
      return;
    }
    
    context.log.debug('[controller][map] ops (filtered)', safeStringify(filteredOps));
    
    // Wrap planning + enqueue in try/catch to rollback local proxy on validation failure
    try {
      // Phase 1: Planning - categorize operations
      const { sets, deletes } = planMapOps(filteredOps);
      
      // Phase 2: Scheduling - enqueue planned operations
      for (const [key, value] of sets) {
        const normalized = value === undefined ? null : value;
        // Validate synchronously before enqueuing (deep validation to catch nested issues)
        validateDeepForSharedState(normalized);
        context.enqueueMapSet(
          yMap,
          key,
          normalized, // Normalize undefined→null defensively
          (yValue: unknown) => upgradeChildIfNeeded(context, objProxy, key, yValue, doc),
        );
      }
      
      for (const key of deletes) {
        context.enqueueMapDelete(yMap, key);
      }
    } catch (err) {
      // Rollback local proxy to previous values using ops metadata
      context.withReconcilingLock(() => {
        for (const op of filteredOps as RawValtioOperation[]) {
          if (isRawSetMapOp(op)) {
            const key = op[1][0];
            const prev = op[3];
            if (prev === undefined) {
              // Key didn't exist before, delete it
              delete objProxy[key];
            } else {
              // Restore previous value
              objProxy[key] = prev;
            }
          }
        }
      });
      throw err;
    }
  }, true);
  return unsubscribe;
}

// Create (or reuse from cache) a Valtio proxy that mirrors a Y.Map.
// Nested Y types are recursively materialized via getOrCreateValtioProxy.
function getOrCreateValtioProxyForYMap(context: SynchronizationContext, yMap: Y.Map<unknown>, doc: Y.Doc): object {
  const existing = context.yTypeToValtioProxy.get(yMap);
  if (existing) return existing;

  const initialObj: Record<string, unknown> = {};
  for (const [key, value] of yMap.entries()) {
    // Check leaf types first (before container check) since some leaf types extend containers
    // (e.g., Y.XmlHook extends Y.Map)
    if (isYLeafType(value)) {
      // Leaf nodes (Y.Text, Y.XmlText, Y.XmlHook): wrap in ref() to prevent deep proxying
      initialObj[key] = ref(value);
    } else if (isYSharedContainer(value)) {
      // Containers: create controller proxy recursively
      initialObj[key] = getOrCreateValtioProxy(context, value, doc);
    } else {
      // Primitives: store as-is
      initialObj[key] = value;
    }
  }
  const objProxy = proxy(initialObj);

  // Setup reactivity for leaf nodes AFTER proxy creation
  for (const [key, value] of yMap.entries()) {
    if (isYLeafType(value)) {
      // Type assertion is safe here because isYLeafType guard confirmed the type
      const leafNode = value as Y.Text | Y.XmlFragment | Y.XmlElement | Y.XmlHook;
      setupLeafNodeReactivity(context, objProxy, key, leafNode);
    }
  }

  context.yTypeToValtioProxy.set(yMap, objProxy);
  context.valtioProxyToYType.set(objProxy, yMap);

  const unsubscribe = attachValtioMapSubscription(context, yMap, objProxy, doc);
  context.registerSubscription(yMap, unsubscribe);

  return objProxy;
}

function getOrCreateValtioProxyForYArray(context: SynchronizationContext, yArray: Y.Array<unknown>, doc: Y.Doc): unknown[] {
  const existing = context.yTypeToValtioProxy.get(yArray) as unknown[] | undefined;
  if (existing) return existing;
  
  const initialItems = yArray.toArray().map((value) => {
    if (isYSharedContainer(value)) {
      // Containers: create controller proxy recursively
      return getOrCreateValtioProxy(context, value, doc);
    } else if (isYLeafType(value)) {
      // Leaf nodes: wrap in ref() to prevent deep proxying
      return ref(value);
    } else {
      // Primitives: store as-is
      return value;
    }
  });
  
  const arrProxy = proxy(initialItems);
  
  // Setup reactivity for leaf nodes AFTER proxy creation
  yArray.toArray().forEach((value, index) => {
    if (isYLeafType(value)) {
      // Type assertion is safe here because isYLeafType guard confirmed the type
      const leafNode = value as Y.Text | Y.XmlFragment | Y.XmlElement | Y.XmlHook;
      setupLeafNodeReactivityInArray(context, arrProxy, index, leafNode);
    }
  });
  
  context.yTypeToValtioProxy.set(yArray, arrProxy);
  context.valtioProxyToYType.set(arrProxy, yArray);
  const unsubscribe = attachValtioArraySubscription(context, yArray, arrProxy, doc);
  context.registerSubscription(yArray, unsubscribe);
  return arrProxy;
}

export function getValtioProxyForYType(context: SynchronizationContext, yType: YSharedContainer): object | undefined {
  return context.yTypeToValtioProxy.get(yType);
}

export function getYTypeForValtioProxy(context: SynchronizationContext, obj: object): YSharedContainer | undefined {
  return context.valtioProxyToYType.get(obj);
}


/**
 * The main router. It takes any Yjs shared type and returns the
 * appropriate Valtio proxy controller for it, creating it if it doesn't exist.
 * 
 * Note: XML types (XmlFragment, XmlElement, XmlHook) are treated as leaf types,
 * so they're handled via the leaf type logic in the map/array proxy creators.
 */
export function getOrCreateValtioProxy(context: SynchronizationContext, yType: YSharedContainer, doc: Y.Doc): object {
  if (isYMap(yType)) {
    return getOrCreateValtioProxyForYMap(context, yType, doc);
  }
  if (isYArray(yType)) {
    return getOrCreateValtioProxyForYArray(context, yType, doc);
  }

  // Fallback for unsupported types
  // Note: No context available here, but this should rarely happen
  if (typeof console !== 'undefined') {
    console.warn(LOG_PREFIX, 'Unsupported Yjs type:', yType);
  }
  return yType as unknown as object;
}



