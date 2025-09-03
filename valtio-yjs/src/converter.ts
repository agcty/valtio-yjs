import * as Y from 'yjs';
import { SynchronizationContext } from './core/context.js';
import { isYArray, isYMap, isYAbstractType } from './core/guards.js';

/**
 * Determines if the provided value is a supported JSON-like primitive.
 * - undefined is allowed at this stage (later coerced to null)
 * - number must be finite
 */
function isSupportedPrimitive(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') return Number.isFinite(value as number);
  return false;
}

/** Returns true if value is a plain object (created by object literal or with null prototype). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Converts known special object instances to serializable primitive representations.
 * - Date → ISO string
 * - RegExp → string representation
 * - URL → href string
 * Returns undefined when the value is not a supported special object.
 */
function convertSpecialObjectIfSupported(value: object): unknown | undefined {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (typeof URL !== 'undefined' && value instanceof URL) return value.href;
  return undefined;
}

/**
 * Recursively converts a Yjs shared type (or primitive) into a plain JavaScript object/array.
 */
export function yTypeToPlainObject(yValue: unknown): unknown {
  if (isYMap(yValue)) {
    const entries = Array.from(yValue.entries()).map(([key, value]) => [key, yTypeToPlainObject(value)] as const);
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
  // Already a Yjs value: return as-is.
  if (isYAbstractType(jsValue)) {
    return jsValue;
  }
  // Primitive whitelist
  if (jsValue === null || typeof jsValue !== 'object') {
    if (!isSupportedPrimitive(jsValue)) {
      throw new Error('[valtio-yjs] Unsupported primitive type.');
    }
    return jsValue === undefined ? null : jsValue;
  }

  // Special supported objects
  const special = convertSpecialObjectIfSupported(jsValue as object);
  if (special !== undefined) return special;

  // If this is one of our controller proxies, return the underlying Y type
  if (context && typeof jsValue === 'object' && context.valtioProxyToYType.has(jsValue)) {
    return context.valtioProxyToYType.get(jsValue);
  }

  if (Array.isArray(jsValue)) {
    const yArray = new Y.Array();
    yArray.insert(0, jsValue.map((v) => plainObjectToYType(v, context)));
    return yArray;
  }

  // Only convert plain objects.
  if (isPlainObject(jsValue)) {
    const yMap = new Y.Map();
    for (const [key, value] of Object.entries(jsValue)) {
      if (value !== undefined) {
        yMap.set(key, plainObjectToYType(value, context));
      }
    }
    return yMap;
  }

  // Unknown object types: throw to make behavior explicit and deterministic
  const ctorName = jsValue.constructor?.name ?? 'UnknownObject';
  throw new Error(
    `[valtio-yjs] Unable to convert non-plain object of type "${ctorName}". ` +
      'Only plain objects/arrays/primitives are supported, with special handling for Date and RegExp.',
  );
}


