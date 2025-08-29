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
    const initialY = plainObjectToYType(initialState);
    if (initialY instanceof Y.Map && tempRoot instanceof Y.Map) {
      initialY.forEach((value: any, key: string) => {
        tempRoot.set(key, value);
      });
    } else if (initialY instanceof Y.Array && tempRoot instanceof Y.Array) {
      tempRoot.insert(0, initialY.toArray());
    }
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(tempDoc));
  }

  // Build initial proxy state from the current yRoot content
  const initialPlain = yTypeToPlainObject(yRoot) as T;
  const stateProxy = proxy(initialPlain);

  const dispose = setupSyncListeners(stateProxy, doc, yRoot, VALTIO_YJS_ORIGIN);

  return { proxy: stateProxy as T, dispose };
}

