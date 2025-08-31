import * as Y from 'yjs';
import { SynchronizationContext } from './context.js';
import { isYArray, isYMap, isYAbstractType } from './guards.js';

/**
 * Recursively converts a Yjs shared type (or primitive) into a plain JavaScript object/array.
 */
export function yTypeToPlainObject(yValue: unknown): unknown {
  if (isYMap(yValue)) {
    const entries = Array.from(yValue.entries()).map(([key, value]) => [
      key,
      yTypeToPlainObject(value),
    ] as const);
    return Object.fromEntries(entries);
  }
  if (isYArray(yValue)) {
    return yValue.toArray().map(yTypeToPlainObject);
  }
  return yValue;
}

/**
 * Recursively converts a plain JavaScript object/array (or primitive) into Yjs shared types.
 */
export function plainObjectToYType(jsValue: unknown, context: SynchronizationContext): unknown {
  if (isYAbstractType(jsValue)) {
    return jsValue;
  }
  if (jsValue === null || typeof jsValue !== 'object') {
    // Yjs doesn't support undefined
    return jsValue === undefined ? null : jsValue;
  }

  // If this is one of our controller proxies, return the underlying Y type
  if (context && typeof jsValue === 'object' && context.valtioProxyToYType.has(jsValue)) {
    return context.valtioProxyToYType.get(jsValue);
  }

  if (Array.isArray(jsValue)) {
    const yArray = new Y.Array<unknown>();
    yArray.insert(0, jsValue.map((v) => plainObjectToYType(v, context)));
    return yArray;
  }

  // Only convert plain objects. Anything else (e.g., Date) is returned as-is
  const proto = Object.getPrototypeOf(jsValue);
  if (proto === Object.prototype || proto === null) {
    const yMap = new Y.Map<unknown>();
    for (const key in jsValue as Record<string, unknown>) {
      if (Object.prototype.hasOwnProperty.call(jsValue, key)) {
        const value = (jsValue as Record<string, unknown>)[key];
        if (value !== undefined) {
          yMap.set(key, plainObjectToYType(value, context));
        }
      }
    }
    return yMap;
  }

  return jsValue;
}


