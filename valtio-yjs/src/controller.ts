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

function insertArrayContentSafe(yArray: Y.Array<any>, index: number, items: unknown[]): void {
  const content = Array.isArray(items) ? items.map((v) => (v === undefined ? null : v)) : [];
  if (content.length === 0) return;
  yArray.insert(index, content);
}

// Subscribe to a Valtio array proxy and translate top-level index operations
// into minimal Y.Array operations.
function attachValtioArraySubscription(
  context: SynchronizationContext,
  yArray: Y.Array<any>,
  arrProxy: any[],
  doc: Y.Doc,
): () => void {
  const unsubscribe = subscribe(arrProxy as any, (ops: any[]) => {
    if (context.isReconciling) return;
    const rootIndexOps = ops.filter((op) => Array.isArray(op) && Array.isArray(op[1]) && (op[1] as any[]).length === 1 && typeof (op[1] as any[])[0] === 'number');
    if (rootIndexOps.length === 0) return;
    doc.transact(() => {
      for (const op of rootIndexOps) {
        const type = op[0] as string;
        const index = (op[1] as (string | number)[])[0] as number;
        if (type === 'set') {
          const nextValue = (arrProxy as any[])[index];
          const nestedY = nextValue && typeof nextValue === 'object' ? context.valtioProxyToYType.get(nextValue as object) : undefined;
          const yValue = nestedY ?? (isPlainObject(nextValue) || Array.isArray(nextValue) ? plainObjectToYType(nextValue) : nextValue);
          if (index >= 0) {
            if (index < yArray.length) {
              yArray.delete(index, 1);
              insertArrayContentSafe(yArray, index, [yValue]);
            } else if (index === yArray.length) {
              insertArrayContentSafe(yArray, yArray.length, [yValue]);
            } else {
              // If someone sets a sparse index, fill with nulls up to that index for Yjs compatibility
              const fillCount = index - yArray.length;
              if (fillCount > 0) insertArrayContentSafe(yArray, yArray.length, Array.from({ length: fillCount }, () => null));
              insertArrayContentSafe(yArray, yArray.length, [yValue]);
            }
          }
        } else if (type === 'delete') {
          if (index >= 0 && index < yArray.length) yArray.delete(index, 1);
        }
      }
    }, VALTIO_YJS_ORIGIN);
  });
  return unsubscribe;
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
    // Valtio emits tuple ops: [type, pathArray, value, prev]
    const candidateOps = ops.filter((op) => Array.isArray(op) && Array.isArray(op[1]));
    if (candidateOps.length === 0) return;
    doc.transact(() => {
      for (const op of candidateOps) {
        const type = op[0] as string;
        const path = op[1] as (string | number)[];
        if (path.length === 1) {
          const key = String(path[0]);
          if (type === 'set') {
            const nextValue = (objProxy as any)[key];
            const nestedY =
              nextValue && typeof nextValue === 'object'
                ? context.valtioProxyToYType.get(nextValue as object)
                : undefined;
            if (nestedY) {
              const current = yMap.get(key);
              if (current !== nestedY) {
                // Avoid inserting existing Y types directly; always clone from plain
                // to prevent cross-parent/cross-doc reattachment issues.
                yMap.set(key, plainObjectToYType(nextValue));
              }
            } else if (isPlainObject(nextValue) || Array.isArray(nextValue)) {
              yMap.set(key, plainObjectToYType(nextValue));
            } else {
              yMap.set(key, nextValue);
            }
          } else if (type === 'delete') {
            if (yMap.has(key)) yMap.delete(key);
          }
        } else if (path.length === 2) {
          // Route one-level nested changes (Map -> child Map/Array) directly
          const [parentKeyRaw, childKeyRaw] = path;
          const parentKey = String(parentKeyRaw);
          const parentProxy = (objProxy as any)[parentKey];
          const parentY = parentProxy && typeof parentProxy === 'object' ? context.valtioProxyToYType.get(parentProxy as object) : undefined;
          if (parentY instanceof Y.Map) {
            const childKey = String(childKeyRaw);
            if (type === 'set') {
              const nextValue = (parentProxy as any)[childKey];
              const nestedY =
                nextValue && typeof nextValue === 'object'
                  ? context.valtioProxyToYType.get(nextValue as object)
                  : undefined;
              if (nestedY) {
                const current = parentY.get(childKey);
                if (current !== nestedY) {
                  // Avoid inserting existing Y types directly; always clone from plain
                  parentY.set(childKey, plainObjectToYType(nextValue));
                }
              } else if (isPlainObject(nextValue) || Array.isArray(nextValue)) {
                parentY.set(childKey, plainObjectToYType(nextValue));
              } else {
                parentY.set(childKey, nextValue);
              }
            } else if (type === 'delete') {
              if (parentY.has(childKey)) parentY.delete(childKey);
            }
          } else if (parentY instanceof Y.Array && typeof childKeyRaw === 'number') {
            const index = childKeyRaw as number;
            if (type === 'set') {
              const nextValue = (parentProxy as any[])[index];
              const nestedY = nextValue && typeof nextValue === 'object' ? context.valtioProxyToYType.get(nextValue as object) : undefined;
              const yValue = nestedY ? plainObjectToYType(nextValue) : (isPlainObject(nextValue) || Array.isArray(nextValue) ? plainObjectToYType(nextValue) : nextValue);
              if (index < parentY.length) {
                parentY.delete(index, 1);
                insertArrayContentSafe(parentY, index, [yValue]);
              } else if (index === parentY.length) {
                insertArrayContentSafe(parentY, parentY.length, [yValue]);
              }
            } else if (type === 'delete') {
              if (index >= 0 && index < parentY.length) parentY.delete(index, 1);
            }
          }
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



