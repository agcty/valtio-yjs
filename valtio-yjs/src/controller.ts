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
// import removed: origin tagging handled by context scheduler
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
  const unsubscribe = subscribe(arrProxy as any, (ops: any[]) => {
    if (context.isReconciling) return;
    try { console.log('[valtio-yjs][controller][array] ops', JSON.stringify(ops)); } catch { /* noop */ }
    const directOps = ops.filter((op) => Array.isArray(op) && Array.isArray(op[1]) && (op[1] as any[]).length === 1 && typeof (op[1] as any[])[0] === 'number');
    if (directOps.length === 0) return;
    for (const op of directOps) {
      const type = op[0] as string;
      const index = (op[1] as (string | number)[])[0] as number;
      if (type === 'set' || type === 'delete') {
        if (type === 'set') {
          context.enqueueArraySet(
            yArray,
            index,
            () => plainObjectToYType((arrProxy as any[])[index], context),
            (yValue) => {
              const current = (arrProxy as any[])[index];
              const isAlreadyController = current && typeof current === 'object' && context.valtioProxyToYType.has(current as object);
              if (!isAlreadyController && yValue instanceof Y.AbstractType) {
                const newController = createYjsController(context, yValue, doc);
                context.withReconcilingLock(() => {
                  (arrProxy as any[])[index] = newController as any;
                });
              }
            },
          );
        } else {
          context.enqueueArrayDelete(yArray, index);
        }
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
  yMap: Y.Map<any>,
  objProxy: any,
  doc: Y.Doc,
): () => void {
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
        if (type === 'set') {
          context.enqueueMapSet(
            yMap,
            key,
            () => plainObjectToYType((objProxy as any)[key], context),
            (yValue) => {
              const current = (objProxy as any)[key];
              const isAlreadyController = current && typeof current === 'object' && context.valtioProxyToYType.has(current as object);
              if (!isAlreadyController && yValue instanceof Y.AbstractType) {
                const newController = createYjsController(context, yValue, doc);
                context.withReconcilingLock(() => {
                  (objProxy as any)[key] = newController;
                });
              }
            },
          );
        } else {
          context.enqueueMapDelete(yMap, key);
        }
      }
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



