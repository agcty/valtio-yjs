/* eslint @typescript-eslint/no-explicit-any: "off" */

import * as Y from 'yjs';
import { createYjsController } from './controller.js';
import { setupSyncListener } from './synchronizer.js';
import { plainObjectToYType } from './converter.js';
export { VALTIO_YJS_ORIGIN } from './constants.js';

export interface CreateYjsProxyOptions<T> {
  getRoot: (doc: Y.Doc) => Y.Map<any> | Y.Array<any>;
  initialState?: T;
}

export interface YjsProxy<T> {
  proxy: T;
  dispose: () => void;
}

export function createYjsProxy<T extends object>(
  doc: Y.Doc,
  options: CreateYjsProxyOptions<T>,
): YjsProxy<T> {
  const { getRoot, initialState } = options;
  const yRoot = getRoot(doc);

  // Safely merge initial state (this logic remains the same and is correct).
  if (initialState) {
    const tempDoc = new Y.Doc();
    const tempRoot = getRoot(tempDoc);
    // Write initial state directly into tempRoot without reading non-integrated Y types
    if (tempRoot instanceof Y.Map && typeof initialState === 'object' && !Array.isArray(initialState)) {
      Object.entries(initialState as any).forEach(([key, value]) => {
        tempRoot.set(key, plainObjectToYType(value));
      });
    } else if (tempRoot instanceof Y.Array && Array.isArray(initialState)) {
      const yItems = (initialState as any[]).map(plainObjectToYType);
      if (yItems.length > 0) tempRoot.insert(0, yItems);
    }
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(tempDoc));
  }

  // 1. Create the root controller proxy (returns a real Valtio proxy).
  const stateProxy = createYjsController(yRoot, doc);

  // 2. Set up the single, document-wide listener for remote changes.
  const dispose = setupSyncListener(doc);

  // 3. Return the proxy and the dispose function.
  return { proxy: stateProxy as T, dispose };
}

