/* eslint @typescript-eslint/no-explicit-any: "off" */
// Controller layer
//
// Responsibility:
// - Materialize real Valtio proxies for Yjs shared types (currently Y.Map).
// - Maintain stable identity via caches (Y type <-> Valtio proxy) inside a context.
// - Reflect local Valtio writes back to Yjs minimally (set/delete) inside
//   transactions tagged with VALTIO_YJS_ORIGIN.
// - Lazily create nested controllers when a Y value is another Y type.
import * as Y from 'yjs';
import { proxy, subscribe } from 'valtio/vanilla';
import { VALTIO_YJS_ORIGIN } from './constants.js';
import { plainObjectToYType } from './converter.js';
import { SynchronizationContext } from './context.js';

// All caches are moved into SynchronizationContext

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
  yArray: Y.Array<any>,
  arrProxy: any[],
  doc: Y.Doc,
): () => void {
  // Microtask-batched queue of direct index ops per controller
  type ArrayOp = { type: 'set' | 'delete'; index: number };
  const pendingOps = new Map<number, ArrayOp>();
  let flushScheduled = false;

  const flush = () => {
    flushScheduled = false;
    // Collect eager upgrades to run post-transaction
    const postUpgrades: Array<() => void> = [];
    // Apply latest op per index deterministically by ascending index
    const entries = Array.from(pendingOps.values()).sort((a, b) => a.index - b.index);
    pendingOps.clear();
    if (entries.length === 0) return;
    doc.transact(() => {
      for (const op of entries) {
        const { type, index } = op;
        if (type === 'set') {
          const nextValue = (arrProxy as any[])[index];
          try { console.log('[valtio-yjs][controller][array] flush set index', index, { isObject: !!nextValue && typeof nextValue === 'object' }); } catch { /* noop */ }
          const isAlreadyController =
            nextValue && typeof nextValue === 'object' && context.valtioProxyToYType.has(nextValue as object);
          const yValue = plainObjectToYType(nextValue, context);
          if (!isAlreadyController && yValue instanceof Y.AbstractType) {
            postUpgrades.push(() => {
              const newController = createYjsController(context, yValue, doc);
              context.withReconcilingLock(() => {
                (arrProxy as any[])[index] = newController as any;
              });
            });
          }
          if (index >= 0) {
            if (index < yArray.length) {
              yArray.delete(index, 1);
              yArray.insert(index, [yValue]);
            } else if (index === yArray.length) {
              yArray.insert(yArray.length, [yValue]);
            } else {
              const fillCount = index - yArray.length;
              if (fillCount > 0) yArray.insert(yArray.length, Array.from({ length: fillCount }, () => null));
              yArray.insert(yArray.length, [yValue]);
            }
          }
        } else if (type === 'delete') {
          if (index >= 0 && index < yArray.length) yArray.delete(index, 1);
        }
      }
    }, VALTIO_YJS_ORIGIN);
    if (postUpgrades.length > 0) {
      for (const run of postUpgrades) run();
    }
  };

  const unsubscribe = subscribe(arrProxy as any, (ops: any[]) => {
    if (context.isReconciling) return;
    try { console.log('[valtio-yjs][controller][array] ops', JSON.stringify(ops)); } catch { /* noop */ }
    const directOps = ops.filter((op) => Array.isArray(op) && Array.isArray(op[1]) && (op[1] as any[]).length === 1 && typeof (op[1] as any[])[0] === 'number');
    if (directOps.length === 0) return;
    for (const op of directOps) {
      const type = op[0] as string;
      const index = (op[1] as (string | number)[])[0] as number;
      if (type === 'set' || type === 'delete') {
        pendingOps.set(index, { type: type as 'set' | 'delete', index });
      }
    }
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flush);
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
  yMap: Y.Map<any>,
  objProxy: any,
  doc: Y.Doc,
): () => void {
  // Microtask-batched queue of direct child ops per controller
  type MapOp = { type: 'set' | 'delete'; key: string };
  const pendingOps = new Map<string, MapOp>();
  let flushScheduled = false;

  const flush = () => {
    flushScheduled = false;
    const postUpgrades: Array<() => void> = [];
    const entries = Array.from(pendingOps.values());
    pendingOps.clear();
    if (entries.length === 0) return;
    doc.transact(() => {
      for (const op of entries) {
        const { type, key } = op;
        if (type === 'set') {
          const nextValue = (objProxy as any)[key];
          try { console.log('[valtio-yjs][controller][map] flush set key', key, { isObject: !!nextValue && typeof nextValue === 'object' }); } catch { /* noop */ }
          const isAlreadyController =
            nextValue && typeof nextValue === 'object' && context.valtioProxyToYType.has(nextValue as object);
          const yValue = plainObjectToYType(nextValue, context);
          yMap.set(key, yValue);
          if (!isAlreadyController && yValue instanceof Y.AbstractType) {
            postUpgrades.push(() => {
              const newController = createYjsController(context, yValue, doc);
              context.withReconcilingLock(() => {
                (objProxy as any)[key] = newController;
              });
            });
          }
        } else if (type === 'delete') {
          if (yMap.has(key)) yMap.delete(key);
        }
      }
    }, VALTIO_YJS_ORIGIN);
    if (postUpgrades.length > 0) {
      for (const run of postUpgrades) run();
    }
  };

  const unsubscribe = subscribe(objProxy, (ops: any[]) => {
    if (context.isReconciling) return;
    try { console.log('[valtio-yjs][controller][map] ops', JSON.stringify(ops)); } catch { /* noop */ }
    const candidateOps = ops.filter((op) => Array.isArray(op) && Array.isArray(op[1]));
    // Only queue direct children for this controller
    const directOps = candidateOps.filter((op) => (op[1] as (string | number)[]).length === 1);
    if (directOps.length === 0) return;
    for (const op of directOps) {
      const type = op[0] as string;
      const key = String((op[1] as (string | number)[])[0]);
      if (type === 'set' || type === 'delete') {
        pendingOps.set(key, { type: type as 'set' | 'delete', key });
      }
    }
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flush);
    }
  }, true);
  return unsubscribe;
}

// Create (or reuse from cache) a Valtio proxy that mirrors a Y.Map.
// Nested Y types are recursively materialized via createYjsController.
function materializeMapToValtio(context: SynchronizationContext, yMap: Y.Map<any>, doc: Y.Doc): any {
  const existing = context.yTypeToValtioProxy.get(yMap);
  if (existing) return existing;

  const initialObj: Record<string, any> = {};
  for (const [key, value] of yMap.entries()) {
    if (value instanceof Y.AbstractType) {
      initialObj[key] = createYjsController(context, value, doc);
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

function materializeArrayToValtio(context: SynchronizationContext, yArray: Y.Array<any>, doc: Y.Doc): any[] {
  const existing = context.yTypeToValtioProxy.get(yArray) as any[] | undefined;
  if (existing) return existing;
  const initialItems = yArray.toArray().map((value) => (value instanceof Y.AbstractType ? createYjsController(context, value, doc) : value));
  const arrProxy = proxy(initialItems) as unknown as any[];
  context.yTypeToValtioProxy.set(yArray as unknown as Y.AbstractType<any>, arrProxy);
  context.valtioProxyToYType.set(arrProxy as unknown as object, yArray as unknown as Y.AbstractType<any>);
  const unsubscribe = attachValtioArraySubscription(context, yArray, arrProxy, doc);
  context.registerSubscription(yArray as unknown as Y.AbstractType<any>, unsubscribe);
  return arrProxy;
}

export function getValtioProxyForYType(context: SynchronizationContext, yType: Y.AbstractType<any>): any | undefined {
  return context.yTypeToValtioProxy.get(yType);
}

export function getYTypeForValtioProxy(context: SynchronizationContext, obj: object): Y.AbstractType<any> | undefined {
  return context.valtioProxyToYType.get(obj);
}

// Reflection lock is handled by context.isReconciling; no unsubscribe/resubscribe required.

// Map controller: returns a real Valtio proxy representing the Y.Map
export function createYjsMapControllerProxy(context: SynchronizationContext, yMap: Y.Map<any>, doc: Y.Doc): object {
  return materializeMapToValtio(context, yMap, doc);
}

/**
 * The main controller router. It takes any Yjs shared type and returns the
 * appropriate controller object for it.
 */
export function createYjsController(context: SynchronizationContext, yType: Y.AbstractType<any>, doc: Y.Doc): object {
  if (yType instanceof Y.Map) {
    // The Map controller is special, it's the Proxy.
    return createYjsMapControllerProxy(context, yType, doc);
  }
  if (yType instanceof Y.Array) {
    return materializeArrayToValtio(context, yType, doc) as unknown as object;
  }
  // if (yType instanceof Y.Text) {
  //   return createYTextController(yType, doc);
  // }
  // Future:
  // if (yType instanceof Y.XmlFragment) {
  //   return createYXmlController(yType, doc);
  // }

  // Fallback for unsupported types
  console.warn('Unsupported Yjs type:', yType);
  return yType as unknown as object;
}



