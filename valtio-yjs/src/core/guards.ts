import * as Y from 'yjs';
import type { YSharedContainer } from '../yjs-types.js';

export function isYSharedContainer(value: unknown): value is YSharedContainer {
  return value instanceof Y.Map || value instanceof Y.Array;
}

export function isYMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map;
}

export function isYArray(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array;
}

export function isYText(value: unknown): value is Y.Text {
  return value instanceof Y.Text;
}

export function isYAbstractType(value: unknown): value is Y.AbstractType<unknown> {
  return value instanceof Y.AbstractType;
}


