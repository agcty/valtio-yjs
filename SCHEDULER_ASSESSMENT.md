# WriteScheduler Complexity Assessment

## Methodology

To assess what's truly needed in the WriteScheduler, I'll categorize each feature by:

1. **Load-bearing**: Required for correctness (tests will fail without it)
2. **Optimization**: Improves performance but not required for correctness
3. **Defensive**: Handles edge cases that might not occur in practice
4. **Dead code**: Unused or redundant

## Feature Inventory

### 1. Microtask Batching ✅ **LOAD-BEARING**

**Code**: Lines 146-151

```typescript
private scheduleFlush(): void {
  if (this.flushScheduled) return;
  this.flushScheduled = true;
  queueMicrotask(() => this.flush());
}
```

**Purpose**: Coalesce multiple Valtio operations in same tick into one Y.js transaction
**Test Coverage**: Implicit in all multi-operation tests
**Verdict**: **ESSENTIAL** - Core architectural requirement for performance and avoiding transaction storms

---

### 2. Operation Deduplication (Per-Array/Map) ✅ **LOAD-BEARING**

**Code**: Lines 38-42 (Maps), Lines 73-89 (enqueue methods)

```typescript
private pendingMapSets = new Map<Y.Map<unknown>, Map<string, PendingMapEntry>>();
private pendingMapDeletes = new Map<Y.Map<unknown>, Set<string>>();
// ...
perMap.set(key, { value, after: postUpgrade }); // Last write wins
```

**Purpose**: When same key/index mutated multiple times in a tick, only apply final value
**Test Coverage**: Property-based tests exercise rapid mutations
**Verdict**: **ESSENTIAL** - Prevents redundant Y.js operations

---

### 3. Delete+Set Merge to Replace ⚠️ **OPTIMIZATION** (but important)

**Code**: Lines 182-248

```typescript
// Merge array delete+set operations for the same index into replace operations
for (const [yArray, deleteIndices] of arrayDeletes) {
  const setMap = arraySets.get(yArray);
  // Conservative: only convert when exactly one delete and one set
  if (setCount === 1 && deleteCount === 1) {
    // ... merge logic
  }
}
```

**Purpose**: Treats `splice(i, 1, newVal)` as atomic replace instead of delete+insert
**Test Coverage**: `planning.array.spec.ts` lines 34-45, 47-57
**Analysis**:

- Tests verify merge happens
- BUT: Would correctness break without it? Let's think...
  - Without merge: `splice(1, 1, 'B')` → delete at 1, insert at 1
  - Result should be same in Y.js
  - Performance impact: 2 Y.Array ops instead of 1
  - Identity impact: Y item gets new ID vs keeping old ID (if Y.Map)

**Verdict**: **OPTIMIZATION** with semantic implications (identity preservation)
**Recommendation**: Keep it BUT simplify the conservative check

---

### 4. Subtree Collection and Purging 🤔 **DEFENSIVE**

**Code**: Lines 8-27 (collectYSubtree), 252-283 (replace purge), 305-332 (delete purge)

```typescript
function collectYSubtree(root: unknown) {
  // Recursively collect all Y.Map/Y.Array in subtree
}
// When replacing/deleting array item, purge ops targeting its children
```

**Purpose**: Prevent stale operations from targeting Y nodes that will be deleted
**Test Coverage**: ⚠️ **NO EXPLICIT TESTS FOUND**
**Analysis**:

- Scenario: `arr[0].nested.value = 'x'` enqueued, then `arr[0] = newObj` enqueued
- Without purge: First op tries to mutate old nested object after parent replaced
- Will Y.js throw? Or silently fail? Or corrupt state?

**Experiment needed**: Does removing this break anything?

**Verdict**: **DEFENSIVE** (possibly over-defensive)
**Recommendation**: Test if removal breaks anything. If not, remove it. If it's needed, add explicit test.

---

### 5. Post-Merge Replace→Set Demotion Prevention 🤔 **DEFENSIVE**

**Code**: Lines 300-303 (with comment "Avoid post-merge demotion...")

```typescript
// Note: Avoid post-merge demotion of replaces to sets here.
// Planner already applies nuanced demotion using previous-value context.
// Doing it here can duplicate shifted items.
```

**Purpose**: Trust planner's classification, don't second-guess it
**Test Coverage**: Comment references past bug ("can duplicate shifted items")
**Analysis**:

- Comment suggests this was added to fix a specific bug
- No test explicitly verifies this prevention
- Relies on planner doing right thing

**Verdict**: **HISTORICAL** - Fixed past bug, may no longer be needed
**Recommendation**: Add test for the "duplicate shifted items" scenario or verify it can't happen

---

### 6. Move Detection Heuristics ✅ **REMOVED**

**Code**: Previously lines 345-402 (~58 lines)

**Status**: **REMOVED** - This diagnostic code has been removed from the codebase.

**Reason for removal**:
- Array moves work correctly via splice operations
- Warning was misleading and created confusion
- Suggested moves were "not supported" when they actually work fine
- Pure diagnostic with no functional benefit

**Impact**: ~58 lines saved, improved user experience, no functional changes

---

### 7. Deterministic Operation Ordering ✅ **LOAD-BEARING**

**Code**: Lines 466-476

```typescript
doc.transact(() => {
  if (this.applyMapDeletesFn) {
    this.applyMapDeletesFn(mapDeletes);
  }
  if (this.applyMapSetsFn) {
    this.applyMapSetsFn(mapSets, postQueue);
  }
  if (this.applyArrayOperationsFn) {
    this.applyArrayOperationsFn(
      arraySets,
      arrayDeletes,
      arrayReplaces,
      postQueue
    );
  }
}, VALTIO_YJS_ORIGIN);
```

**Purpose**: Always apply deletes before sets to avoid index shift issues
**Test Coverage**: All array deletion tests depend on this
**Verdict**: **ESSENTIAL** - Core correctness requirement

---

### 8. Post-Transaction Queue ✅ **LOAD-BEARING**

**Code**: Lines 464, 478-483

```typescript
const postQueue = new PostTransactionQueue(this.log);
// ... transaction ...
postQueue.flush(this.withReconcilingLockFn);
```

**Purpose**: Eager upgrades and reconciliation after Y.js types created
**Test Coverage**: All nested object insertion tests
**Verdict**: **ESSENTIAL** - Required for eager upgrade pattern

---

### 9. Redundant Set Removal (Replace Wins) ✅ **LOAD-BEARING**

**Code**: Lines 286-298

```typescript
// Remove any sets that target indices also present in replaces
for (const [yArray, replaceMap] of arrayReplaces) {
  const setMap = arraySets.get(yArray);
  if (!setMap) continue;
  for (const idx of replaceMap.keys()) {
    if (setMap.has(idx)) {
      setMap.delete(idx);
    }
  }
}
```

**Purpose**: Prevent applying both replace AND set to same index
**Test Coverage**: Implicit in planning tests
**Verdict**: **LOAD-BEARING** - Prevents double-application bugs

---

### 10. Trace Mode Logging 📊 **DIAGNOSTIC**

**Code**: Lines 405-461 (trace mode dumps)

```typescript
if (this.traceMode) {
  this.log.debug('[scheduler] trace: planned intents...', {...});
  // ... detailed dumps
}
```

**Purpose**: Debug complex batching issues
**Test Coverage**: None (logging only)
**Analysis**:

- 56 lines of formatting/logging code
- Useful during development
- No functional impact

**Verdict**: **NICE-TO-HAVE**
**Recommendation**: Keep but consider moving to a separate debug module

---

## Summary Table

| Feature                 | Category     | Lines | Keep?                  | Priority to Test/Simplify                  |
| ----------------------- | ------------ | ----- | ---------------------- | ------------------------------------------ |
| Microtask batching      | Load-bearing | ~10   | ✅ Yes                 | -                                          |
| Operation deduplication | Load-bearing | ~20   | ✅ Yes                 | -                                          |
| Delete+Set merge        | Optimization | ~66   | ✅ Yes (simplify)      | MEDIUM - simplify conservative check       |
| Subtree purging         | Load-bearing | ~70   | ✅ Yes                 | DONE - Tests confirm necessity             |
| Demotion prevention     | Historical   | ~4    | ✅ Yes                 | Keep - prevents known bug                  |
| Move detection          | Diagnostic   | ~58   | ✅ Removed             | DONE - Removed misleading warning          |
| Operation ordering      | Load-bearing | ~10   | ✅ Yes                 | -                                          |
| Post-transaction queue  | Load-bearing | ~10   | ✅ Yes                 | -                                          |
| Redundant set removal   | Load-bearing | ~12   | ✅ Yes                 | -                                          |
| Trace logging           | Diagnostic   | ~56   | ⚠️ Keep (low priority) | LOW - Consider extracting                  |

---

## Recommended Simplification Strategy

### Phase 1: Verify and Document ✅ DONE

1. ✅ **Added tests for subtree purging** (`scheduler-purging.spec.ts`)
   - Tests confirm purging IS necessary
   - Prevents corruption from same-tick nested mutations
   - All tests pass

2. ✅ **Removed move detection** (~58 lines)
   - Array moves work correctly
   - Warning was misleading
   - Removed entirely

### Phase 2: Simplify Conservative Merge (TODO)

**Research the conservative merge check** (lines 182-203):
```typescript
// Current: Only merge if exactly one delete and one set per array
if (setCount === 1 && deleteCount === 1) {
  // Convert to replace
}

// Possible: Merge ANY delete+set at same index
for (const idx of deleteIndices) {
  if (setMap && setMap.has(idx)) {
    replaceMap.set(idx, setMap.get(idx));
    setMap.delete(idx);
    deleteIndices.delete(idx);
  }
}
```

**Action**: Check git history, test with multiple delete+set pairs

### Phase 3: Extract Diagnostics (Optional Cleanup)

1. Move trace logging to separate `SchedulerDebugger` class
2. Only instantiate when `traceMode === true`
3. Saves mental overhead when reading core logic

---

## Current Status

**Starting**: ~486 lines
**After move detection removal**: ~428 lines (-12%)
**Potential after Phase 2**: ~398-408 lines (-16% to -18%)

**Maintainability**: 📈 Already improved
**Risk**: 🟢 Low (all tests passing)
**Performance**: ➡️ Neutral (diagnostic code had no performance impact)

---

## Open Questions for User

1. **Subtree purging**: Have you ever seen a bug that this prevented? Or was this added "just in case"?

2. **Conservative merge check**: Why only merge when `setCount === 1 && deleteCount === 1`?

   - Is there a known bug with merging multiple delete+set pairs?
   - Or was this added to be extra cautious?

3. **Trace mode**: Is this actively used for debugging production issues? Or mainly for development?

4. **Delete-replace precedence** (lines 206-214): Why does replace win over delete? Shouldn't we just remove the redundant delete instead of checking in two places?
