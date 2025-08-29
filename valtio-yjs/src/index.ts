/* eslint @typescript-eslint/no-explicit-any: "off" */

import * as Y from 'yjs';
import { proxy } from 'valtio/vanilla';
import { setupSyncListeners } from './synchronizer.js';
import { yTypeToPlainObject, plainObjectToYType } from './converter.js';
import { VALTIO_YJS_ORIGIN } from './constants.js';

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

  // Merge initial state by applying a temp doc update to avoid overwriting remote state
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

  // Build initial proxy state from the current yRoot content
  const initialPlain = yTypeToPlainObject(yRoot) as T;
  const stateProxy = proxy(initialPlain);

  const dispose = setupSyncListeners(stateProxy, doc, yRoot, VALTIO_YJS_ORIGIN);

  return { proxy: stateProxy as T, dispose };
}

