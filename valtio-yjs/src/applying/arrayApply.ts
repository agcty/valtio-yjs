import * as Y from 'yjs';
import type { PendingEntry } from '../scheduling/batchTypes.js';
import type { Logger } from '../core/context.js';
import { isYArray, isYMap } from '../core/guards.js';
import { reconcileValtioArray, reconcileValtioMap } from '../reconcile/reconciler.js';
import type { SynchronizationContext } from '../core/context.js';

// Execute array operations per-array using unified delete+insert canonicalization
export function applyArrayOperations(
  context: SynchronizationContext,
  arraySets: Map<Y.Array<unknown>, Map<number, PendingEntry>>,
  arrayDeletes: Map<Y.Array<unknown>, Set<number>>,
  post: Array<() => void>,
): void {
  const allArrays = new Set<Y.Array<unknown>>();
  for (const a of arraySets.keys()) allArrays.add(a);
  for (const a of arrayDeletes.keys()) allArrays.add(a);
  for (const yArray of allArrays) {
    let setsForArray = arraySets.get(yArray) ?? new Map<number, PendingEntry>();
    const deletesForArray = arrayDeletes.get(yArray) ?? new Set<number>();

    // Moves not supported at library level: if any deletes exist for this array
    // in the current batch, ignore all sets (which in this context mostly
    // represent shifts). To preserve splice semantics, remap deletes to the
    // earliest set index if sets were present.
    let spliceBaseIndex: number | null = null;
    let remapDeleteCount = 0;
    if (deletesForArray.size > 0 && setsForArray.size > 0) {
      const sortedDeletes = Array.from(deletesForArray).sort((a, b) => a - b);
      const sortedSets = Array.from(setsForArray.keys()).sort((a, b) => a - b);
      const yLenNow = yArray.length;

      context.log.warn(
        'Potential array move detected. Move operations are not supported. Implement moves at the app layer (e.g., fractional indexing or explicit remove+insert in separate ticks). This is a heuristic and may also occur with splice/replace or reindex shifts.',
        {
          deletes: sortedDeletes,
          sets: sortedSets,
          length: yLenNow,
          suggestions: [
            'If this was a move: perform delete and insert in separate ticks, or use fractional indexing.',
            'If this was a replace/splice: this hint can be ignored; reindexing may emit index sets.',
            'Reduce noise: avoid combining structural deletes with index sets in the same tick when possible.',
          ],
        },
      );
      spliceBaseIndex = Math.min(...Array.from(setsForArray.keys()));
      remapDeleteCount = deletesForArray.size;
      setsForArray = new Map();
    } else if (deletesForArray.size > 0) {
      setsForArray = new Map();
    }

    // Fast-path optimization: when there are no deletes and there are sets,
    // detect head/tail insert patterns and collapse into a single insert.
    if (deletesForArray.size === 0 && setsForArray.size > 0) {
      const sortedSetIndices = Array.from(setsForArray.keys()).sort((a, b) => a - b);
      const firstSetIndex = sortedSetIndices[0]!;
      const lastSetIndex = sortedSetIndices[sortedSetIndices.length - 1]!;
      const yLenAtStart = yArray.length;

      // Detect contiguous coverage
      const isContiguous = lastSetIndex - firstSetIndex + 1 === sortedSetIndices.length;

      if (isContiguous) {
        // Head insert: sets cover [0 .. m-1] with m > yLen → unshift of k = m - yLen
        if (firstSetIndex === 0) {
          const m = sortedSetIndices.length;
          const k = m - yLenAtStart;
          if (k > 0) {
            const items: unknown[] = [];
            const entries: PendingEntry[] = [];
            for (let i = 0; i < k; i++) {
              const entry = setsForArray.get(i)!;
              entries.push(entry);
              items.push(entry.compute());
            }
            const hasDoc = hasYDoc(yArray);
            context.log.debug('[arrayApply] array.unshift.coalesce', { insertCount: items.length, hasDoc });
            const arrayDocNow = getYDoc(yArray);
            yArray.insert(0, items);
            items.forEach((it, i) => {
              const after = entries[i]?.after;
              if (after) post.push(() => after(it));
              if (isYMap(it)) {
                post.push(() => reconcileValtioMap(context, it as Y.Map<unknown>, arrayDocNow!));
              } else if (isYArray(it)) {
                post.push(() => reconcileValtioArray(context, it as Y.Array<unknown>, arrayDocNow!));
              }
            });
            // Done with this array in this flush
            continue;
          }
        }

        // Tail insert: sets cover [yLen .. yLen + k - 1]
        if (firstSetIndex === yLenAtStart) {
          const k = sortedSetIndices.length;
          if (k > 0) {
            const items: unknown[] = [];
            const entries: PendingEntry[] = [];
            for (let i = 0; i < k; i++) {
              const idx = yLenAtStart + i;
              const entry = setsForArray.get(idx)!;
              entries.push(entry);
              items.push(entry.compute());
            }
            const hasDoc = hasYDoc(yArray);
            context.log.debug('[arrayApply] array.push.coalesce', { insertCount: items.length, hasDoc });
            const arrayDocNow = getYDoc(yArray);
            yArray.insert(yArray.length, items);
            items.forEach((it, i) => {
              const after = entries[i]?.after;
              if (after) post.push(() => after(it));
              if (isYMap(it)) {
                post.push(() => reconcileValtioMap(context, it as Y.Map<unknown>, arrayDocNow!));
              } else if (isYArray(it)) {
                post.push(() => reconcileValtioArray(context, it as Y.Array<unknown>, arrayDocNow!));
              }
            });
            // Done with this array in this flush
            continue;
          }
        }
      }
    }

    // Phase 1: Canonicalization — unify into deletes and inserts
    const indicesToDelete = new Set<number>(deletesForArray);
    // Defer insert value materialization until after deletes are applied.
    // This lets us detect that a shared type became detached by earlier deletes
    // in this same flush and clone it at insert-time to avoid reintegration hazards.
    type PendingInsert = { value: unknown; after?: (yValue: unknown) => void };
    const insertsToApply = new Map<number, PendingInsert[]>();
    const sortedSetIndices = Array.from(setsForArray.keys()).sort((a, b) => a - b);

    for (const index of sortedSetIndices) {
      const entry = setsForArray.get(index)!;
      const yValue = entry.compute();
      const arrayDoc = getYDoc(yArray);
      const valueDoc = getYDoc(yValue);
      const valueParent = getParent(yValue);
      const valueType = isYMap(yValue) ? 'Y.Map' : isYArray(yValue) ? 'Y.Array' : typeof yValue;
      context.log.debug('[arrayApply] array.set.compute', {
        index,
        type: valueType,
        valueHasDoc: !!valueDoc,
        arrayHasDoc: !!arrayDoc,
        sameDoc: !!valueDoc && !!arrayDoc ? valueDoc === arrayDoc : undefined,
        parentType: valueParent ? valueParent.constructor.name : null,
        parentIsArray: valueParent === yArray,
      });


      // Model a 'set' as delete + insert at the same index. Carry the
      // computed Y value directly; sets are only allowed when no deletes
      // exist (push/replace), so this is safe and avoids move semantics.
      indicesToDelete.add(index);
      const existing = insertsToApply.get(index) ?? [];
      existing.push({ value: yValue, after: entry.after });
      insertsToApply.set(index, existing);
    }

    // Phase 2: Execute deletes in descending order to avoid index shifts
    if (spliceBaseIndex !== null && remapDeleteCount > 0) {
      for (let i = 0; i < remapDeleteCount; i++) {
        const idx = spliceBaseIndex;
        const hasDoc = hasYDoc(yArray);
        context.log.debug('[arrayApply] array.delete', { index: idx, length: yArray.length, hasDoc });
        if (idx >= 0 && idx < yArray.length) yArray.delete(idx, 1);
      }
    } else {
      const sortedDeletes = Array.from(indicesToDelete).sort((a, b) => b - a);
      for (const index of sortedDeletes) {
        const hasDoc = hasYDoc(yArray);
        context.log.debug('[arrayApply] array.delete', { index, length: yArray.length, hasDoc });
        if (index >= 0 && index < yArray.length) yArray.delete(index, 1);
      }
    }

    // Phase 3: Execute inserts in ascending order using precomputed values
    // Rationale: for batches that only contain sets (modeled as delete+insert
    // at each index), performing inserts ascending preserves intuitive
    // unshift/splice semantics. Descending would invert relative order when
    // multiple indices are affected (e.g., 0,1,2), yielding wrong results
    // like [new, y, x] instead of [new, x, y]. Deletes are applied before
    // inserts, so ascending is safe and deterministic here.
    const sortedInsertIndices = Array.from(insertsToApply.keys()).sort((a, b) => a - b);
    for (const index of sortedInsertIndices) {
      const pendingItems = insertsToApply.get(index)!;

      // Materialize actual items now from the captured plain snapshot so
      // content survives deletes/GC within this transaction.
      const items: unknown[] = pendingItems.map((p) => p.value);

      const targetIndex = index > yArray.length ? yArray.length : index;
      // Inspect first item metadata before insert to detect integration hazards
      const arrayDocNow = getYDoc(yArray);
      const first = items[0];
      const firstDoc = getYDoc(first);
      const firstParent = getParent(first);
      const firstType = isYMap(first) ? 'Y.Map' : isYArray(first) ? 'Y.Array' : typeof first;
      if (targetIndex === yArray.length) {
        const hasDoc = hasYDoc(yArray);
        context.log.debug('[arrayApply] array.append', { index: targetIndex, length: yArray.length, hasDoc });
        context.log.debug('[arrayApply] array.insert.inspect', {
          index: targetIndex,
          count: items.length,
          firstType,
          firstHasDoc: !!firstDoc,
          arrayHasDoc: !!arrayDocNow,
          sameDoc: !!firstDoc && !!arrayDocNow ? firstDoc === arrayDocNow : undefined,
          firstParentType: firstParent ? firstParent.constructor.name : null,
          firstParentIsArray: firstParent === yArray,
        });
        yArray.insert(yArray.length, items);
        // After integration, reconcile inserted shared containers and run post-upgrade
        items.forEach((it, i) => {
          const after = pendingItems[i]?.after;
          if (after) post.push(() => after(it));
          if (isYMap(it)) {
            post.push(() => reconcileValtioMap(context, it as Y.Map<unknown>, arrayDocNow!));
          } else if (isYArray(it)) {
            post.push(() => reconcileValtioArray(context, it as Y.Array<unknown>, arrayDocNow!));
          }
        });
      } else if (targetIndex < yArray.length) {
        const hasDoc = hasYDoc(yArray);
        context.log.debug('[arrayApply] array.insert', { index: targetIndex, length: yArray.length, hasDoc });
        context.log.debug('[arrayApply] array.insert.inspect', {
          index: targetIndex,
          count: items.length,
          firstType,
          firstHasDoc: !!firstDoc,
          arrayHasDoc: !!arrayDocNow,
          sameDoc: !!firstDoc && !!arrayDocNow ? firstDoc === arrayDocNow : undefined,
          firstParentType: firstParent ? firstParent.constructor.name : null,
          firstParentIsArray: firstParent === yArray,
        });
        yArray.insert(targetIndex, items);
        items.forEach((it, i) => {
          const after = pendingItems[i]?.after;
          if (after) post.push(() => after(it));
          if (isYMap(it)) {
            post.push(() => reconcileValtioMap(context, it as Y.Map<unknown>, arrayDocNow!));
          } else if (isYArray(it)) {
            post.push(() => reconcileValtioArray(context, it as Y.Array<unknown>, arrayDocNow!));
          }
        });
      }
    }
  }
}

// Yjs helpers
function hasYDoc(target: unknown): boolean {
  return !!(target as { doc?: unknown }).doc;
}

function getYDoc(target: unknown): Y.Doc | undefined {
  return (target as { doc?: Y.Doc | undefined })?.doc;
}

function getParent(target: unknown): Y.AbstractType<unknown> | null {
  return (target as { parent?: Y.AbstractType<unknown> | null })?.parent ?? null;
}
