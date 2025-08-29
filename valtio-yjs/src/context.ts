/* eslint @typescript-eslint/no-explicit-any: "off" */
import * as Y from 'yjs';

/**
 * Encapsulates all state for a single valtio-yjs instance.
 * Holds caches, subscription disposers, and a reconciliation flag.
 */
export class SynchronizationContext {
  // Caches: Y type <-> Valtio proxy
  readonly yTypeToValtioProxy = new WeakMap<Y.AbstractType<any>, any>();
  readonly valtioProxyToYType = new WeakMap<object, Y.AbstractType<any>>();

  // Track unsubscribe function for Valtio subscriptions per Y type
  readonly yTypeToUnsubscribe = new WeakMap<Y.AbstractType<any>, () => void>();

  // Track all unsubscribe functions for a full dispose
  private readonly allUnsubscribers = new Set<() => void>();

  // Global flag used to prevent reflecting Valtio changes back into Yjs
  isReconciling = false;

  withReconcilingLock(fn: () => void): void {
    const previous = this.isReconciling;
    this.isReconciling = true;
    try {
      fn();
    } finally {
      this.isReconciling = previous;
    }
  }

  registerSubscription(yType: Y.AbstractType<any>, unsubscribe: () => void): void {
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
}


