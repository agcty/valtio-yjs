/* eslint @typescript-eslint/no-explicit-any: "off" */

import * as Y from 'yjs';
import { createYjsController } from './controller.js';
import { setupSyncListener } from './synchronizer.js';
import { plainObjectToYType } from './converter.js';
import { VALTIO_YJS_ORIGIN } from './constants.js';
export { VALTIO_YJS_ORIGIN } from './constants.js';
export { syncedText } from './syncedTypes.js';
import { SynchronizationContext } from './context.js';
import { reconcileValtioArray, reconcileValtioMap } from './reconciler.js';

export interface CreateYjsProxyOptions<_T> {
  getRoot: (doc: Y.Doc) => Y.Map<any> | Y.Array<any>;
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
  const context = new SynchronizationContext();
  context.bindDoc(doc);
  const stateProxy = createYjsController(context, yRoot, doc);

  // 2. Provide developer-driven bootstrap for initial data.
  const bootstrap = (data: T) => {
    if ((yRoot instanceof Y.Map && yRoot.size > 0) || (yRoot instanceof Y.Array && yRoot.length > 0)) {
      console.warn('[valtio-yjs] bootstrap called on a non-empty document. Aborting to prevent data loss.');
      return;
    }
    doc.transact(() => {
      if (yRoot instanceof Y.Map) {
        const record = data as unknown as Record<string, any>;
        for (const key of Object.keys(record)) {
          const value = record[key];
          if (value !== undefined) {
            yRoot.set(key, plainObjectToYType(value, context));
          }
        }
      } else if (yRoot instanceof Y.Array) {
        const items = (data as unknown as any[]).map((v) => plainObjectToYType(v, context));
        if (items.length > 0) yRoot.insert(0, items);
      }
    }, VALTIO_YJS_ORIGIN);

    // Our listener ignores our origin to avoid loops, so we must explicitly
    // reconcile locally to materialize the proxy after bootstrap.
    if (yRoot instanceof Y.Map) {
      reconcileValtioMap(context, yRoot, doc);
    } else if (yRoot instanceof Y.Array) {
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

