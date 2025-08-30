import * as Y from 'yjs';
import type { AnySharedType } from './context.js';

export function isSharedType(value: unknown): value is AnySharedType {
  return value instanceof Y.Map || value instanceof Y.Array;
}

export function isYMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map;
}

export function isYArray(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array;
}


