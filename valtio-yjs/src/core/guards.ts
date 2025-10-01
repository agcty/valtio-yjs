import * as Y from 'yjs';
import type { YSharedContainer } from './yjs-types';

export function isYSharedContainer(value: unknown): value is YSharedContainer {
  return (
    value instanceof Y.Map ||
    value instanceof Y.Array ||
    value instanceof Y.XmlFragment ||
    value instanceof Y.XmlElement ||
    value instanceof Y.XmlHook
  );
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

export function isYXmlFragment(value: unknown): value is Y.XmlFragment {
  return value instanceof Y.XmlFragment;
}

export function isYXmlElement(value: unknown): value is Y.XmlElement {
  return value instanceof Y.XmlElement;
}

export function isYXmlHook(value: unknown): value is Y.XmlHook {
  return value instanceof Y.XmlHook;
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
 * - Y.XmlHook: Custom hook type (extends Y.Map, but needs to preserve methods)
 * 
 * Note: Y.XmlText extends Y.Text, so instanceof Y.Text catches both.
 * Y.XmlHook extends Y.Map but is treated as a leaf to preserve its Map-like methods.
 * 
 * To add more leaf types:
 * 1. Add instanceof check here (e.g., || value instanceof Y.SomeLeafType)
 * 2. Add tests in tests/e2e/ to verify convergence and reactivity
 * 3. Update README.md to document the new leaf type
 * 
 * Future leaf types to consider:
 * - Custom Y.AbstractType implementations
 */
export function isYLeafType(value: unknown): value is Y.Text | Y.XmlHook {
  // Y.Text includes Y.XmlText since it extends Y.Text
  // Y.XmlHook is treated as a leaf to preserve its Map-like interface
  return value instanceof Y.Text || value instanceof Y.XmlHook;
}


