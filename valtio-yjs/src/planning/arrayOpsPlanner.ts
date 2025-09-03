// Array operations planner
//
// Responsibility:
// - Analyze Valtio subscription ops and categorize array operations
// - Separate planning (what to do) from scheduling (when to do it)
// - Identify specific array intents: sets (inserts), deletes, and replaces
// - Direct array index assignment (`arr[i] = val`) is treated as a replace,
//   equivalent to splice(i, 1, val). We do not forbid it; we translate it
//   deterministically per the Translator's Guide.

import { SynchronizationContext } from '../core/context.js';

// Type guards for array operations
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

function isLengthSetOp(op: unknown): op is ['set', ['length'], number] {
  return Array.isArray(op) && op[0] === 'set' && Array.isArray(op[1]) && op[1].length === 1 && op[1][0] === 'length';
}

// Normalize array path indices coming from Valtio subscribe.
function normalizeIndex(idx: number | string): number {
  return typeof idx === 'number' ? idx : Number.parseInt(idx, 10);
}

export interface ArrayOpsPlans {
  sets: Map<number, unknown>;      // Pure inserts/pushes/unshifts
  deletes: Set<number>;            // Pure deletions
  replaces: Map<number, unknown>;  // Replace operations (splice replacements)
}

/**
 * Analyzes Valtio subscription ops and categorizes array operations.
 * Focus on making splice operations work correctly.
 *
 * @param ops - Array of Valtio subscription operations
 * @param yArrayLength - Current length of the Y.Array (for context)
 * @param context - Synchronization context for debug logging
 * @returns Object containing categorized array operations
 */
export function planArrayOps(ops: unknown[], yArrayLength: number, context?: SynchronizationContext): ArrayOpsPlans {
  // Phase 1: Collect raw array ops by index (state-agnostic)
  const setsByIndex = new Map<number, unknown>();
  const deletesByIndex = new Set<number>();

  for (const op of ops) {
    if (isSetArrayOp(op)) {
      const idx = normalizeIndex(op[1][0]);
      const newValue = (op as ValtioSetArrayOp)[2];
      setsByIndex.set(idx, newValue);
    } else if (isDeleteArrayOp(op)) {
      const idx = normalizeIndex(op[1][0]);
      deletesByIndex.add(idx);
    }
  }

  // Phase 2: Derive replaces when both delete and set happen at the same index.
  // Always consume the delete (do not keep it as a pure delete). Only classify
  // as a replace when the index is within bounds at batch start; otherwise keep as set.
  const replaces = new Map<number, unknown>();
  for (const deletedIndex of Array.from(deletesByIndex)) {
    if (setsByIndex.has(deletedIndex)) {
      // Drop delete; we have a set for the same index in this batch
      deletesByIndex.delete(deletedIndex);
      const setVal = setsByIndex.get(deletedIndex)!;
      if (deletedIndex < yArrayLength) {
        replaces.set(deletedIndex, setVal);
        setsByIndex.delete(deletedIndex);
      }
    }
  }

  // Phase 3: Coalescing-friendly normalization for head/tail inserts
  const sets = new Map<number, unknown>();
  const deletes = new Set<number>();

  const remainingSetIndices = Array.from(setsByIndex.keys()).sort((a, b) => a - b);
  let usedHeadOptimization = false;
  if (remainingSetIndices.length > 0) {
    // Baseline classification: no coalescing logic; classify purely by start-of-batch length
    for (const idx of remainingSetIndices) {
      const val = setsByIndex.get(idx)!;
      if (idx < yArrayLength) {
        replaces.set(idx, val);
      } else {
        sets.set(idx, val);
      }
    }
  }

  // Phase 4: Remaining deletes are pure deletes, unless head optimization was applied
  for (const deletedIndex of deletesByIndex) {
    deletes.add(deletedIndex);
  }

  // Phase 5: Move detection warning
  // Detect potential moves by looking for:
  // 1. Pure deletes and sets at different indices
  // 2. Shift patterns from splice operations that simulate moves
  // 3. Multiple consecutive replaces which indicate element shifting
  
  let possibleMoveDetected = false;
  
  // Check if we have the classic delete+insert pattern
  if (deletes.size > 0 && sets.size > 0) {
    possibleMoveDetected = true;
  }
  
  // Check for splice-generated move patterns
  const replaceIndices = Array.from(replaces.keys()).sort((a, b) => a - b);
  
  // Multiple consecutive replaces usually indicate element shifting from splice operations
  // For example, splice(1, 1) followed by splice(3, 0, 'b') will create replaces at indices 1, 2, 3
  if (replaceIndices.length >= 2) {
    let consecutiveCount = 1;
    for (let i = 0; i < replaceIndices.length - 1; i++) {
      if (replaceIndices[i + 1] === replaceIndices[i] + 1) {
        consecutiveCount++;
      } else {
        consecutiveCount = 1;
      }
      // If we have 2+ consecutive replaces, it's likely a shift pattern from splice
      if (consecutiveCount >= 2) {
        possibleMoveDetected = true;
        break;
      }
    }
  }
  
  if (possibleMoveDetected) {
    const sortedDeletes = Array.from(deletes).sort((a, b) => a - b);
    const sortedSets = Array.from(sets.keys()).sort((a, b) => a - b);
    // Use console.warn directly to ensure visibility, independent of debug flag for safety
    console.warn(
      '[valtio-yjs] Potential array move detected. "Move" operations are not natively supported and are treated as a separate delete and insert. For data-intensive moves, consider application-level strategies like fractional indexing.',
      {
        deletes: sortedDeletes,
        sets: sortedSets,
        length: yArrayLength,
      },
    );
  }

  // Phase 6: Trace planning result in debug sessions (controlled by debug flag)
  if (context) {
    context.log.debug('[planner][array] result', {
      yArrayLength,
      sets: Array.from(sets.keys()),
      deletes: Array.from(deletes.values()),
      replaces: Array.from(replaces.keys()),
    });
  }

  return { sets, deletes, replaces };
}