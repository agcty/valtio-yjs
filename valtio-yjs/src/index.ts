/* eslint @typescript-eslint/no-explicit-any: "off" */

import * as Y from 'yjs';
import { createYjsController } from './controller.js';
import { setupSyncListener } from './synchronizer.js';
import { plainObjectToYType } from './converter.js';
import { VALTIO_YJS_ORIGIN } from './constants.js';
export { VALTIO_YJS_ORIGIN } from './constants.js';
export { syncedText } from './syncedTypes.js';

export interface CreateYjsProxyOptions<T> {
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
  const stateProxy = createYjsController(yRoot, doc);

  // 2. Provide developer-driven bootstrap for initial data.
  const bootstrap = (data: T) => {
    if ((yRoot instanceof Y.Map && yRoot.size > 0) || (yRoot instanceof Y.Array && yRoot.length > 0)) {
      console.warn('[valtio-yjs] bootstrap called on a non-empty document. Aborting to prevent data loss.');
      return;
    }
    const initialY = plainObjectToYType(data);
    doc.transact(() => {
      if (yRoot instanceof Y.Map && initialY instanceof Y.Map) {
        initialY.forEach((value: any, key: string) => {
          yRoot.set(key, value);
        });
      } else if (yRoot instanceof Y.Array && initialY instanceof Y.Array) {
        const items = initialY.toArray();
        if (items.length > 0) yRoot.insert(0, items);
      }
    }, VALTIO_YJS_ORIGIN);
  };

  // 3. Set up the reconciler-backed listener for remote changes.
  const dispose = setupSyncListener(doc, yRoot);

  // 4. Return the proxy, dispose, and bootstrap function.
  return { proxy: stateProxy as T, dispose, bootstrap };
}

