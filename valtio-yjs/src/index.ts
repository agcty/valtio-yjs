import * as Y from 'yjs';
import { getOrCreateValtioProxy } from './bridge/valtio-bridge.js';
import { setupSyncListener } from './synchronizer.js';
import { plainObjectToYType } from './converter.js';
import { VALTIO_YJS_ORIGIN } from './core/constants.js';
export { VALTIO_YJS_ORIGIN } from './core/constants.js';
export { syncedText } from './syncedTypes.js';
import { SynchronizationContext } from './core/context.js';
import { isYArray, isYMap } from './core/guards.js';
import { reconcileValtioArray, reconcileValtioMap } from './reconcile/reconciler.js';

export interface CreateYjsProxyOptions<_T> {
  getRoot: (doc: Y.Doc) => Y.Map<unknown> | Y.Array<unknown>;
  debug?: boolean;
}

export interface YjsProxy<T> {
  proxy: T;
  dispose: () => void;
  bootstrap: (data: T) => void;
}

export function createYjsProxy<T extends object>(
  doc: Y.Doc,
  options: CreateYjsProxyOptions<T>,
): YjsProxy<T> {
  const { getRoot } = options;
  const yRoot = getRoot(doc);

  // 1. Create the root controller proxy (returns a real Valtio proxy).
  const context = new SynchronizationContext(options.debug);
  context.bindDoc(doc);
  const stateProxy = getOrCreateValtioProxy(context, yRoot, doc);

  // 2. Provide developer-driven bootstrap for initial data.
  const bootstrap = (data: T) => {
    if ((isYMap(yRoot) && yRoot.size > 0) || (isYArray(yRoot) && yRoot.length > 0)) {
      // Use console.warn directly here to ensure visibility, independent of debug
      console.warn('[valtio-yjs] bootstrap called on a non-empty document. Aborting to prevent data loss.');
      return;
    }
    // Pre-convert to ensure deterministic behavior: either all converts or none
    if (isYMap(yRoot)) {
      const record = data as unknown as Record<string, unknown>;
      const convertedEntries: Array<[string, unknown]> = [];
      for (const key of Object.keys(record)) {
        const value = record[key];
        if (value !== undefined) {
          const converted = plainObjectToYType(value, context);
          convertedEntries.push([key, converted]);
        }
      }
      doc.transact(() => {
        for (const [key, converted] of convertedEntries) {
          yRoot.set(key, converted);
        }
      }, VALTIO_YJS_ORIGIN);
    } else if (isYArray(yRoot)) {
      const items = (data as unknown as unknown[]).map((v) => plainObjectToYType(v, context));
      doc.transact(() => {
        if (items.length > 0) yRoot.insert(0, items);
      }, VALTIO_YJS_ORIGIN);
    }

    // Our listener ignores our origin to avoid loops, so we must explicitly
    // reconcile locally to materialize the proxy after bootstrap.
    if (isYMap(yRoot)) {
      reconcileValtioMap(context, yRoot, doc);
    } else if (isYArray(yRoot)) {
      reconcileValtioArray(context, yRoot, doc);
    }
  };

  // 3. Set up the reconciler-backed listener for remote changes.
  const disposeSync = setupSyncListener(context, doc, yRoot);

  // 4. Return the proxy, dispose, and bootstrap function.
  const dispose = () => {
    disposeSync();
    context.disposeAll();
  };

  return { proxy: stateProxy as T, dispose, bootstrap };
}

