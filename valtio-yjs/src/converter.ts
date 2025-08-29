/* eslint @typescript-eslint/no-explicit-any: "off" */
import * as Y from 'yjs';

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
export function plainObjectToYType(jsValue: any): any {
  if (jsValue instanceof Y.AbstractType) {
    return jsValue;
  }
  if (jsValue === null || typeof jsValue !== 'object') {
    return jsValue === undefined ? null : jsValue; // Yjs doesn't support undefined
  }

  if (Array.isArray(jsValue)) {
    const yArray = new Y.Array();
    yArray.insert(0, jsValue.map(plainObjectToYType));
    return yArray;
  }

  const yMap = new Y.Map();
  for (const key in jsValue) {
    if (Object.prototype.hasOwnProperty.call(jsValue, key)) {
      const value = jsValue[key];
      if (value !== undefined) {
        yMap.set(key, plainObjectToYType(value));
      }
    }
  }
  return yMap;
}


