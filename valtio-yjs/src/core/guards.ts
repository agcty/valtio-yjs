import * as Y from 'yjs';
import type { YSharedContainer } from './yjs-types';

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

/**
 * Checks if a value is a Y.js leaf type (non-container CRDT).
 * Leaf types have internal CRDT state and should not be deeply proxied.
 * 
 * Currently supports:
 * - Y.Text: Collaborative text CRDT
 * - Y.XmlText: XML-specific text (extends Y.Text)
 * 
 * Note: Y.XmlText extends Y.Text, so instanceof Y.Text catches both.
 * 
 * To add more leaf types:
 * 1. Add instanceof check here (e.g., || value instanceof Y.SomeLeafType)
 * 2. Add tests in tests/e2e/ to verify convergence and reactivity
 * 3. Update README.md to document the new leaf type
 * 
 * Future leaf types to consider:
 * - Y.XmlHook (extends Y.Map, but may need special handling)
 * - Custom Y.AbstractType implementations
 */
export function isYLeafType(value: unknown): value is Y.Text {
  // Y.Text includes Y.XmlText since it extends Y.Text
  return value instanceof Y.Text;
}


