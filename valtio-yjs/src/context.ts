import * as Y from 'yjs';
import { isYArray, isYMap, isYSharedContainer } from './guards.js';
import { reconcileValtioArray, reconcileValtioMap } from './reconciler.js';
import { plainObjectToYType, yTypeToPlainObject } from './converter.js';
import { VALTIO_YJS_ORIGIN } from './constants.js';
import type { YSharedContainer } from './yjs-types.js';

/**
 * Encapsulates all state for a single valtio-yjs instance.
 * Holds caches, subscription disposers, and a reconciliation flag.
 */
export type AnySharedType = YSharedContainer;

// Internal type used for pending compute entries in batched operations
type PendingEntry = {
  compute: () => unknown;
  after?: (yValue: unknown) => void;
  plain?: unknown;
  isGapSet?: boolean;
};

export class SynchronizationContext {
  // Caches: Y type <-> Valtio proxy
  readonly yTypeToValtioProxy = new WeakMap<AnySharedType, object>();
  readonly valtioProxyToYType = new WeakMap<object, AnySharedType>();

  // Track unsubscribe function for Valtio subscriptions per Y type
  readonly yTypeToUnsubscribe = new WeakMap<AnySharedType, () => void>();

  // Track all unsubscribe functions for a full dispose
  private readonly allUnsubscribers = new Set<() => void>();

  // Global flag used to prevent reflecting Valtio changes back into Yjs
  isReconciling = false;

  // Write scheduler (single per context)
  private boundDoc: Y.Doc | null = null;
  private flushScheduled = false;
  // Pending ops, deduped per target and key/index
  private pendingMapSets = new Map<Y.Map<unknown>, Map<string, PendingEntry>>();
  private pendingMapDeletes = new Map<Y.Map<unknown>, Set<string>>();
  private pendingArraySets = new Map<Y.Array<unknown>, Map<number, PendingEntry>>();
  private pendingArrayDeletes = new Map<Y.Array<unknown>, Set<number>>();

  withReconcilingLock(fn: () => void): void {
    const previous = this.isReconciling;
    this.isReconciling = true;
    try {
      fn();
    } finally {
      this.isReconciling = previous;
    }
  }

  registerSubscription(yType: AnySharedType, unsubscribe: () => void): void {
    const existing = this.yTypeToUnsubscribe.get(yType);
    if (existing) existing();
    this.yTypeToUnsubscribe.set(yType, unsubscribe);
    this.allUnsubscribers.add(unsubscribe);
  }

  disposeAll(): void {
    for (const unsub of this.allUnsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    this.allUnsubscribers.clear();
  }

  bindDoc(doc: Y.Doc): void {
    this.boundDoc = doc;
  }

  // Enqueue operations
  enqueueMapSet(
    yMap: Y.Map<unknown>,
    key: string,
    computeYValue: () => unknown,
    postUpgrade?: (yValue: unknown) => void,
  ): void {
    let perMap = this.pendingMapSets.get(yMap);
    if (!perMap) {
      perMap = new Map();
      this.pendingMapSets.set(yMap, perMap);
    }
    perMap.set(key, { compute: computeYValue, after: postUpgrade });
    // ensure delete is overridden by set
    const delSet = this.pendingMapDeletes.get(yMap);
    if (delSet) delSet.delete(key);
    this.scheduleFlush();
  }

  enqueueMapDelete(yMap: Y.Map<unknown>, key: string): void {
    let perMap = this.pendingMapDeletes.get(yMap);
    if (!perMap) {
      perMap = new Set();
      this.pendingMapDeletes.set(yMap, perMap);
    }
    perMap.add(key);
    // delete overrides any pending set
    const setMap = this.pendingMapSets.get(yMap);
    if (setMap) setMap.delete(key);
    this.scheduleFlush();
  }

  enqueueArraySet(
    yArray: Y.Array<unknown>,
    index: number,
    computeYValue: () => unknown,
    postUpgrade?: (yValue: unknown) => void,
    plainSnapshot?: unknown,
    isGapSet?: boolean,
  ): void {
    let perArr = this.pendingArraySets.get(yArray);
    if (!perArr) {
      perArr = new Map();
      this.pendingArraySets.set(yArray, perArr);
    }
    perArr.set(index, { compute: computeYValue, after: postUpgrade, plain: plainSnapshot, isGapSet });
    this.scheduleFlush();
  }

  enqueueArrayDelete(yArray: Y.Array<unknown>, index: number): void {
    let perArr = this.pendingArrayDeletes.get(yArray);
    if (!perArr) {
      perArr = new Set();
      this.pendingArrayDeletes.set(yArray, perArr);
    }
    perArr.add(index);
    this.scheduleFlush();
  }

  // Moves are not handled at the library level. Use app-level fractional indexing instead.

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    console.log('[valtio-yjs][context] scheduleFlush');
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    if (!this.boundDoc) return;
    const doc = this.boundDoc;
    console.log('[valtio-yjs][context] flush start');
    // Snapshot pending and clear before running to avoid re-entrancy issues
    const mapSets = this.pendingMapSets;
    const mapDeletes = this.pendingMapDeletes;
    const arraySets = this.pendingArraySets;
    const arrayDeletes = this.pendingArrayDeletes;
    this.pendingMapSets = new Map();
    this.pendingMapDeletes = new Map();
    this.pendingArraySets = new Map();
    this.pendingArrayDeletes = new Map();
    // no-op
    const post: Array<() => void> = [];

    if (
      mapSets.size === 0 &&
      mapDeletes.size === 0 &&
      arraySets.size === 0 &&
      arrayDeletes.size === 0
    ) {
      return;
    }

    doc.transact(() => {
      this.applyMapDeletes(mapDeletes);
      this.applyMapSets(mapSets, post);
      this.applyArrayOperations(arraySets, arrayDeletes, post);
    }, VALTIO_YJS_ORIGIN);

    if (post.length > 0) {
      for (const fn of post) {
        try {
          this.withReconcilingLock(() => fn());
        } catch {
          // ignore upgrade errors to avoid breaking data ops
        }
      }
    }
  }

  // Apply pending map deletes (keys) first for determinism
  private applyMapDeletes(mapDeletes: Map<Y.Map<unknown>, Set<string>>): void {
    for (const [yMap, keys] of mapDeletes) {
      for (const key of Array.from(keys)) {
        if (yMap.has(key)) yMap.delete(key);
      }
    }
  }

  // Apply pending map sets
  private applyMapSets(mapSets: Map<Y.Map<unknown>, Map<string, PendingEntry>>, post: Array<() => void>): void {
    for (const [yMap, keyToEntry] of mapSets) {
      const keys = Array.from(keyToEntry.keys());
      for (const key of keys) {
        const entry = keyToEntry.get(key)!;
        const yValue = entry.compute();
        console.log('[valtio-yjs][context] map.set', { key });
        yMap.set(key, yValue);
        if (entry.after) {
          post.push(() => entry.after!(yValue));
        }
      }
    }
  }

  // Helper to clone shared Y types robustly by round-tripping through converters
  private cloneShared(val: unknown): unknown {
    if (isYSharedContainer(val)) {
      const plain = yTypeToPlainObject(val);
      return plainObjectToYType(plain, this);
    }
    return val;
  }

  // Execute array operations per-array using unified delete+insert canonicalization
  private applyArrayOperations(
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
      // represent shifts). This keeps the library focused on structural CRUD
      // and avoids reinsert/clone complexity for moved items.
      if (deletesForArray.size > 0) {
        setsForArray = new Map();
      }

      // Phase 1: Canonicalization — unify into deletes and inserts
      const indicesToDelete = new Set<number>(deletesForArray);
      // Defer insert value materialization until after deletes are applied.
      // This lets us detect that a shared type became detached by earlier deletes
      // in this same flush and clone it at insert-time to avoid reintegration hazards.
      type PendingInsert = { plain: unknown; after?: (yValue: unknown) => void; allowGapFill?: boolean };
      const insertsToApply = new Map<number, PendingInsert[]>();
      const sortedSetIndices = Array.from(setsForArray.keys()).sort((a, b) => a - b);

      // For shift-detection, count only original deletes (not synthetic deletes from sets)
      const originalDeletesAsc = Array.from(deletesForArray).sort((a, b) => a - b);
      let deletePtr = 0;
      let deletesCountThroughIndex = 0;

      for (const index of sortedSetIndices) {
        const entry = setsForArray.get(index)!;
        const yValue = entry.compute();
        const arrayDoc = this.getYDoc(yArray);
        const valueDoc = this.getYDoc(yValue);
        const valueParent = this.getParent(yValue);
        const valueType = isYMap(yValue) ? 'Y.Map' : isYArray(yValue) ? 'Y.Array' : typeof yValue;
        console.log('[valtio-yjs][context] array.set.compute', {
          index,
          type: valueType,
          valueHasDoc: !!valueDoc,
          arrayHasDoc: !!arrayDoc,
          sameDoc: !!valueDoc && !!arrayDoc ? valueDoc === arrayDoc : undefined,
          parentType: valueParent ? valueParent.constructor.name : null,
          parentIsArray: valueParent === yArray,
        });

        // Advance delete pointer and compute how many pure deletes affect positions <= this index
        while (deletePtr < originalDeletesAsc.length && originalDeletesAsc[deletePtr]! <= index) {
          deletePtr++;
        }
        deletesCountThroughIndex = deletePtr;

        // Skip sets that are just shifts caused by earlier deletes
        const compareIndex = index + deletesCountThroughIndex;
        if (compareIndex >= 0 && compareIndex < yArray.length) {
          const currentAtShiftedIndex = yArray.get(compareIndex);
          if (currentAtShiftedIndex === yValue) {
            if (entry.after) {
              const insertedForAfter = currentAtShiftedIndex;
              post.push(() => entry.after!(insertedForAfter));
            }
            continue;
          }
        } else if (index >= 0 && index < yArray.length) {
          // Also skip true no-op sets (same identity already present at index)
          const currentAtIndex = yArray.get(index);
          if (currentAtIndex === yValue) {
            if (entry.after) {
              const insertedForAfter = currentAtIndex;
              post.push(() => entry.after!(insertedForAfter));
            }
            continue;
          }
        }

        // Model a 'set' as delete + insert at the same index. Snapshot the
        // plain representation now, before deletes apply, so we can safely
        // reconstruct a fresh Y type even if the original gets GC'd.
        indicesToDelete.add(index);
        const existing = insertsToApply.get(index) ?? [];
        // Choose snapshot source carefully:
        // - If yValue is a shared type with a doc, derive from Y (authoritative).
        // - If yValue is a shared type without a doc (prelim), prefer the controller's plain snapshot
        //   because converting from prelim Y can yield empty content before integration.
        // - Otherwise, fall back to the provided plain or raw value.
        let snapshotPlain: unknown;
        if (isYSharedContainer(yValue)) {
          const valueDocNow = this.getYDoc(yValue);
          if (valueDocNow) {
            snapshotPlain = yTypeToPlainObject(yValue);
          } else {
            snapshotPlain = entry.plain ?? yTypeToPlainObject(yValue);
          }
        } else {
          snapshotPlain = entry.plain ?? yValue;
        }
        existing.push({ plain: snapshotPlain, after: entry.after, allowGapFill: entry.isGapSet === true });
        insertsToApply.set(index, existing);
      }

      // Phase 2: Execute deletes in descending order to avoid index shifts
      const sortedDeletes = Array.from(indicesToDelete).sort((a, b) => b - a);
      for (const index of sortedDeletes) {
        const hasDoc = this.hasYDoc(yArray);
        console.log('[valtio-yjs][context] array.delete', { index, length: yArray.length, hasDoc });
        if (index >= 0 && index < yArray.length) yArray.delete(index, 1);
      }

      // Phase 3: Execute inserts in descending order using precomputed values
      const sortedInsertIndices = Array.from(insertsToApply.keys()).sort((a, b) => b - a);
      for (const index of sortedInsertIndices) {
        const pendingItems = insertsToApply.get(index)!;

        // Materialize actual items now from the captured plain snapshot so
        // content survives deletes/GC within this transaction.
        const items: unknown[] = pendingItems.map((p) => {
          const v = plainObjectToYType(p.plain, this);
          if (p.after) {
            const insertedForAfter = v;
            post.push(() => p.after!(insertedForAfter));
          }
          return v;
        });

        let targetIndex = index;
        if (index > yArray.length) {
          const firstMeta = pendingItems[0];
          if (firstMeta && firstMeta.allowGapFill) {
            const fillCount = index - yArray.length;
            if (fillCount > 0) {
              yArray.insert(yArray.length, Array.from({ length: fillCount }, () => null));
            }
          } else {
            targetIndex = yArray.length; // clamp to append to avoid unintended null gaps
          }
        }
        // Inspect first item metadata before insert to detect integration hazards
        const arrayDocNow = this.getYDoc(yArray);
        const first = items[0];
        const firstDoc = this.getYDoc(first);
        const firstParent = this.getParent(first);
        const firstType = isYMap(first) ? 'Y.Map' : isYArray(first) ? 'Y.Array' : typeof first;
        if (targetIndex === yArray.length) {
          const hasDoc = this.hasYDoc(yArray);
          console.log('[valtio-yjs][context] array.append', { index: targetIndex, length: yArray.length, hasDoc });
          console.log('[valtio-yjs][context] array.insert.inspect', {
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
          // After integration, reconcile inserted shared containers locally to populate proxies
          for (const it of items) {
            if (isYMap(it)) {
              post.push(() => reconcileValtioMap(this, it, arrayDocNow!));
            } else if (isYArray(it)) {
              post.push(() => reconcileValtioArray(this, it, arrayDocNow!));
            }
          }
        } else if (targetIndex < yArray.length) {
          const hasDoc = this.hasYDoc(yArray);
          console.log('[valtio-yjs][context] array.insert', { index: targetIndex, length: yArray.length, hasDoc });
          console.log('[valtio-yjs][context] array.insert.inspect', {
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
          for (const it of items) {
            if (isYMap(it)) {
              post.push(() => reconcileValtioMap(this, it, arrayDocNow!));
            } else if (isYArray(it)) {
              post.push(() => reconcileValtioArray(this, it, arrayDocNow!));
            }
          }
        }
      }
    }
  }

  // Yjs helpers
  private hasYDoc(target: unknown): boolean {
    return !!(target as { doc?: unknown }).doc;
  }

  private getYDoc(target: unknown): Y.Doc | undefined {
    return (target as { doc?: Y.Doc | undefined })?.doc;
  }

  private getParent(target: unknown): Y.AbstractType<unknown> | null {
    return (target as { parent?: Y.AbstractType<unknown> | null })?.parent ?? null;
  }

  private shouldCloneBeforeInsert(yValue: unknown, yArray: Y.Array<unknown>): boolean {
    const valueDoc = this.getYDoc(yValue);
    const arrayDoc = this.getYDoc(yArray);
    return isYSharedContainer(yValue) && !!valueDoc && !!arrayDoc && valueDoc === arrayDoc;
  }
}


