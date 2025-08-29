/* eslint @typescript-eslint/no-explicit-any: "off" */
import * as Y from 'yjs';
import { proxy, subscribe } from 'valtio/vanilla';
import { VALTIO_YJS_ORIGIN } from './constants.js';
import { plainObjectToYType } from './converter.js';

// Cache: Y type -> Valtio proxy object
const yTypeToValtioProxy = new WeakMap<Y.AbstractType<any>, any>();
// Reverse cache: Valtio proxy -> Y type
const valtioProxyToYType = new WeakMap<object, Y.AbstractType<any>>();
// Track doc per Y type (for re-subscribing)
const yTypeToDoc = new WeakMap<Y.AbstractType<any>, Y.Doc>();
// Track unsubscribe function for Valtio subscriptions per Y type
const yTypeToUnsubscribe = new WeakMap<Y.AbstractType<any>, () => void>();

function isPlainObject(value: any): boolean {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function attachValtioMapSubscription(yMap: Y.Map<any>, objProxy: any, doc: Y.Doc): () => void {
  const unsubscribe = subscribe(objProxy, (ops: any[]) => {
    // Only translate root-level key changes here; nested changes are handled by nested controllers
    const rootLevelOps = ops.filter((op) => Array.isArray(op.path) && op.path.length === 1 && typeof op.path[0] === 'string');
    if (rootLevelOps.length === 0) return;
    doc.transact(() => {
      for (const op of rootLevelOps) {
        const key = op.path[0] as string;
        if (op.op === 'set') {
          const nextValue = (objProxy as any)[key];
          const nestedY = valtioProxyToYType.get(nextValue as object);
          if (nestedY) {
            yMap.set(key, nestedY);
          } else if (isPlainObject(nextValue) || Array.isArray(nextValue)) {
            yMap.set(key, plainObjectToYType(nextValue));
          } else {
            yMap.set(key, nextValue);
          }
        } else if (op.op === 'delete') {
          if (yMap.has(key)) yMap.delete(key);
        }
      }
    }, VALTIO_YJS_ORIGIN);
  });
  return unsubscribe;
}

function materializeMapToValtio(yMap: Y.Map<any>, doc: Y.Doc): any {
  const existing = yTypeToValtioProxy.get(yMap);
  if (existing) return existing;

  const initialObj: Record<string, any> = {};
  for (const [key, value] of yMap.entries()) {
    if (value instanceof Y.AbstractType) {
      initialObj[key] = createYjsController(value, doc);
    } else {
      initialObj[key] = value;
    }
  }
  const objProxy = proxy(initialObj);

  yTypeToValtioProxy.set(yMap, objProxy);
  valtioProxyToYType.set(objProxy, yMap);
  yTypeToDoc.set(yMap, doc);

  const unsubscribe = attachValtioMapSubscription(yMap, objProxy, doc);
  yTypeToUnsubscribe.set(yMap, unsubscribe);

  return objProxy;
}

export function getValtioProxyForYType(yType: Y.AbstractType<any>): any | undefined {
  return yTypeToValtioProxy.get(yType);
}

export function getYTypeForValtioProxy(obj: object): Y.AbstractType<any> | undefined {
  return valtioProxyToYType.get(obj);
}

export function runWithoutValtioReflection(yType: Y.AbstractType<any>, fn: () => void): void {
  const unsubscribe = yTypeToUnsubscribe.get(yType);
  const doc = yTypeToDoc.get(yType);
  if (unsubscribe) unsubscribe();
  try {
    fn();
  } finally {
    if (yType instanceof Y.Map && doc) {
      const objProxy = yTypeToValtioProxy.get(yType);
      if (objProxy) {
        const newUnsub = attachValtioMapSubscription(yType, objProxy, doc);
        yTypeToUnsubscribe.set(yType, newUnsub);
      }
    }
  }
}

// Map controller: returns a real Valtio proxy representing the Y.Map
export function createYjsMapControllerProxy(yMap: Y.Map<any>, doc: Y.Doc): object {
  return materializeMapToValtio(yMap, doc);
}

/**
 * The main controller router. It takes any Yjs shared type and returns the
 * appropriate controller object for it.
 */
export function createYjsController(yType: Y.AbstractType<any>, doc: Y.Doc): object {
  if (yType instanceof Y.Map) {
    // The Map controller is special, it's the Proxy.
    return createYjsMapControllerProxy(yType, doc);
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



