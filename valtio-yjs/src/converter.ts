/* eslint @typescript-eslint/no-explicit-any: "off" */
import * as Y from 'yjs';
import { SynchronizationContext } from './context.js';

/**
 * Recursively converts a Yjs shared type (or primitive) into a plain JavaScript object/array.
 */
export function yTypeToPlainObject(yValue: any): any {
  if (yValue instanceof Y.Map) {
    const entries = Array.from(yValue.entries()).map(([key, value]) => [
      key,
      yTypeToPlainObject(value),
    ] as const);
    return Object.fromEntries(entries);
  }
  if (yValue instanceof Y.Array) {
    return yValue.toArray().map(yTypeToPlainObject);
  }
  return yValue;
}

/**
 * Recursively converts a plain JavaScript object/array (or primitive) into Yjs shared types.
 */
export function plainObjectToYType(jsValue: any, context: SynchronizationContext): any {
  if (jsValue instanceof Y.AbstractType) {
    return jsValue;
  }
  if (jsValue === null || typeof jsValue !== 'object') {
    return jsValue === undefined ? null : jsValue; // Yjs doesn't support undefined
  }

  // If this is one of our controller proxies, return the underlying Y type
  if (context && typeof jsValue === 'object' && context.valtioProxyToYType.has(jsValue as object)) {
    return context.valtioProxyToYType.get(jsValue as object) as Y.AbstractType<any>;
  }

  if (Array.isArray(jsValue)) {
    const yArray = new Y.Array();
    yArray.insert(0, jsValue.map((v: any) => plainObjectToYType(v, context)));
    return yArray;
  }

  // Only convert plain objects. Anything else (e.g., Date) is returned as-is
  const proto = Object.getPrototypeOf(jsValue);
  if (proto === Object.prototype || proto === null) {
    const yMap = new Y.Map();
    for (const key in jsValue) {
      if (Object.prototype.hasOwnProperty.call(jsValue, key)) {
        const value = jsValue[key];
        if (value !== undefined) {
          yMap.set(key, plainObjectToYType(value, context));
        }
      }
    }
    return yMap;
  }

  return jsValue;
}


