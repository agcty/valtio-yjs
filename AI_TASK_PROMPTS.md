# AI Task Prompts - valtio-yjs Improvements

**Project Context**: valtio-yjs is a bridge library that synchronizes Valtio reactive state with Yjs CRDTs. It uses a sophisticated "Live Controller Proxy" model with microtask batching, two-phase reconciliation, and eager upgrades.

**Current Status**: 
- 220 tests passing (206 original + 14 new from Task 4)
- Architecture is solid (8/10 rating)
- Move detection removed (~58 lines saved)
- Conservative merge check simplified (~10 lines improved)
- ✅ Task 4 completed: Map subscription rollback for consistency
- See `ARCHITECTURE_ASSESSMENT_2025.md` and `SCHEDULER_COMPLEXITY_FINDINGS.md` for full context

---

## Task 1: Add Performance Benchmarks (Medium Priority) ⭐

**Estimated Time**: 2-3 hours  
**Priority**: Medium - High Value

### Context

Currently there are no comprehensive benchmarks, but the scheduler purging test showed ~5.8ms for 100 items. Users need concrete performance data to make informed decisions.

### Your Mission

Create a comprehensive performance benchmark suite that measures:

1. **Large arrays** (1000+ items)
   - Initial bootstrap time
   - Batch update performance (100 simultaneous updates)
   - Memory usage patterns
   
2. **Deep nesting** (10+ levels)
   - Nested object access time
   - Deep mutation propagation time
   - Compare lazy vs eager materialization impact
   
3. **Rapid mutations** (batching effectiveness)
   - Single microtask with 1000 operations
   - Multiple microtasks with 100 operations each
   - Measure transaction count vs operation count
   
4. **Multi-client sync latency**
   - Two-client setup with relay
   - Measure time from mutation to remote update
   - Test with various payload sizes

### Implementation Details

**File to create**: `valtio-yjs/benchmarks/performance.bench.ts`

**Use Vitest's bench API**:
```typescript
import { bench, describe } from 'vitest';

describe('Performance benchmarks', () => {
  bench('large array bootstrap (1000 items)', async () => {
    // Your benchmark code
  });
});
```

**Run with**: `npm run bench` (you may need to add this script to package.json)

### Success Criteria

- [ ] Benchmark suite covers all 4 categories
- [ ] Results are reproducible and documented
- [ ] Add performance expectations to README (e.g., "Handles 1000 items in <Xms")
- [ ] Include comparison table showing performance characteristics
- [ ] No performance regressions detected (compare against baseline)

### Files to Reference

- `valtio-yjs/tests/scheduler-purging.spec.ts` - Example of perf measurement
- `valtio-yjs/tests/e2e.collaboration.spec.ts` - Multi-client setup example
- `valtio-yjs/tests/test-helpers.ts` - Helper functions for setup

### Deliverables

1. `valtio-yjs/benchmarks/performance.bench.ts` - Benchmark suite
2. `valtio-yjs/docs/performance.md` - Performance documentation with results
3. Updated `README.md` with performance section
4. Optional: CI integration for performance regression detection

---

## Task 2: Extract Trace Logging to SchedulerDebugger Class (Low Priority)

**Estimated Time**: 30-60 minutes  
**Priority**: Low - Optional Polish

### Context

The WriteScheduler currently has ~56 lines of trace logging interleaved with business logic (lines 345-400). This makes the core logic harder to read. The trace mode is opt-in and used for debugging.

### Your Mission

Extract trace logging into a separate `SchedulerDebugger` class that's only instantiated when trace mode is enabled.

### Implementation Details

**File to create**: `valtio-yjs/src/scheduling/schedulerDebugger.ts`

```typescript
import type { Logger } from '../core/context.js';
import type { PendingMapEntry, PendingArrayEntry } from './batchTypes.js';

export class SchedulerDebugger {
  constructor(private log: Logger) {}

  logPlannedIntents(
    mapSets: Map<Y.Map<unknown>, Map<string, PendingMapEntry>>,
    mapDeletes: Map<Y.Map<unknown>, Set<string>>,
    arraySets: Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>,
    arrayDeletes: Map<Y.Array<unknown>, Set<number>>,
    arrayReplaces: Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>,
  ): void {
    // Move the planned intents logging here (lines 345-368)
  }

  logTransactionBatch(
    mapDeletes: Map<Y.Map<unknown>, Set<string>>,
    mapSets: Map<Y.Map<unknown>, Map<string, PendingMapEntry>>,
    arrayDeletes: Map<Y.Array<unknown>, Set<number>>,
    arraySets: Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>,
    arrayReplaces: Map<Y.Array<unknown>, Map<number, PendingArrayEntry>>,
  ): void {
    // Move the transaction batch logging here (lines 373-401)
  }
}
```

**File to modify**: `valtio-yjs/src/scheduling/writeScheduler.ts`

```typescript
export class WriteScheduler {
  private readonly debugger?: SchedulerDebugger;

  constructor(log: Logger, traceMode: boolean = false) {
    this.log = log;
    this.traceMode = traceMode;
    if (traceMode) {
      this.debugger = new SchedulerDebugger(log);
    }
  }

  private flush(): void {
    // ...
    if (this.debugger) {
      this.debugger.logPlannedIntents(mapSets, mapDeletes, arraySets, arrayDeletes, arrayReplaces);
    }
    // ...
    if (this.debugger) {
      this.debugger.logTransactionBatch(mapDeletes, mapSets, arrayDeletes, arraySets, arrayReplaces);
    }
  }
}
```

### Success Criteria

- [ ] SchedulerDebugger class created with clear API
- [ ] All trace logging moved out of WriteScheduler
- [ ] WriteScheduler.flush() is more readable
- [ ] Debugger only instantiated when traceMode is true
- [ ] All 206 tests still pass
- [ ] No functional changes (trace output identical)

### Files to Reference

- `valtio-yjs/src/scheduling/writeScheduler.ts` (lines 345-401)
- `valtio-yjs/src/core/context.ts` - Logger type definition

### Deliverables

1. `valtio-yjs/src/scheduling/schedulerDebugger.ts` - New debugger class
2. Modified `valtio-yjs/src/scheduling/writeScheduler.ts` - Cleaner core logic
3. Updated `valtio-yjs/src/index.ts` - Export if needed

---

## Task 3: Strengthen Type Safety (Low Priority)

**Estimated Time**: 2-3 hours  
**Priority**: Low - Better DX

### Context

The codebase currently uses heavy type assertions and `unknown` types in several places. This can lead to runtime errors that TypeScript should catch. From the architecture assessment (lines 289-300):

> **Observations**:
> - Heavy use of `unknown` and type assertions
> - Some unsafe casts: `(container as Record<string, unknown>)[key as keyof typeof container] as unknown`

### Your Mission

Improve type safety across the codebase to reduce runtime errors and improve developer experience.

### Implementation Areas

#### 1. Branded Types for Proxies

**Problem**: Can't distinguish Valtio controller proxies from plain objects at type level

**Solution**: Use branded types
```typescript
// In valtio-yjs/src/core/types.ts (create this file)
declare const ValtioProxyBrand: unique symbol;

export type ValtioProxy<T> = T & { [ValtioProxyBrand]: true };

export function isValtioProxy<T>(value: unknown): value is ValtioProxy<T> {
  // Runtime check implementation
}
```

#### 2. Reduce Type Assertions in Guards

**Files to improve**:
- `valtio-yjs/src/core/guards.ts`
- `valtio-yjs/src/bridge/valtio-bridge.ts`
- `valtio-yjs/src/converter.ts`

**Pattern to replace**:
```typescript
// Before (unsafe)
const value = (container as Record<string, unknown>)[key] as unknown;

// After (safer)
function getValueSafely<T extends Record<string, unknown>>(
  container: T,
  key: keyof T
): unknown {
  return container[key];
}
```

#### 3. Stricter TypeScript Config

**File**: `valtio-yjs/tsconfig.dev.json` (for development)

Add stricter checks:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictPropertyInitialization": true
  }
}
```

### Success Criteria

- [ ] Branded types introduced for Valtio proxies
- [ ] Type assertions reduced by at least 50%
- [ ] Stricter tsconfig.dev.json created
- [ ] All existing tests still pass
- [ ] No new `@ts-ignore` or `@ts-expect-error` added
- [ ] Better autocomplete and error messages in IDE

### Files to Audit

Run this to find type assertions:
```bash
cd valtio-yjs
grep -r " as " src/ --include="*.ts" | grep -v ".spec.ts" | wc -l
```

Focus on:
- `valtio-yjs/src/core/guards.ts`
- `valtio-yjs/src/bridge/valtio-bridge.ts`
- `valtio-yjs/src/converter.ts`
- `valtio-yjs/src/synchronizer.ts`

### Deliverables

1. `valtio-yjs/src/core/types.ts` - Branded types and utilities
2. Modified core files with improved type safety
3. `valtio-yjs/tsconfig.dev.json` - Stricter development config
4. Documentation update explaining type system improvements

---

## Task 4: Add Map Subscription Rollback (Consistency Fix) ✅ COMPLETED

**Estimated Time**: 1-2 hours  
**Priority**: Medium - Consistency & Correctness  
**Status**: ✅ **COMPLETED** - Implemented on 2025-01-30

### Context

From `ARCHITECTURE_ASSESSMENT_2025.md` (lines 147-153):

> **Observations**:
> - **Array subscription has rollback** on validation error (lines 118-131)
> - **Map subscription does NOT have rollback** (lines 149-174)
> - Inconsistency could lead to partial state on map validation errors

If a map operation fails validation, the Valtio proxy may be in an inconsistent state.

### Your Mission

Add rollback mechanism to map subscription to match array subscription behavior.

### Implementation Details

**File to modify**: `valtio-yjs/src/bridge/valtio-bridge.ts`

**Current array subscription pattern** (lines 118-131):
```typescript
subscribe(valtioArray, (ops) => {
  // Capture previous state
  const prevState = new Map(valtioArray.map((item, i) => [i, item]));
  
  try {
    // Process operations
    for (const op of ops) {
      // ... validation and processing
    }
  } catch (error) {
    // Rollback on error
    valtioArray.length = 0;
    valtioArray.push(...Array.from(prevState.values()));
    throw error;
  }
});
```

**Apply similar pattern to map subscription** (lines 149-174):
```typescript
subscribe(valtioMap, (ops) => {
  // TODO: Add rollback mechanism similar to array subscription
  const prevState = new Map(Object.entries(valtioMap));
  
  try {
    // Process operations
    for (const [op, path] of ops) {
      // ... validation and processing
    }
  } catch (error) {
    // Rollback: restore previous state
    for (const key of Object.keys(valtioMap)) {
      if (!prevState.has(key)) {
        delete valtioMap[key];
      }
    }
    for (const [key, value] of prevState) {
      valtioMap[key] = value;
    }
    throw error;
  }
});
```

### Testing

**Create test file**: `valtio-yjs/tests/map-validation-rollback.spec.ts`

```typescript
describe('Map validation rollback', () => {
  it('should rollback map changes on validation error', () => {
    const { proxy, bootstrap } = createYjsProxy(/* ... */);
    bootstrap({ user: { name: 'Alice', age: 30 } });
    
    const originalState = { ...proxy.user };
    
    expect(() => {
      proxy.user = { name: 'Bob', invalid: new Error('not serializable') };
    }).toThrow();
    
    // Should rollback to original state
    expect(proxy.user).toEqual(originalState);
  });
});
```

### Success Criteria

- [x] Map subscription has rollback on validation errors
- [x] Behavior matches array subscription pattern
- [x] New tests added for map rollback scenarios
- [x] All existing tests still pass (220 tests total: 206 original + 14 new)
- [x] Documentation updated explaining error handling

### Completion Summary

**Implemented**: January 30, 2025

**What Was Done**:
1. Added deep validation with rollback to map subscription in `valtio-bridge.ts`
2. Enhanced `validateDeepForSharedState` to check Y type re-parenting synchronously
3. Created comprehensive test suite with 14 new tests across 2 files:
   - `map-validation-rollback.spec.ts` (6 tests) - validation error scenarios
   - `valtio-proxy-vs-ytype.spec.ts` (8 tests) - normal vs abnormal usage patterns
4. Updated `architectural-decisions.md` with new decision #9 explaining the design
5. All 220 tests passing

**Key Improvements**:
- Maps and arrays now have consistent error handling behavior
- Validation errors are caught synchronously where assignment happens
- Automatic rollback prevents partial state corruption
- Clear distinction between normal usage (Valtio proxies) and abnormal usage (raw Y types)
- Better error messages and user-level error handling support

**Git Commit**: `de062e2` - feat(bridge): add validation rollback to map subscription for consistency

### Files to Reference

- `valtio-yjs/src/bridge/valtio-bridge.ts` (lines 118-174)
- `valtio-yjs/src/converter.ts` - `validateValueForSharedState()`
- `valtio-yjs/tests/bridge.spec.ts` - Existing validation tests

### Deliverables

1. Modified `valtio-yjs/src/bridge/valtio-bridge.ts` with map rollback
2. `valtio-yjs/tests/map-validation-rollback.spec.ts` - New tests
3. Updated documentation in `docs/architectural-decisions.md`

---

## Task 5: Document Performance Characteristics

**Estimated Time**: 1-2 hours  
**Priority**: Medium - User-Facing Value

### Context

Users need to understand the performance implications of different usage patterns. The architecture assessment noted (lines 357-369):

> **Potential Concerns**:
> - Parent chain walking: On every observeDeep event for lazy materialization
> - Subtree collection: Recursive traversal on every replace/delete

### Your Mission

Create comprehensive documentation explaining performance characteristics and best practices.

### Content to Cover

#### 1. Architecture Performance Model

**File**: `valtio-yjs/docs/performance.md`

```markdown
# Performance Characteristics

## Overview

valtio-yjs is designed for typical UI state synchronization scenarios. Here's what you need to know:

### Microtask Batching
- All operations in the same JavaScript task are batched
- Results in single Y.js transaction per microtask
- **Impact**: Hundreds of operations → 1 network update

### Lazy Materialization
- Nested objects only create proxies when accessed
- **Trade-off**: Memory efficient but requires parent chain walking
- **Best for**: Sparse data structures, large trees with partial access

### Subtree Purging
- Prevents stale operations on deleted/replaced nodes
- Recursive traversal on replace/delete operations
- **Benchmark**: ~5.8ms for 100 items (negligible overhead)

## Performance Profiles

### Best Case: Shallow, Frequent Updates
...

### Worst Case: Deep Nesting with Full Traversal
...

### Typical Case: UI State Sync
...
```

#### 2. Best Practices Guide

Add section to `README.md`:

```markdown
## Performance Best Practices

### ✅ Do
- Batch related updates in the same tick
- Use shallow structures when possible
- Access only the data you need (lazy materialization)

### ⚠️ Be Careful
- Very deep nesting (10+ levels) has overhead
- Large array operations (1000+ items) should be tested
- Hot paths: profile before optimizing

### 📊 Benchmarks
- Bootstrap 1000 items: ~Xms
- 100 simultaneous updates: ~Xms
- Deep nesting (10 levels): ~Xms
```

#### 3. Known Limitations

Document in `docs/architecture.md`:

```markdown
## Performance Considerations

### Parent Chain Walking
On every inbound Y.js event, the system walks the parent chain...

**When it matters**: Deep nesting (>10 levels) with many updates
**Mitigation**: Cache nearest materialized ancestor (future optimization)

### Subtree Collection
On replace/delete operations, recursively collects descendants...

**When it matters**: Large subtrees (>100 nested objects)
**Mitigation**: Already optimized; tested at ~5.8ms for 100 items
```

### Success Criteria

- [ ] `docs/performance.md` created with comprehensive content
- [ ] `README.md` updated with performance section
- [ ] Includes concrete benchmarks from Task 1
- [ ] Best practices clearly explained
- [ ] Known limitations documented with mitigations
- [ ] Examples of good and bad usage patterns

### Files to Reference

- `ARCHITECTURE_ASSESSMENT_2025.md` (performance section)
- `SCHEDULER_COMPLEXITY_FINDINGS.md` (purging benchmarks)
- Benchmark results from Task 1

### Deliverables

1. `valtio-yjs/docs/performance.md` - Comprehensive guide
2. Updated `README.md` with performance section
3. Updated `docs/architecture.md` with considerations

---

## General Guidelines for All Tasks

### Before Starting

1. Read the architecture documents:
   - `ARCHITECTURE_ASSESSMENT_2025.md`
   - `SCHEDULER_COMPLEXITY_FINDINGS.md`
   - `docs/architecture.md`
   - `docs/data-flow.md`

2. Run the test suite to establish baseline:
   ```bash
   cd valtio-yjs && npm test
   ```

3. Check current line count:
   ```bash
   wc -l valtio-yjs/src/**/*.ts
   ```

### While Working

- Write tests FIRST (TDD approach)
- Run tests frequently: `npm test -- <your-test-file>`
- Use existing patterns from the codebase
- Add inline comments for complex logic
- Update relevant documentation as you go

### After Completing

- [ ] All tests pass (no regressions)
- [ ] New tests added for new functionality
- [ ] Documentation updated
- [ ] Code formatted and linted
- [ ] Commit with descriptive message following pattern:
  ```
  <type>(<scope>): <description>
  
  <detailed explanation>
  
  Changes:
  - <change 1>
  - <change 2>
  
  Testing:
  - <test description>
  
  Benefits:
  - <benefit 1>
  ```

### Commit Message Types

- `feat`: New feature
- `refactor`: Code restructuring without behavior change
- `perf`: Performance improvement
- `docs`: Documentation only
- `test`: Adding or updating tests
- `fix`: Bug fix

---

## Suggested Order

For maximum value, tackle in this order:

1. **Task 4** (Map Subscription Rollback) - Correctness & consistency
2. **Task 1** (Performance Benchmarks) - Provides data for Task 5
3. **Task 5** (Document Performance) - User-facing value
4. **Task 2** (Extract Trace Logging) - Code quality
5. **Task 3** (Strengthen Type Safety) - Long-term maintainability

---

## Questions or Issues?

If you encounter issues:

1. Check existing tests for patterns
2. Review architectural decision documents
3. Run `npm test -- <relevant-test>` to isolate issues
4. Check git history: `git log --oneline --all -- <file-path>`

Good luck! 🚀
