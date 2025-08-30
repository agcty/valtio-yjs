import * as Y from 'yjs';
import { VALTIO_YJS_ORIGIN } from './constants.js';

/**
 * Encapsulates all state for a single valtio-yjs instance.
 * Holds caches, subscription disposers, and a reconciliation flag.
 */
export type AnySharedType = Y.Map<unknown> | Y.Array<unknown>;

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
  private pendingMapSets = new Map<
    Y.Map<unknown>,
    Map<string, { compute: () => unknown; after?: (yValue: unknown) => void }>
  >();
  private pendingMapDeletes = new Map<Y.Map<unknown>, Set<string>>();
  private pendingArraySets = new Map<
    Y.Array<unknown>,
    Map<number, { compute: () => unknown; after?: (yValue: unknown) => void }>
  >();
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
  ): void {
    let perArr = this.pendingArraySets.get(yArray);
    if (!perArr) {
      perArr = new Map();
      this.pendingArraySets.set(yArray, perArr);
    }
    perArr.set(index, { compute: computeYValue, after: postUpgrade });
    const delSet = this.pendingArrayDeletes.get(yArray);
    if (delSet) delSet.delete(index);
    this.scheduleFlush();
  }

  enqueueArrayDelete(yArray: Y.Array<unknown>, index: number): void {
    let perArr = this.pendingArrayDeletes.get(yArray);
    if (!perArr) {
      perArr = new Set();
      this.pendingArrayDeletes.set(yArray, perArr);
    }
    perArr.add(index);
    const setMap = this.pendingArraySets.get(yArray);
    if (setMap) setMap.delete(index);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    try { console.log('[valtio-yjs][context] scheduleFlush'); } catch { /* noop */ }
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    if (!this.boundDoc) return;
    const doc = this.boundDoc;
    try {
      console.log('[valtio-yjs][context] flush start');
    } catch { /* noop */ }
    // Snapshot pending and clear before running to avoid re-entrancy issues
    const mapSets = this.pendingMapSets;
    const mapDeletes = this.pendingMapDeletes;
    const arraySets = this.pendingArraySets;
    const arrayDeletes = this.pendingArrayDeletes;
    this.pendingMapSets = new Map();
    this.pendingMapDeletes = new Map();
    this.pendingArraySets = new Map();
    this.pendingArrayDeletes = new Map();
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
      // Apply map deletes first for determinism
      for (const [yMap, keys] of mapDeletes) {
        for (const key of Array.from(keys)) {
          if (yMap.has(key)) yMap.delete(key);
        }
      }
      // Apply map sets
      for (const [yMap, keyToEntry] of mapSets) {
        const keys = Array.from(keyToEntry.keys());
        for (const key of keys) {
          const entry = keyToEntry.get(key)!;
          const yValue = entry.compute();
          try { console.log('[valtio-yjs][context] map.set', { key }); } catch { /* noop */ }
          yMap.set(key, yValue);
          if (entry.after) {
            post.push(() => entry.after!(yValue));
          }
        }
      }
      // Apply array deletes
      for (const [yArray, indices] of arrayDeletes) {
        const sorted = Array.from(indices).sort((a, b) => b - a);
        for (const index of sorted) {
          try {
            const hasDoc = !!(yArray as unknown as { doc?: unknown }).doc;
            console.log('[valtio-yjs][context] array.delete', { index, length: yArray.length, hasDoc });
          } catch { /* noop */ }
          if (index >= 0 && index < yArray.length) yArray.delete(index, 1);
        }
      }
      // Apply array sets (replace/append/fill)
      for (const [yArray, idxToEntry] of arraySets) {
        const indices = Array.from(idxToEntry.keys()).sort((a, b) => a - b);
        for (const index of indices) {
          const entry = idxToEntry.get(index)!;
          const yValue = entry.compute();
          if (index >= 0) {
            if (index < yArray.length) {
              try {
                const hasDoc = !!(yArray as unknown as { doc?: unknown }).doc;
                console.log('[valtio-yjs][context] array.replace', { index, length: yArray.length, hasDoc });
              } catch { /* noop */ }
              yArray.delete(index, 1);
              yArray.insert(index, [yValue]);
            } else if (index === yArray.length) {
              try {
                const hasDoc = !!(yArray as unknown as { doc?: unknown }).doc;
                console.log('[valtio-yjs][context] array.append', { index, length: yArray.length, hasDoc });
              } catch { /* noop */ }
              yArray.insert(yArray.length, [yValue]);
            } else {
              const fillCount = index - yArray.length;
              if (fillCount > 0) yArray.insert(yArray.length, Array.from({ length: fillCount }, () => null));
              try {
                const hasDoc = !!(yArray as unknown as { doc?: unknown }).doc;
                console.log('[valtio-yjs][context] array.fill+append', { index, length: yArray.length, fillCount, hasDoc });
              } catch { /* noop */ }
              yArray.insert(yArray.length, [yValue]);
            }
          }
          if (entry.after) {
            post.push(() => entry.after!(yValue));
          }
        }
      }
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
}


