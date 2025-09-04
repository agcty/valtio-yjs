import * as Y from 'yjs';
import type { PendingMapEntry } from '../scheduling/batchTypes.js';
import type { Logger } from '../core/context.js';
import { plainObjectToYType } from '../converter.js';
import type { SynchronizationContext } from '../core/context.js';

// Apply pending map deletes (keys) first for determinism
export function applyMapDeletes(mapDeletes: Map<Y.Map<unknown>, Set<string>>, _log: Logger): void {
  for (const [yMap, keys] of mapDeletes) {
    try {
      const targetId = (yMap as unknown as { _item?: { id?: { toString?: () => string } } })._item?.id?.toString?.();
      console.log('[DEBUG-TRACE] Applying Map Deletes:', { targetId, keys: Array.from(keys) });
    } catch {
      // ignore trace logging errors
    }
    for (const key of Array.from(keys)) {
      if (yMap.has(key)) yMap.delete(key);
    }
  }
}

// Apply pending map sets
export function applyMapSets(mapSets: Map<Y.Map<unknown>, Map<string, PendingMapEntry>>, post: Array<() => void>, log: Logger, context: SynchronizationContext): void {
  for (const [yMap, keyToEntry] of mapSets) {
    try {
      const targetId = (yMap as unknown as { _item?: { id?: { toString?: () => string } } })._item?.id?.toString?.();
      console.log('[DEBUG-TRACE] Applying Map Sets:', { targetId, keys: Array.from(keyToEntry.keys()) });
    } catch {
      // ignore trace logging errors
    }
    const keys = Array.from(keyToEntry.keys());
    for (const key of keys) {
      const entry = keyToEntry.get(key)!;
      // Convert the plain value to Y type during apply phase
      const yValue = plainObjectToYType(entry.value, context);
      log.debug('[mapApply] map.set', { key });
      yMap.set(key, yValue);
      if (entry.after) {
        post.push(() => entry.after!(yValue));
      }
    }
  }
}
