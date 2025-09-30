import * as Y from 'yjs';
import type { PendingArrayEntry } from '../scheduling/batchTypes.js';
import type { SynchronizationContext } from '../core/context.js';
import { plainObjectToYType } from '../converter.js';
import { isYArray, isYMap } from '../core/guards.js';
import { reconcileValtioArray, reconcileValtioMap } from '../reconcile/reconciler.js';

/**
 * Execute array operations with cleaner multi-stage approach based on explicit intents.
 * This handles:
 * 1. Replaces (splice replace operations: delete + insert at same index)
 * 2. Pure deletes (pop, shift, splice deletions)
 * 3. Pure sets (push, unshift, splice insertions)
 */
export function applyArrayOperations(
  context: SynchronizationContext,
  arraySets: Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>,
  arrayDeletes: Map<Y.Array<unknown>, Set<number>>,
  arrayReplaces: Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>,
  post: Array<() => void>,
): void {
  const allArrays = new Set<Y.Array<unknown>>();
  for (const a of arraySets.keys()) allArrays.add(a);
  for (const a of arrayDeletes.keys()) allArrays.add(a);
  for (const a of arrayReplaces.keys()) allArrays.add(a);

  for (const yArray of allArrays) {
    const lengthAtStart = yArray.length;
    const setsForArray = arraySets.get(yArray) ?? new Map<number, PendingArrayEntry>();
    const deletesForArray = arrayDeletes.get(yArray) ?? new Set<number>();
    const replacesForArray = arrayReplaces.get(yArray) ?? new Map<number, PendingArrayEntry>();

    // DEBUG-TRACE: per-array batch snapshot
    try {
      const targetId = (yArray as unknown as { _item?: { id?: { toString?: () => string } } })._item?.id?.toString?.();
      const trace = {
        targetId,
        replaces: Array.from(replacesForArray.keys()).sort((a, b) => a - b),
        deletes: Array.from(deletesForArray.values()).sort((a, b) => a - b),
        sets: Array.from(setsForArray.keys()).sort((a, b) => a - b),
        lengthAtStart: yArray.length,
      };
      console.log('[DEBUG-TRACE] Applying ops for Y.Array:', trace);
    } catch {
      // ignore trace logging errors
    }

    // 1) Handle Replaces first (canonical delete-then-insert at same index)
    handleReplaces(context, yArray, replacesForArray, post);
    console.log('[DEBUG-TRACE] after replaces', {
      len: yArray.length,
      json: toJSONSafe(yArray),
    });

    // 2) Handle Pure Deletes next (descending order to avoid index shifts)
    handleDeletes(context, yArray, deletesForArray);
    console.log('[DEBUG-TRACE] after deletes', {
      len: yArray.length,
      json: toJSONSafe(yArray),
    });

    // 3) Finally, handle Pure Inserts (sets)
    if (setsForArray.size > 0) {
      handleSets(context, yArray, setsForArray, deletesForArray, lengthAtStart, post);
      console.log('[DEBUG-TRACE] after sets', {
        len: yArray.length,
        json: toJSONSafe(yArray),
      });
    }

    // Ensure the controller array proxy structure is fully reconciled after mixed operations
    // to materialize any deep children created during inserts/replaces.
    const arrayDocNow = getYDoc(yArray);
    console.log('[DEBUG-TRACE] scheduling finalize reconcile for array', {
      len: yArray.length,
    });
    post.push(() => reconcileValtioArray(context, yArray, arrayDocNow!));
  }
}

/**
 * Handle replace operations: delete + insert at same index (splice replace)
 */
function handleReplaces(
  context: SynchronizationContext,
  yArray: Y.Array<unknown>,
  replaces: Map<number, PendingArrayEntry>,
  post: Array<() => void>,
): void {
  if (replaces.size === 0) return;

  context.log.debug('[arrayApply] handling replaces', { count: replaces.size });
  
  // Sort indices in descending order to avoid index shifting during deletions
  const sortedIndices = Array.from(replaces.keys()).sort((a, b) => b - a);
  
  for (const index of sortedIndices) {
    const entry = replaces.get(index)!;
    const yValue = plainObjectToYType(entry.value, context);
    
    context.log.debug('[arrayApply] replace', { index });
    
    // Canonical replace: delete then insert, with defensive clamping for safety under rapid mixed ops
    const inBounds = index >= 0 && index < yArray.length;
    if (inBounds) {
      yArray.delete(index, 1);
      const insertIndex = Math.min(Math.max(index, 0), yArray.length);
      yArray.insert(insertIndex, [yValue]);
    } else {
      const safeIndex = Math.max(0, Math.min(index, yArray.length));
      yArray.insert(safeIndex, [yValue]);
    }
    
    // Handle post-integration callbacks
    if (entry.after) {
      post.push(() => entry.after!(yValue));
    }
    
    // Reconcile nested shared types
    const arrayDocNow = getYDoc(yArray);
    if (isYMap(yValue)) {
      post.push(() => reconcileValtioMap(context, yValue as Y.Map<unknown>, arrayDocNow!));
    } else if (isYArray(yValue)) {
      post.push(() => reconcileValtioArray(context, yValue as Y.Array<unknown>, arrayDocNow!));
    }
  }
}

/**
 * Handle pure delete operations
 */
function handleDeletes(
  context: SynchronizationContext,
  yArray: Y.Array<unknown>,
  deletes: Set<number>,
): void {
  if (deletes.size === 0) return;

  context.log.debug('[arrayApply] handling deletes', { count: deletes.size });
  
  // Sort indices in descending order to avoid index shifting issues
  const sortedDeletes = Array.from(deletes).sort((a, b) => b - a);
  
  for (const index of sortedDeletes) {
    context.log.debug('[arrayApply] delete', { index, length: yArray.length });
    if (index >= 0 && index < yArray.length) {
      yArray.delete(index, 1);
    }
  }
}

/**
 * Handle pure set operations (inserts/pushes/unshifts)
 * Includes optimization for contiguous head/tail inserts
 */
function handleSets(
  context: SynchronizationContext,
  yArray: Y.Array<unknown>,
  sets: Map<number, PendingArrayEntry>,
  deletes: Set<number>,
  lengthAtStart: number,
  post: Array<() => void>,
): void {
  if (sets.size === 0) return;

  context.log.debug('[arrayApply] handling sets', { count: sets.size });

  // Deterministic tail-cursor strategy for mixed batches
  // Rule: For each set at index i, if i >= lengthAtStart or i >= firstDeleteIndex,
  // treat as an append using a per-batch tail cursor that starts after replaces+deletes.
  // Otherwise, insert at clamped index.
  const sortedSetIndices = Array.from(sets.keys()).sort((a, b) => a - b);
  const firstDeleteIndex = deletes.size > 0 ? Math.min(...Array.from(deletes)) : Number.POSITIVE_INFINITY;
  // Compute tail cursor deterministically: after replaces (no length change) and deletes
  // we want tail cursor to be yArray.length, but also guarantee that when inserting items
  // that originated from indices >= lengthAtStart, we preserve their relative order and
  // avoid shifting existing in-bounds items like original index 2.
  let tailCursor = yArray.length;

  let hadOutOfBoundsSet = false;

  for (const index of sortedSetIndices) {
    const entry = sets.get(index)!;
    const yValue = plainObjectToYType(entry.value, context);
    {
      const id = (entry.value as { id?: unknown } | null)?.id;
      console.log('[DEBUG-TRACE] apply.set.prepare', { index, hasId: !!id, id });
    }

    if (index > yArray.length) {
      hadOutOfBoundsSet = true;
    }

    const shouldAppend = index >= lengthAtStart || index >= firstDeleteIndex || index >= yArray.length;
    const targetIndex = shouldAppend ? tailCursor : Math.min(Math.max(index, 0), yArray.length);

    context.log.debug('[arrayApply] insert (tail-cursor strategy)', {
      requestedIndex: index,
      targetIndex,
      tailCursor,
      len: yArray.length,
      lengthAtStart,
      firstDeleteIndex: isFinite(firstDeleteIndex) ? firstDeleteIndex : null,
    });

    yArray.insert(targetIndex, [yValue]);
    {
      const id = (yValue as unknown as { get?: (k: string) => unknown } | null)?.get?.('id');
      console.log('[DEBUG-TRACE] apply.set.inserted', { targetIndex, hasYId: !!id, id });
    }
    if (shouldAppend) tailCursor++;

    if (entry.after) {
      post.push(() => entry.after!(yValue));
    }

    const arrayDocNow = getYDoc(yArray);
    if (isYMap(yValue)) {
      post.push(() => reconcileValtioMap(context, yValue as Y.Map<unknown>, arrayDocNow!));
    } else if (isYArray(yValue)) {
      post.push(() => reconcileValtioArray(context, yValue as Y.Array<unknown>, arrayDocNow!));
    }
  }

  if (hadOutOfBoundsSet) {
    const arrayDocNow = getYDoc(yArray);
    post.push(() => reconcileValtioArray(context, yArray, arrayDocNow!));
  }
}

/**
 * Try to optimize contiguous head/tail inserts into single operations
 * Returns true if optimization was applied, false if fallback is needed
 */
function _tryOptimizedInserts(
  context: SynchronizationContext,
  yArray: Y.Array<unknown>,
  sets: Map<number, PendingArrayEntry>,
  post: Array<() => void>,
): boolean {
  const sortedSetIndices = Array.from(sets.keys()).sort((a, b) => a - b);
  const firstSetIndex = sortedSetIndices[0]!;
  const lastSetIndex = sortedSetIndices[sortedSetIndices.length - 1]!;
  const yLenAtStart = yArray.length;

  // Check if indices are contiguous
  const isContiguous = lastSetIndex - firstSetIndex + 1 === sortedSetIndices.length;
  
  if (!isContiguous) return false;

  // Head insert optimization: sets cover [0 .. m-1] → perform a single unshift insert
  // We rely on planner to only include truly new head items in `sets` for this case.
  if (firstSetIndex === 0) {
    const m = sortedSetIndices.length;
    if (m > 0) {
      const items: unknown[] = [];
      const entries: PendingArrayEntry[] = [];
      for (let i = 0; i < m; i++) {
        const entry = sets.get(i)!;
        entries.push(entry);
        items.push(plainObjectToYType(entry.value, context));
      }
      
      context.log.debug('[arrayApply] unshift.coalesce', { insertCount: items.length });
      const arrayDocNow = getYDoc(yArray);
      yArray.insert(0, items);
      
      // Handle post-integration callbacks and reconciliation
      items.forEach((it, i) => {
        const after = entries[i]?.after;
        if (after) post.push(() => after(it));
        if (isYMap(it)) {
          post.push(() => reconcileValtioMap(context, it as Y.Map<unknown>, arrayDocNow!));
        } else if (isYArray(it)) {
          post.push(() => reconcileValtioArray(context, it as Y.Array<unknown>, arrayDocNow!));
        }
      });
      
      return true; // Successfully optimized
    }
  }

  // Tail insert optimization: sets cover [yLen .. yLen + k - 1] → push
  if (firstSetIndex === yLenAtStart) {
    const k = sortedSetIndices.length;
    if (k > 0) {
      const items: unknown[] = [];
      const entries: PendingArrayEntry[] = [];
      for (let i = 0; i < k; i++) {
        const idx = yLenAtStart + i;
        const entry = sets.get(idx)!;
        entries.push(entry);
        items.push(plainObjectToYType(entry.value, context));
      }
      
      context.log.debug('[arrayApply] push.coalesce', { insertCount: items.length });
      const arrayDocNow = getYDoc(yArray);
      yArray.insert(yArray.length, items);
      
      // Handle post-integration callbacks and reconciliation
      items.forEach((it, i) => {
        const after = entries[i]?.after;
        if (after) post.push(() => after(it));
        if (isYMap(it)) {
          post.push(() => reconcileValtioMap(context, it as Y.Map<unknown>, arrayDocNow!));
        } else if (isYArray(it)) {
          post.push(() => reconcileValtioArray(context, it as Y.Array<unknown>, arrayDocNow!));
        }
      });
      
      return true; // Successfully optimized
    }
  }

  return false; // No optimization applied
}

/**
 * Handle individual insert operations for non-contiguous sets
 */
function _handleIndividualInserts(
  context: SynchronizationContext,
  yArray: Y.Array<unknown>,
  sets: Map<number, PendingArrayEntry>,
  deletes: Set<number>,
  lengthAtStart: number,
  post: Array<() => void>,
): void {
  // Sort indices in ascending order for inserts
  const sortedSetIndices = Array.from(sets.keys()).sort((a, b) => a - b);
  
  let hadOutOfBoundsSet = false;
  
  for (const index of sortedSetIndices) {
    const entry = sets.get(index)!;
    const yValue = plainObjectToYType(entry.value, context);
    
    // Check if this is an out-of-bounds set that would create holes
    if (index > yArray.length) {
      hadOutOfBoundsSet = true;
    }
    
    // Adjust insert target relative to deletes: if there were deletions at or before
    // this index in the batch, clamp to current tail to preserve apparent splice order.
    const hasDeleteBeforeOrAt = Array.from(deletes).some((d) => d <= index);
    const baselineTail = Math.max(lengthAtStart - Array.from(deletes).filter((d) => d < lengthAtStart).length, 0);
    const preferTail = hasDeleteBeforeOrAt && index >= baselineTail;
    const targetIndex = preferTail
      ? yArray.length
      : index > yArray.length
        ? yArray.length
        : index;
    context.log.debug('[arrayApply] individual insert', { index: targetIndex, length: yArray.length });
    
    yArray.insert(targetIndex, [yValue]);
    
    // Handle post-integration callbacks and reconciliation
    if (entry.after) {
      post.push(() => entry.after!(yValue));
    }
    
    const arrayDocNow = getYDoc(yArray);
    if (isYMap(yValue)) {
      post.push(() => reconcileValtioMap(context, yValue as Y.Map<unknown>, arrayDocNow!));
    } else if (isYArray(yValue)) {
      post.push(() => reconcileValtioArray(context, yValue as Y.Array<unknown>, arrayDocNow!));
    }
  }
  
  // If we had out-of-bounds sets that created holes in the proxy,
  // we need to reconcile the proxy to remove those holes
  if (hadOutOfBoundsSet) {
    const arrayDocNow = getYDoc(yArray);
    post.push(() => reconcileValtioArray(context, yArray, arrayDocNow!));
  }
}

// Yjs helpers
function getYDoc(target: unknown): Y.Doc | undefined {
  return (target as { doc?: Y.Doc | undefined })?.doc;
}

function toJSONSafe(yArray: Y.Array<unknown>): unknown {
  const arr: unknown = (yArray as unknown as { toJSON?: () => unknown }).toJSON?.();
  return arr ?? undefined;
}