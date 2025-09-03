// Array operations planner
//
// Responsibility:
// - Analyze Valtio subscription ops and categorize array operations
// - Separate planning (what to do) from scheduling (when to do it)
// - Identify specific array intents: sets (inserts), deletes, and replaces

// Re-export type guards for array operations
type ValtioArrayPath = [number | string];
type ValtioSetArrayOp = ['set', ValtioArrayPath, unknown, unknown];
type ValtioDeleteArrayOp = ['delete', ValtioArrayPath, unknown];

function isSetArrayOp(op: unknown): op is ValtioSetArrayOp {
  if (!Array.isArray(op) || op[0] !== 'set' || !Array.isArray(op[1]) || op[1].length !== 1) return false;
  const idx = (op as [string, [number | string]])[1][0];
  return typeof idx === 'number' || (typeof idx === 'string' && /^\d+$/.test(idx));
}

function isDeleteArrayOp(op: unknown): op is ValtioDeleteArrayOp {
  if (!Array.isArray(op) || op[0] !== 'delete' || !Array.isArray(op[1]) || op[1].length !== 1) return false;
  const idx = (op as [string, [number | string]])[1][0];
  return typeof idx === 'number' || (typeof idx === 'string' && /^\d+$/.test(idx));
}

// Normalize array path indices coming from Valtio subscribe.
function normalizeIndex(idx: number | string): number {
  return typeof idx === 'number' ? idx : Number.parseInt(idx, 10);
}

export interface ArrayOpsPlans {
  sets: Map<number, unknown>;      // Pure inserts/pushes/unshifts
  deletes: Set<number>;            // Pure deletions
  replaces: Map<number, unknown>; // Replace operations (delete + set at same index)
}

/**
 * Analyzes Valtio subscription ops and categorizes array operations.
 * Identifies specific array intents: sets, deletes, and replaces.
 * 
 * @param ops - Array of Valtio subscription operations
 * @param yArrayLength - Current length of the Y.Array (for context)
 * @returns Object containing categorized array operations
 */
export function planArrayOps(ops: unknown[], yArrayLength: number): ArrayOpsPlans {
  // Phase 1: Categorize all array set and delete ops into intermediate maps
  const setsByIndex = new Map<number, unknown>();
  const deletesByIndex = new Set<number>();

  for (const op of ops) {
    if (isSetArrayOp(op)) {
      const idx = normalizeIndex(op[1][0]);
      const newValue = op[2]; // The new value being set
      setsByIndex.set(idx, newValue);
    } else if (isDeleteArrayOp(op)) {
      const idx = normalizeIndex(op[1][0]);
      deletesByIndex.add(idx);
    }
    // Ignore all other operations (map operations, nested operations, etc.)
  }

  // Phase 2: Identify replaces, pure deletes, and pure sets
  const replaces = new Map<number, unknown>();
  const deletes = new Set<number>();
  const sets = new Map<number, unknown>();

  // Check for replaces: delete + set at same index
  for (const deletedIndex of deletesByIndex) {
    if (setsByIndex.has(deletedIndex)) {
      // This is a replace operation
      replaces.set(deletedIndex, setsByIndex.get(deletedIndex)!);
      // Remove from both intermediate collections
      setsByIndex.delete(deletedIndex);
      deletesByIndex.delete(deletedIndex);
    }
  }

  // Remaining deletes are pure deletes
  for (const deletedIndex of deletesByIndex) {
    deletes.add(deletedIndex);
  }

  // Remaining sets are pure sets (inserts/pushes/unshifts)
  for (const [setIndex, setValue] of setsByIndex) {
    sets.set(setIndex, setValue);
  }

  // Phase 3: Move detection warning (but don't drop operations anymore)
  if (deletes.size > 0 && sets.size > 0) {
    const sortedDeletes = Array.from(deletes).sort((a, b) => a - b);
    const sortedSets = Array.from(sets.keys()).sort((a, b) => a - b);
    
    console.warn(
      '[valtio-yjs] Potential array move detected. Move operations are not supported. Implement moves at the app layer (e.g., fractional indexing or explicit remove+insert in separate ticks). This is a heuristic and may also occur with splice/replace or reindex shifts.',
      {
        deletes: sortedDeletes,
        sets: sortedSets,
        length: yArrayLength,
        suggestions: [
          'If this was a move: perform delete and insert in separate ticks, or use fractional indexing.',
          'If this was a replace/splice: this hint can be ignored; reindexing may emit index sets.',
          'Reduce noise: avoid combining structural deletes with index sets in the same tick when possible.',
        ],
      },
    );
    // Note: We no longer drop the sets here. We handle them as separate operations.
  }

  return { sets, deletes, replaces };
}