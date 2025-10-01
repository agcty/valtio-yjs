// Leaf Node Reactivity Layer
//
// Responsibility:
// - Setup reactivity for Y.js leaf types (Y.Text, Y.XmlText, etc.)
// - Leaf types have internal CRDT state that shouldn't be deeply proxied
// - Instead, we observe their changes and trigger Valtio updates manually

import type { YLeafType } from '../core/yjs-types';
import type { SynchronizationContext } from '../core/context';

/**
 * Symbol used to store version counters for leaf nodes.
 * This is a hidden property that tracks changes to ref() wrapped leaf nodes.
 */
const LEAF_VERSIONS = Symbol('valtio-yjs:leafVersions');

/**
 * Sets up automatic reactivity for a Y.js leaf node stored in a Valtio proxy.
 * 
 * Strategy:
 * 1. The leaf node is wrapped in ref() to prevent deep proxying
 * 2. We observe the leaf node's native Y.js events
 * 3. When the leaf changes, we trigger Valtio's change detection by incrementing a version counter
 * 
 * This approach:
 * - Prevents interference with Y.js CRDT internals (ref() blocks deep proxying)
 * - Provides automatic reactivity (components re-render on content changes)
 * - Avoids method patching (simpler than SyncedStore's approach)
 * 
 * Note: We use a hidden version counter because Valtio's set trap ignores
 * reassignments of the same reference (objectIs check). By incrementing a counter,
 * we ensure Valtio detects that something changed.
 * 
 * @param context - Synchronization context for lock management and cleanup
 * @param objProxy - The Valtio proxy object containing the leaf node
 * @param key - The property key where the leaf node is stored
 * @param leafNode - The Y.js leaf type (Y.Text, Y.XmlText, Y.XmlHook, etc.)
 */
export function setupLeafNodeReactivity(
  context: SynchronizationContext,
  objProxy: Record<string | symbol, unknown>,
  key: string,
  leafNode: YLeafType,
): void {
  // Initialize version tracking map if not present
  if (!objProxy[LEAF_VERSIONS]) {
    objProxy[LEAF_VERSIONS] = {};
  }

  // Observe changes to the Y.js leaf node
  const handler = () => {
    // When Y.js content changes, trigger Valtio's change detection
    // by incrementing a version counter for this specific key
    context.withReconcilingLock(() => {
      const versions = objProxy[LEAF_VERSIONS] as Record<string, number>;
      versions[key] = (versions[key] || 0) + 1;
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
 * Uses the same version counter approach as setupLeafNodeReactivity.
 * For arrays, we use the array itself as a record to store version info.
 */
export function setupLeafNodeReactivityInArray(
  context: SynchronizationContext,
  arrProxy: unknown[],
  index: number,
  leafNode: YLeafType,
): void {
  // Cast to allow Symbol properties on array (arrays are objects and can have Symbol properties)
  const arrWithSymbols = arrProxy as unknown[] & Record<symbol, unknown>;
  
  // Initialize version tracking map if not present
  if (!arrWithSymbols[LEAF_VERSIONS]) {
    arrWithSymbols[LEAF_VERSIONS] = {};
  }

  const handler = () => {
    context.withReconcilingLock(() => {
      // Increment version counter for this array index
      const versions = arrWithSymbols[LEAF_VERSIONS] as Record<string, number>;
      const versionKey = `[${index}]`;
      versions[versionKey] = (versions[versionKey] || 0) + 1;
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

