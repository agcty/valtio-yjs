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
import type { AnySharedType } from './context.js';
import { SynchronizationContext } from './context.js';
// Typed representation of Valtio subscribe ops we care about
type ValtioPath = Array<string | number>;
type ValtioSetOp = ['set', ValtioPath, unknown, unknown];
type ValtioDeleteOp = ['delete', ValtioPath];
// Note: we only use guards, not the union alias directly

function isArrayOfUnknown(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isSetOp(op: unknown): op is ValtioSetOp {
  return Array.isArray(op) && op[0] === 'set' && Array.isArray(op[1]);
}

function isDeleteOp(op: unknown): op is ValtioDeleteOp {
  return Array.isArray(op) && op[0] === 'delete' && Array.isArray(op[1]);
}


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
  yArray: Y.Array<unknown>,
  arrProxy: unknown[],
  doc: Y.Doc,
): () => void {
  const unsubscribe = subscribe(arrProxy as unknown as object, (ops: unknown[]) => {
    if (context.isReconciling) return;
    try { console.log('[valtio-yjs][controller][array] ops', JSON.stringify(ops)); } catch { /* noop */ }
    // Accept direct child mutations; index may be a number or a numeric string
    const directOps = ops.filter((op) => {
      if (!(isSetOp(op) || isDeleteOp(op))) return false;
      const path = op[1];
      return isArrayOfUnknown(path) && path.length === 1 && /^\d+$/.test(String(path[0] as unknown));
    }) as (ValtioSetOp | ValtioDeleteOp)[];
    if (directOps.length === 0) return;
    for (const op of directOps) {
      const type = op[0] as string;
      const index = Number(op[1][0]);
      if (type === 'set' || type === 'delete') {
        if (type === 'set') {
          context.enqueueArraySet(
            yArray,
            index,
            () => plainObjectToYType((arrProxy as unknown[])[index], context),
            (yValue: unknown) => {
              const current = (arrProxy as unknown[])[index] as unknown;
              const isAlreadyController = current && typeof current === 'object' && context.valtioProxyToYType.has(current as object);
              if (!isAlreadyController && (yValue instanceof Y.Map || yValue instanceof Y.Array)) {
                const newController = createYjsController(context, yValue, doc);
                context.withReconcilingLock(() => {
                  (arrProxy as unknown[])[index] = newController as unknown;
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
  yMap: Y.Map<unknown>,
  objProxy: Record<string, unknown>,
  doc: Y.Doc,
): () => void {
  const unsubscribe = subscribe(objProxy as unknown as object, (ops: unknown[]) => {
    if (context.isReconciling) return;
    try { console.log('[valtio-yjs][controller][map] ops', JSON.stringify(ops)); } catch { /* noop */ }
    const candidateOps = ops.filter((op) => (isSetOp(op) || isDeleteOp(op)));
    // Only queue direct children for this controller
    const directOps = (candidateOps as (ValtioSetOp | ValtioDeleteOp)[]).filter((op) => op[1].length === 1);
    if (directOps.length === 0) return;
    for (const op of directOps) {
      const type = op[0] as string;
      const key = String(op[1][0]);
      if (type === 'set' || type === 'delete') {
        if (type === 'set') {
          context.enqueueMapSet(
            yMap,
            key,
            () => plainObjectToYType(objProxy[key], context),
            (yValue: unknown) => {
              const current = objProxy[key];
              const isAlreadyController = current && typeof current === 'object' && context.valtioProxyToYType.has(current as object);
              if (!isAlreadyController && (yValue instanceof Y.Map || yValue instanceof Y.Array)) {
                const newController = createYjsController(context, yValue, doc);
                context.withReconcilingLock(() => {
                  (objProxy as Record<string, unknown>)[key] = newController;
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
function materializeMapToValtio(context: SynchronizationContext, yMap: Y.Map<unknown>, doc: Y.Doc): object {
  const existing = context.yTypeToValtioProxy.get(yMap as unknown as AnySharedType);
  if (existing) return existing;

  const initialObj: Record<string, unknown> = {};
  for (const [key, value] of yMap.entries()) {
    if (value instanceof Y.Map || value instanceof Y.Array) {
      initialObj[key] = createYjsController(context, value as AnySharedType, doc);
    } else {
      initialObj[key] = value;
    }
  }
  const objProxy = proxy(initialObj);

  context.yTypeToValtioProxy.set(yMap as unknown as AnySharedType, objProxy);
  context.valtioProxyToYType.set(objProxy, yMap as unknown as AnySharedType);

  const unsubscribe = attachValtioMapSubscription(context, yMap, objProxy, doc);
  context.registerSubscription(yMap as unknown as AnySharedType, unsubscribe);

  return objProxy as unknown as object;
}

function materializeArrayToValtio(context: SynchronizationContext, yArray: Y.Array<unknown>, doc: Y.Doc): unknown[] {
  const existing = context.yTypeToValtioProxy.get(yArray as unknown as AnySharedType) as unknown[] | undefined;
  if (existing) return existing;
  const initialItems = yArray
    .toArray()
    .map((value) => (value instanceof Y.Map || value instanceof Y.Array ? createYjsController(context, value as AnySharedType, doc) : value));
  const arrProxy = proxy(initialItems) as unknown as unknown[];
  context.yTypeToValtioProxy.set(yArray as unknown as AnySharedType, arrProxy as unknown as object);
  context.valtioProxyToYType.set(arrProxy as unknown as object, yArray as unknown as AnySharedType);
  const unsubscribe = attachValtioArraySubscription(context, yArray, arrProxy, doc);
  context.registerSubscription(yArray as unknown as AnySharedType, unsubscribe);
  return arrProxy;
}

export function getValtioProxyForYType(context: SynchronizationContext, yType: AnySharedType): object | undefined {
  return context.yTypeToValtioProxy.get(yType);
}

export function getYTypeForValtioProxy(context: SynchronizationContext, obj: object): AnySharedType | undefined {
  return context.valtioProxyToYType.get(obj);
}

// Reflection lock is handled by context.isReconciling; no unsubscribe/resubscribe required.

// Map controller: returns a real Valtio proxy representing the Y.Map
export function createYjsMapControllerProxy(context: SynchronizationContext, yMap: Y.Map<unknown>, doc: Y.Doc): object {
  return materializeMapToValtio(context, yMap, doc);
}

/**
 * The main controller router. It takes any Yjs shared type and returns the
 * appropriate controller object for it.
 */
export function createYjsController(context: SynchronizationContext, yType: AnySharedType, doc: Y.Doc): object {
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



