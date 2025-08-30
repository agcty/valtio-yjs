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
import { isSharedType } from './guards.js';
// Refined Valtio operation types and guards
type ValtioMapPath = [string];
type ValtioArrayPath = [number | string];
type ValtioSetMapOp = ['set', ValtioMapPath, unknown, unknown];
type ValtioDeleteMapOp = ['delete', ValtioMapPath];
type ValtioSetArrayOp = ['set', ValtioArrayPath, unknown, unknown];
type ValtioDeleteArrayOp = ['delete', ValtioArrayPath, unknown];

function isSetMapOp(op: unknown): op is ValtioSetMapOp {
  return Array.isArray(op) && op[0] === 'set' && Array.isArray(op[1]) && op[1].length === 1 && typeof op[1][0] === 'string';
}

function isDeleteMapOp(op: unknown): op is ValtioDeleteMapOp {
  return Array.isArray(op) && op[0] === 'delete' && Array.isArray(op[1]) && op[1].length === 1 && typeof op[1][0] === 'string';
}

function isSetArrayOp(op: unknown): op is ValtioSetArrayOp {
  if (!Array.isArray(op) || op[0] !== 'set' || !Array.isArray(op[1]) || op[1].length !== 1) return false;
  const idx = (op as [string, [number | string]])[1][0];
  return typeof idx === 'number' || (typeof idx === 'string' && /^\d+$/.test(idx));
}

function isDeleteArrayOp(op: unknown): op is ValtioDeleteArrayOp {
  if (!Array.isArray(op) || op[0] !== 'delete' || !Array.isArray(op[1]) || op[1].length !== 1) return false;
  const idx = (op as [string, [number | string]])[1][0];
  return typeof idx === 'number' || (typeof idx === 'string' && /^\d+$/.test(idx));
}


// All caches are moved into SynchronizationContext

// Normalize array path indices coming from Valtio subscribe.
// Rationale: Valtio reports path segments as property keys; for arrays these
// can arrive as numeric-like strings (e.g. "2"). The controller is our
// boundary to external semantics, so we normalize here to ensure the rest of
// the pipeline (context, Yjs ops) sees numeric indices only. Keeping the
// union type local avoids leaking dependency details and reduces branching
// elsewhere.
function normalizeIndex(idx: number | string): number {
  return typeof idx === 'number' ? idx : Number.parseInt(idx, 10);
}

function upgradeChildIfNeeded(
  context: SynchronizationContext,
  container: Record<string, unknown> | unknown[],
  key: string | number,
  yValue: unknown,
  doc: Y.Doc,
): void {
  const current = (container as Record<string, unknown> | unknown[])[key as keyof typeof container] as unknown;
  const isAlreadyController = current && typeof current === 'object' && context.valtioProxyToYType.has(current as object);
  if (!isAlreadyController && (yValue instanceof Y.Map || yValue instanceof Y.Array)) {
    const newController = createYjsController(context, yValue as AnySharedType, doc);
    context.withReconcilingLock(() => {
      if (Array.isArray(container) && typeof key === 'number') {
        (container as unknown[])[key] = newController as unknown;
      } else {
        (container as Record<string, unknown>)[String(key)] = newController as unknown;
      }
    });
  }
}

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
    console.log('[valtio-yjs][controller][array] ops', JSON.stringify(ops));
    // Phase 1: categorize actionable ops (ignore length changes etc.)
    const deletes = new Map<number, unknown>(); // index -> previous value
    const sets = new Map<number, unknown>(); // index -> new value
    for (const op of ops) {
      if (isDeleteArrayOp(op)) {
        const idx = normalizeIndex(op[1][0]);
        deletes.set(idx, (op as unknown as [string, [number | string], unknown])[2]);
      } else if (isSetArrayOp(op)) {
        const idx = normalizeIndex(op[1][0]);
        sets.set(idx, (op as unknown as [string, [number | string], unknown, unknown])[2]);
      }
    }

    // Phase 2: detect intra-array moves by identity
    const moves: Array<{ from: number; to: number }> = [];
    for (const [deleteIndex, deletedValue] of Array.from(deletes.entries())) {
      if (!deletedValue || typeof deletedValue !== 'object') continue;
      let matched = false;
      for (const [setIndex, setValue] of Array.from(sets.entries())) {
        if (setValue === deletedValue) {
          moves.push({ from: deleteIndex, to: setIndex });
          deletes.delete(deleteIndex);
          sets.delete(setIndex);
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }

    // Phase 3: enqueue high-level operations
    for (const move of moves) {
      context.enqueueArrayMove(yArray, move.from, move.to);
    }
    for (const [index] of deletes.entries()) {
      context.enqueueArrayDelete(yArray, index);
    }
    for (const [idx] of sets.entries()) {
      context.enqueueArraySet(
        yArray,
        idx,
        () => plainObjectToYType((arrProxy as unknown[])[idx], context),
        (yValue: unknown) => upgradeChildIfNeeded(context, arrProxy as unknown[], idx, yValue, doc),
      );
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
    console.log('[valtio-yjs][controller][map] ops', JSON.stringify(ops));
    for (const op of ops) {
      if (isSetMapOp(op)) {
        const key = op[1][0];
        context.enqueueMapSet(
          yMap,
          key,
          () => plainObjectToYType(objProxy[key], context),
          (yValue: unknown) => upgradeChildIfNeeded(context, objProxy, key, yValue, doc),
        );
        continue;
      }
      if (isDeleteMapOp(op)) {
        const key = op[1][0];
        context.enqueueMapDelete(yMap, key);
        continue;
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
    if (isSharedType(value)) {
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
    .map((value) => (isSharedType(value) ? createYjsController(context, value as AnySharedType, doc) : value));
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



