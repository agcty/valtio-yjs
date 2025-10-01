// Leaf Node Reactivity Layer
//
// Responsibility:
// - Setup reactivity for Y.js leaf types (Y.Text, Y.XmlText, etc.)
// - Leaf types have internal CRDT state that shouldn't be deeply proxied
// - Instead, we observe their changes and trigger Valtio updates manually

import * as Y from 'yjs';
import type { SynchronizationContext } from '../core/context';

/**
 * Sets up automatic reactivity for a Y.js leaf node stored in a Valtio proxy.
 * 
 * Strategy:
 * 1. The leaf node is wrapped in ref() to prevent deep proxying
 * 2. We observe the leaf node's native Y.js events
 * 3. When the leaf changes, we trigger Valtio's change detection by re-assigning
 * 
 * This approach:
 * - Prevents interference with Y.js CRDT internals (ref() blocks deep proxying)
 * - Provides automatic reactivity (components re-render on content changes)
 * - Avoids method patching (simpler than SyncedStore's approach)
 * 
 * @param context - Synchronization context for lock management and cleanup
 * @param objProxy - The Valtio proxy object containing the leaf node
 * @param key - The property key where the leaf node is stored
 * @param leafNode - The Y.js leaf type (Y.Text, Y.XmlText, etc.)
 */
export function setupLeafNodeReactivity(
  context: SynchronizationContext,
  objProxy: Record<string, unknown>,
  key: string,
  leafNode: Y.Text, // Y.Text is the base for all text-based leaf types
): void {
  // Observe changes to the Y.js leaf node
  const handler = () => {
    // When Y.js content changes, trigger Valtio's change detection
    // by re-assigning the same reference. This causes Valtio's set trap
    // to fire, which increments the version and notifies subscribers.
    context.withReconcilingLock(() => {
      const current = objProxy[key];
      // Re-assign to trigger Valtio's change detection
      // This doesn't actually mutate the Y.Text, just tells Valtio "this property changed"
      objProxy[key] = current;
    });
  };

  // Subscribe to Y.js observe events
  leafNode.observe(handler);

  // Register cleanup: unobserve when the proxy is disposed
  context.registerDisposable(() => {
    leafNode.unobserve(handler);
  });

  context.log.debug('[leaf-reactivity] setup complete', {
    key,
    type: leafNode.constructor.name,
  });
}

/**
 * Alternative implementation for array elements.
 * Called when a leaf node is stored in an array proxy.
 */
export function setupLeafNodeReactivityInArray(
  context: SynchronizationContext,
  arrProxy: unknown[],
  index: number,
  leafNode: Y.Text,
): void {
  const handler = () => {
    context.withReconcilingLock(() => {
      const current = arrProxy[index];
      arrProxy[index] = current;
    });
  };

  leafNode.observe(handler);

  context.registerDisposable(() => {
    leafNode.unobserve(handler);
  });

  context.log.debug('[leaf-reactivity] setup complete (array)', {
    index,
    type: leafNode.constructor.name,
  });
}

