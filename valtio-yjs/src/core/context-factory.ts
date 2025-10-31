import { SynchronizationContext } from './context';
import { applyMapDeletes, applyMapSets } from '../scheduling/map-apply';
import { applyArrayOperations } from '../scheduling/array-apply';

/**
 * Factory function to create a properly initialized SynchronizationContext.
 * This breaks the circular dependency by keeping the wiring logic separate from the context definition.
 */
export function createSynchronizationContext(debug?: boolean, trace?: boolean): SynchronizationContext {
  const context = new SynchronizationContext(debug, trace);

  // Wire up the apply functions (dependency injection)
  context.setApplyFunctions(
    (mapDeletes) => applyMapDeletes(mapDeletes, context.log),
    (mapSets, postQueue) => applyMapSets(mapSets, postQueue, context.log, context),
    (arraySets, arrayDeletes, arrayReplaces, postQueue) =>
      applyArrayOperations(context, arraySets, arrayDeletes, arrayReplaces, postQueue),
    (fn) => context.withReconcilingLock(fn),
  );

  return context;
}
