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
 * 3. When the leaf changes, we trigger Valtio's change detection using a workaround
 * 
 * This approach:
 * - Prevents interference with Y.js CRDT internals (ref() blocks deep proxying)
 * - Provides automatic reactivity (components re-render on content changes)
 * - Avoids method patching (simpler than SyncedStore's approach)
 * 
 * Note: We use a delete+set pattern because Valtio's set trap ignores
 * reassignments of the same reference (objectIs check). By deleting first,
 * we ensure the subsequent set is treated as a new value.
 * 
 * @param context - Synchronization context for lock management and cleanup
 * @param objProxy - The Valtio proxy object containing the leaf node
 * @param key - The property key where the leaf node is stored
 * @param leafNode - The Y.js leaf type (Y.Text, Y.XmlText, Y.XmlHook, etc.)
 */
export function setupLeafNodeReactivity(
  context: SynchronizationContext,
  objProxy: Record<string, unknown>,
  key: string,
  leafNode: Y.Text | Y.XmlFragment | Y.XmlElement | Y.XmlHook, // All supported leaf types
): void {
  // Observe changes to the Y.js leaf node
  const handler = () => {
    // When Y.js content changes, trigger Valtio's change detection
    // Valtio's set trap has an optimization: if you set a property to the same value
    // (objectIs check), it skips the notification. To work around this for ref() values,
    // we temporarily set it to null, then back to the original value. This forces Valtio
    // to see it as a change without triggering Y.js operations.
    context.withReconcilingLock(() => {
      const current = objProxy[key];
      // Temporarily set to null to break the objectIs check
      objProxy[key] = null as any;
      // Immediately restore the actual value
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
 * 
 * Uses the same delete+set workaround as setupLeafNodeReactivity to ensure
 * Valtio detects the change even when the reference is the same.
 */
export function setupLeafNodeReactivityInArray(
  context: SynchronizationContext,
  arrProxy: unknown[],
  index: number,
  leafNode: Y.Text | Y.XmlFragment | Y.XmlElement | Y.XmlHook, // All supported leaf types
): void {
  const handler = () => {
    context.withReconcilingLock(() => {
      // Use splice to force Valtio to detect the change
      // splice(index, 1, value) replaces 1 item at index with value
      const current = arrProxy[index];
      arrProxy.splice(index, 1, current);
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

