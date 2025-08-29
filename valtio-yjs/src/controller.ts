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

function isPlainObject(value: any): boolean {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Subscribe to a Valtio object proxy and translate top-level key operations
// into minimal Y.Map operations. Nested edits are handled by nested controllers.
function attachValtioMapSubscription(
  context: SynchronizationContext,
  yMap: Y.Map<any>,
  objProxy: any,
  doc: Y.Doc,
): () => void {
  const unsubscribe = subscribe(objProxy, (ops: any[]) => {
    if (context.isReconciling) return;
    // Only translate root-level key changes here; nested changes are handled by nested controllers
    // Valtio emits tuple ops: [type, pathArray, value, prev]
    const rootLevelOps = ops.filter((op) => {
      return (
        Array.isArray(op) &&
        Array.isArray(op[1]) &&
        op[1].length === 1 &&
        typeof op[1][0] === 'string'
      );
    });
    if (rootLevelOps.length === 0) return;
    doc.transact(() => {
      for (const op of rootLevelOps) {
        const type = op[0] as string;
        const key = (op[1] as (string | number)[])[0] as string;
        if (type === 'set') {
          const nextValue = (objProxy as any)[key];
          const nestedY =
            nextValue && typeof nextValue === 'object'
              ? context.valtioProxyToYType.get(nextValue as object)
              : undefined;
          if (nestedY) {
            yMap.set(key, nestedY);
          } else if (isPlainObject(nextValue) || Array.isArray(nextValue)) {
            yMap.set(key, plainObjectToYType(nextValue));
          } else {
            yMap.set(key, nextValue);
          }
        } else if (type === 'delete') {
          if (yMap.has(key)) yMap.delete(key);
        }
      }
    }, VALTIO_YJS_ORIGIN);
  });
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
  // if (yType instanceof Y.Array) {
  //   return createYArrayController(yType, doc);
  // }
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



