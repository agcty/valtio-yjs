import * as Y from 'yjs';
import { WriteScheduler } from '../scheduling/writeScheduler.js';
import { applyMapDeletes, applyMapSets } from '../applying/mapApply.js';
import { applyArrayOperations } from '../applying/arrayApply.js';
import { LOG_PREFIX } from './constants.js';
import type { YSharedContainer } from '../yjs-types.js';

/**
 * Encapsulates all state for a single valtio-yjs instance.
 * Holds caches, subscription disposers, and a reconciliation flag.
 */
export type AnySharedType = YSharedContainer;

export interface Logger {
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export class SynchronizationContext {
  // Logger facility
  readonly log: Logger;
  private readonly debugEnabled: boolean;

  // Caches: Y type <-> Valtio proxy
  readonly yTypeToValtioProxy = new WeakMap<AnySharedType, object>();
  readonly valtioProxyToYType = new WeakMap<object, AnySharedType>();

  // Track unsubscribe function for Valtio subscriptions per Y type
  readonly yTypeToUnsubscribe = new WeakMap<AnySharedType, () => void>();

  // Track all unsubscribe functions for a full dispose
  private readonly allUnsubscribers = new Set<() => void>();

  // Global flag used to prevent reflecting Valtio changes back into Yjs
  isReconciling = false;

  // Write scheduler instance
  private writeScheduler: WriteScheduler;

  constructor(debug?: boolean) {
    this.debugEnabled = debug ?? false;
    const withPrefix = (...args: unknown[]): unknown[] =>
      args.length > 0 && typeof args[0] === 'string'
        ? [`${LOG_PREFIX} ${args[0] as string}`, ...(args.slice(1) as unknown[])]
        : [LOG_PREFIX, ...args];

    this.log = {
      debug: (...args: unknown[]) => {
        if (!this.debugEnabled) return;
        console.debug(...(withPrefix(...args) as unknown[]));
      },
      warn: (...args: unknown[]) => {
        console.warn(...(withPrefix(...args) as unknown[]));
      },
      error: (...args: unknown[]) => {
        console.error(...(withPrefix(...args) as unknown[]));
      },
    };

    // Initialize write scheduler with apply functions
    this.writeScheduler = new WriteScheduler(this.log);
    this.writeScheduler.setApplyFunctions(
      (mapDeletes) => applyMapDeletes(mapDeletes, this.log),
      (mapSets, post) => applyMapSets(mapSets, post, this.log, this),
      (arraySets, arrayDeletes, post) => applyArrayOperations(this, arraySets, arrayDeletes, post),
      (fn) => this.withReconcilingLock(fn),
    );
  }

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
    this.writeScheduler.bindDoc(doc);
  }

  // Delegate enqueue operations to the write scheduler
  enqueueMapSet(
    yMap: Y.Map<unknown>,
    key: string,
    value: unknown,
    postUpgrade?: (yValue: unknown) => void,
  ): void {
    this.writeScheduler.enqueueMapSet(yMap, key, value, postUpgrade);
  }

  enqueueMapDelete(yMap: Y.Map<unknown>, key: string): void {
    this.writeScheduler.enqueueMapDelete(yMap, key);
  }

  enqueueArraySet(
    yArray: Y.Array<unknown>,
    index: number,
    computeYValue: () => unknown,
    postUpgrade?: (yValue: unknown) => void,
  ): void {
    this.writeScheduler.enqueueArraySet(yArray, index, computeYValue, postUpgrade);
  }

  enqueueArrayDelete(yArray: Y.Array<unknown>, index: number): void {
    this.writeScheduler.enqueueArrayDelete(yArray, index);
  }
}
