import * as Y from 'yjs';
import { SynchronizationContext } from './core/context.js';
import { isYArray, isYMap, isYAbstractType } from './core/guards.js';
import { isPlainObject } from './core/types.js';

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
 * Validates a value before it can be assigned to shared state.
 * Throws synchronously if the value is not supported.
 * This is used by the bridge to validate values before enqueueing.
 */
export function validateValueForSharedState(jsValue: unknown): void {
  // Check for re-parenting of existing Y types
  if (isYAbstractType(jsValue)) {
    if ((jsValue as Y.AbstractType<unknown>).parent !== null) {
      throw new Error(
        '[valtio-yjs] Cannot re-assign a collaborative object that is already in the document. ' +
        'If you intended to move or copy this object, you must explicitly create a deep clone of it ' +
        'at the application layer before assigning it.'
      );
    }
    return; // Y types are valid
  }
  
  // Check primitive types
  if (jsValue === null || typeof jsValue !== 'object') {
    if (jsValue === undefined) {
      throw new Error('[valtio-yjs] undefined is not allowed in shared state. Use null, delete the key, or omit the field.');
    }
    
    const t = typeof jsValue;
    if (t === 'function') {
      throw new Error('[valtio-yjs] Unable to convert function. Functions are not allowed in shared state.');
    }
    if (t === 'symbol') {
      throw new Error('[valtio-yjs] Unable to convert symbol. Symbols are not allowed in shared state.');
    }
    if (t === 'bigint') {
      throw new Error('[valtio-yjs] Unable to convert BigInt. BigInt is not allowed in shared state.');
    }
    if (t === 'number' && !Number.isFinite(jsValue as number)) {
      throw new Error('[valtio-yjs] Infinity and NaN are not allowed in shared state. Only finite numbers are supported.');
    }
    return; // Valid primitive
  }
  
  // Special objects that get converted to strings are valid
  const special = convertSpecialObjectIfSupported(jsValue as object);
  if (special !== undefined) return;
  
  // Arrays and plain objects are valid (will be recursively validated during conversion)
  if (Array.isArray(jsValue) || isPlainObject(jsValue)) return;
  
  // Unknown object types are invalid
  const ctorName = (jsValue as { constructor?: { name?: string } }).constructor?.name ?? 'UnknownObject';
  throw new Error(
    `[valtio-yjs] Unable to convert non-plain object of type "${ctorName}". ` +
      'Only plain objects/arrays/primitives are supported, with special handling for Date and RegExp.',
  );
}

/**
 * Recursively validates complex values (arrays/objects) before enqueueing writes.
 * Ensures we synchronously reject unsupported structures (e.g., undefined inside objects).
 */
export function validateDeepForSharedState(jsValue: unknown): void {
  // Y types are valid, but check for forbidden re-parenting
  if (isYAbstractType(jsValue)) {
    if ((jsValue as Y.AbstractType<unknown>).parent !== null) {
      throw new Error(
        '[valtio-yjs] Cannot re-assign a collaborative object that is already in the document. ' +
        'If you intended to move or copy this object, you must explicitly create a deep clone of it ' +
        'at the application layer before assigning it.'
      );
    }
    return;
  }

  // Primitives: validate and return
  if (jsValue === null || typeof jsValue !== 'object') {
    validateValueForSharedState(jsValue);
    return;
  }

  // Arrays: validate all elements
  if (Array.isArray(jsValue)) {
    for (const item of jsValue) {
      validateDeepForSharedState(item);
    }
    return;
  }

  // Plain objects: reject undefined values and recurse
  if (isPlainObject(jsValue)) {
    for (const [_key, value] of Object.entries(jsValue)) {
      if (value === undefined) {
        throw new Error('[valtio-yjs] undefined is not allowed in objects for shared state. Use null, delete the key, or omit the field.');
      }
      validateDeepForSharedState(value);
    }
    return;
  }

  // Unknown object types are invalid (same rule as validateValueForSharedState)
  const ctorName = (jsValue as { constructor?: { name?: string } }).constructor?.name ?? 'UnknownObject';
  throw new Error(
    `[valtio-yjs] Unable to convert non-plain object of type "${ctorName}". ` +
      'Only plain objects/arrays/primitives are supported, with special handling for Date and RegExp.',
  );
}

/**
 * Recursively converts a plain JavaScript object/array (or primitive) into Yjs shared types.
 * Enforces re-parenting restrictions for collaborative objects.
 */
export function plainObjectToYType(jsValue: unknown, context: SynchronizationContext): unknown {
  // Already a Yjs value: check for forbidden re-parenting
  if (isYAbstractType(jsValue)) {
    // Check if this Yjs type already has a parent (is already in the document tree)
    if ((jsValue as Y.AbstractType<unknown>).parent !== null) {
      throw new Error(
        '[valtio-yjs] Cannot re-assign a collaborative object that is already in the document. ' +
        'If you intended to move or copy this object, you must explicitly create a deep clone of it ' +
        'at the application layer before assigning it.'
      );
    }
    return jsValue;
  }
  
  // Validate the value before conversion (reuse validation logic)
  // Note: This will throw for undefined, functions, symbols, etc.
  if (jsValue === null || typeof jsValue !== 'object') {
    // For primitives, validate first
    validateValueForSharedState(jsValue);
    return jsValue;
  }

  // Special supported objects
  const special = convertSpecialObjectIfSupported(jsValue as object);
  if (special !== undefined) return special;

  // If this is one of our controller proxies, return the underlying Y type if it has no parent,
  // otherwise clone it to prevent re-parenting
  if (context && typeof jsValue === 'object' && context.valtioProxyToYType.has(jsValue)) {
    const underlyingYType = context.valtioProxyToYType.get(jsValue)!;
    // Check if the Y type is already attached to a document
    if (isYAbstractType(underlyingYType)) {
      const yType = underlyingYType as Y.AbstractType<unknown>;
      if (yType.parent !== null) {
        // Y type is already in a document - clone it to prevent re-parenting
        const plainFromProxy = deepPlainFromValtioProxy(jsValue as object, context);
        return plainObjectToYType(plainFromProxy, context);
      }
      // Y type has no parent - safe to return as-is
      return underlyingYType;
    }
    return underlyingYType;
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
      if (value === undefined) {
        throw new Error('[valtio-yjs] undefined is not allowed in objects for shared state. Use null, delete the key, or omit the field.');
      }
      yMap.set(key, plainObjectToYType(value, context));
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

// Build a deep plain JS value from a Valtio controller proxy, without touching its underlying Y types.
function deepPlainFromValtioProxy(value: unknown, context: SynchronizationContext): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => deepPlainFromValtioProxy(v, context));
  }
  // Plain object or Valtio proxy object
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // If nested value is a controller proxy too, recurse similarly
    if (v && typeof v === 'object' && context.valtioProxyToYType.has(v as object)) {
      result[k] = deepPlainFromValtioProxy(v, context);
    } else {
      result[k] = deepPlainFromValtioProxy(v, context);
    }
  }
  return result;
}


