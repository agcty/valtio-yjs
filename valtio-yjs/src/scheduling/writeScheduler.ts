import * as Y from 'yjs';
import type { PendingMapEntry, PendingArrayEntry } from './batchTypes.js';
import type { Logger } from '../core/context.js';
import { VALTIO_YJS_ORIGIN } from '../core/constants.js';

export class WriteScheduler {
  private readonly log: Logger;
  private readonly traceMode: boolean;
  
  // Write scheduler state
  private boundDoc: Y.Doc | null = null;
  private flushScheduled = false;
  
  // Pending ops, deduped per target and key/index
  private pendingMapSets = new Map<Y.Map<unknown>, Map<string, PendingMapEntry>>();
  private pendingMapDeletes = new Map<Y.Map<unknown>, Set<string>>();
  private pendingArraySets = new Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>();
  private pendingArrayDeletes = new Map<Y.Array<unknown>, Set<number>>();
  private pendingArrayReplaces = new Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>();

  // Callback functions for applying operations
  private applyMapDeletesFn: ((mapDeletes: Map<Y.Map<unknown>, Set<string>>) => void) | null = null;
  private applyMapSetsFn: ((mapSets: Map<Y.Map<unknown>, Map<string, PendingMapEntry>>, post: Array<() => void>) => void) | null = null;
  private applyArrayOperationsFn: ((arraySets: Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>, arrayDeletes: Map<Y.Array<unknown>, Set<number>>, arrayReplaces: Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>, post: Array<() => void>) => void) | null = null;
  private withReconcilingLockFn: ((fn: () => void) => void) | null = null;

  constructor(log: Logger, traceMode: boolean = false) {
    this.log = log;
    this.traceMode = traceMode;
  }

  bindDoc(doc: Y.Doc): void {
    this.boundDoc = doc;
  }

  // Set callback functions for applying operations
  setApplyFunctions(
    applyMapDeletes: (mapDeletes: Map<Y.Map<unknown>, Set<string>>) => void,
    applyMapSets: (mapSets: Map<Y.Map<unknown>, Map<string, PendingMapEntry>>, post: Array<() => void>) => void,
    applyArrayOperations: (arraySets: Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>, arrayDeletes: Map<Y.Array<unknown>, Set<number>>, arrayReplaces: Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>, post: Array<() => void>) => void,
    withReconcilingLock: (fn: () => void) => void,
  ): void {
    this.applyMapDeletesFn = applyMapDeletes;
    this.applyMapSetsFn = applyMapSets;
    this.applyArrayOperationsFn = applyArrayOperations;
    this.withReconcilingLockFn = withReconcilingLock;
  }

  // Enqueue operations
  enqueueMapSet(
    yMap: Y.Map<unknown>,
    key: string,
    value: unknown,
    postUpgrade?: (yValue: unknown) => void,
  ): void {
    let perMap = this.pendingMapSets.get(yMap);
    if (!perMap) {
      perMap = new Map();
      this.pendingMapSets.set(yMap, perMap);
    }
    perMap.set(key, { value, after: postUpgrade });
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
    value: unknown,
    postUpgrade?: (yValue: unknown) => void,
  ): void {
    let perArr = this.pendingArraySets.get(yArray);
    if (!perArr) {
      perArr = new Map();
      this.pendingArraySets.set(yArray, perArr);
    }
    perArr.set(index, { value, after: postUpgrade });
    this.scheduleFlush();
  }

  enqueueArrayReplace(
    yArray: Y.Array<unknown>,
    index: number,
    value: unknown,
    postUpgrade?: (yValue: unknown) => void,
  ): void {
    let perArr = this.pendingArrayReplaces.get(yArray);
    if (!perArr) {
      perArr = new Map();
      this.pendingArrayReplaces.set(yArray, perArr);
    }
    perArr.set(index, { value, after: postUpgrade });
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
    this.log.debug('[scheduler] scheduleFlush');
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    if (!this.boundDoc) return;
    const doc = this.boundDoc;
    this.log.debug('[scheduler] flush start');
    // Snapshot pending and clear before running to avoid re-entrancy issues
    const mapSets = this.pendingMapSets;
    const mapDeletes = this.pendingMapDeletes;
    const arraySets = this.pendingArraySets;
    const arrayDeletes = this.pendingArrayDeletes;
    const arrayReplaces = this.pendingArrayReplaces;
    this.pendingMapSets = new Map();
    this.pendingMapDeletes = new Map();
    this.pendingArraySets = new Map();
    this.pendingArrayDeletes = new Map();
    this.pendingArrayReplaces = new Map();
    // no-op
    const post: Array<() => void> = [];

    if (
      mapSets.size === 0 &&
      mapDeletes.size === 0 &&
      arraySets.size === 0 &&
      arrayDeletes.size === 0 &&
      arrayReplaces.size === 0
    ) {
      return;
    }

    // Trace mode: log planned intents for debugging
    if (this.traceMode) {
      this.log.debug('[scheduler] trace: planned intents for this flush', {
        mapSets: mapSets.size > 0 ? Array.from(mapSets.entries()).map(([yMap, keyMap]) => ({
          target: yMap.constructor.name,
          operations: Array.from(keyMap.keys())
        })) : [],
        mapDeletes: mapDeletes.size > 0 ? Array.from(mapDeletes.entries()).map(([yMap, keySet]) => ({
          target: yMap.constructor.name,
          operations: Array.from(keySet)
        })) : [],
        arraySets: arraySets.size > 0 ? Array.from(arraySets.entries()).map(([yArray, indexMap]) => ({
          target: yArray.constructor.name,
          operations: Array.from(indexMap.keys())
        })) : [],
        arrayDeletes: arrayDeletes.size > 0 ? Array.from(arrayDeletes.entries()).map(([yArray, indexSet]) => ({
          target: yArray.constructor.name,
          operations: Array.from(indexSet)
        })) : [],
        arrayReplaces: arrayReplaces.size > 0 ? Array.from(arrayReplaces.entries()).map(([yArray, indexMap]) => ({
          target: yArray.constructor.name,
          operations: Array.from(indexMap.keys())
        })) : []
      });
    }

    doc.transact(() => {
      if (this.applyMapDeletesFn) {
        this.applyMapDeletesFn(mapDeletes);
      }
      if (this.applyMapSetsFn) {
        this.applyMapSetsFn(mapSets, post);
      }
      if (this.applyArrayOperationsFn) {
        this.applyArrayOperationsFn(arraySets, arrayDeletes, arrayReplaces, post);
      }
    }, VALTIO_YJS_ORIGIN);

    if (post.length > 0) {
      for (const fn of post) {
        try {
          if (this.withReconcilingLockFn) {
            this.withReconcilingLockFn(() => fn());
          } else {
            fn();
          }
        } catch {
          // ignore upgrade errors to avoid breaking data ops
        }
      }
    }
  }
}
