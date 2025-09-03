// Bridge/Router layer
//
// Responsibility:
// - Materialize real Valtio proxies for Yjs shared types (currently Y.Map).
// - Maintain stable identity via caches (Y type <-> Valtio proxy) inside a context.
// - Reflect local Valtio writes back to Yjs minimally (set/delete) inside
//   transactions tagged with VALTIO_YJS_ORIGIN.
// - Lazily create nested controllers when a Y value is another Y type.
import * as Y from 'yjs';
import { proxy, subscribe } from 'valtio/vanilla';
// import removed: origin tagging handled by context scheduler

import type { YSharedContainer } from '../yjs-types.js';
import { SynchronizationContext } from '../core/context.js';
import { isYSharedContainer, isYArray, isYMap } from '../core/guards.js';
import { LOG_PREFIX } from '../core/constants.js';
import { planMapOps } from '../planning/mapOpsPlanner.js';
import { planArrayOps } from '../planning/arrayOpsPlanner.js';


// All caches are moved into SynchronizationContext

function upgradeChildIfNeeded(
  context: SynchronizationContext,
  container: Record<string, unknown> | unknown[],
  key: string | number,
  yValue: unknown,
  doc: Y.Doc,
): void {
  const current = (container as Record<string, unknown> | unknown[])[key as keyof typeof container] as unknown;
  const isAlreadyController = current && typeof current === 'object' && context.valtioProxyToYType.has(current as object);
  if (!isAlreadyController && isYSharedContainer(yValue)) {
    const newController = getOrCreateValtioProxy(context, yValue, doc);
    context.withReconcilingLock(() => {
      if (Array.isArray(container) && typeof key === 'number') {
        (container as unknown[])[key] = newController as unknown;
      } else {
        (container as Record<string, unknown>)[String(key)] = newController as unknown;
      }
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
    context.log.debug('[controller][array] ops', JSON.stringify(ops));
    
    // Phase 1: Planning - categorize operations into explicit intents
    // Use Y.Array length as the start-of-batch baseline for deterministic planning
    const { sets, deletes, replaces } = planArrayOps(ops, yArray.length, context);
    
    // Phase 2: Scheduling - enqueue planned operations
    
    // Handle replaces first (splice replace operations: delete + set at same index)
    for (const [index, value] of replaces) {
      context.log.debug('[controller][array] enqueue.replace', { index });
      const normalized = value === undefined ? null : value;
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
    
    // Handle pure sets (inserts/pushes/unshifts). If in-bounds, treat as replace defensively.
    for (const [index, value] of sets) {
      const normalized = value === undefined ? null : value;
      if (index < yArray.length) {
        context.log.debug('[controller][array] enqueue.replace(via-set)', { index });
        context.enqueueArrayReplace(
          yArray,
          index,
          normalized,
          (yValue: unknown) => upgradeChildIfNeeded(context, arrProxy, index, yValue, _doc),
        );
      } else {
        context.log.debug('[controller][array] enqueue.set', { index });
        context.enqueueArraySet(
          yArray,
          index,
          normalized, // Normalize undefined→null defensively
          (yValue: unknown) => upgradeChildIfNeeded(context, arrProxy, index, yValue, _doc),
        );
      }
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
    context.log.debug('[controller][map] ops', JSON.stringify(ops));
    
    // Phase 1: Planning - categorize operations
    const { sets, deletes } = planMapOps(ops);
    
    // Phase 2: Scheduling - enqueue planned operations
    for (const [key, value] of sets) {
      const normalized = value === undefined ? null : value;
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
    if (isYSharedContainer(value)) {
      initialObj[key] = getOrCreateValtioProxy(context, value, doc);
    } else {
      initialObj[key] = value;
    }
  }
  const objProxy = proxy(initialObj);

  context.yTypeToValtioProxy.set(yMap, objProxy);
  context.valtioProxyToYType.set(objProxy, yMap);

  const unsubscribe = attachValtioMapSubscription(context, yMap, objProxy, doc);
  context.registerSubscription(yMap, unsubscribe);

  return objProxy;
}

function getOrCreateValtioProxyForYArray(context: SynchronizationContext, yArray: Y.Array<unknown>, doc: Y.Doc): unknown[] {
  const existing = context.yTypeToValtioProxy.get(yArray) as unknown[] | undefined;
  if (existing) return existing;
  const initialItems = yArray
    .toArray()
    .map((value) => (isYSharedContainer(value) ? getOrCreateValtioProxy(context, value, doc) : value));
  const arrProxy = proxy(initialItems);
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
 */
export function getOrCreateValtioProxy(context: SynchronizationContext, yType: YSharedContainer, doc: Y.Doc): object {
  if (isYMap(yType)) {
    return getOrCreateValtioProxyForYMap(context, yType, doc);
  }
  if (isYArray(yType)) {
    return getOrCreateValtioProxyForYArray(context, yType, doc);
  }
  // if (yType instanceof Y.Text) {
  //   return createYTextController(yType, doc);
  // }
  // Future:
  // if (yType instanceof Y.XmlFragment) {
  //   return createYXmlController(yType, doc);
  // }

  // Fallback for unsupported types
  console.warn(LOG_PREFIX, 'Unsupported Yjs type:', yType);
  return yType as unknown as object;
}



