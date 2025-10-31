# Test Migration Guide: SynchronizationContext → ValtioYjsCoordinator

## Overview

The architectural refactor eliminated circular dependencies by:

1. Creating `SynchronizationState` (pure data holder)
2. Creating `Logger` (separate logging infrastructure)
3. Creating `ValtioYjsCoordinator` (orchestrator with dependency injection)
4. Deleting `SynchronizationContext` and `createSynchronizationContext`

## Files That Need Updates

### **Priority 1: Core Tests**

These files directly instantiate the old context and must be updated:

1. **`src/core/context.test.ts`** ⚠️

   - **Action**: Rename or delete this file
   - **Reason**: Tests `SynchronizationContext` which no longer exists
   - **Options**:
     - Delete entirely (coordinator is tested indirectly)
     - Rename to `coordinator.test.ts` and test `ValtioYjsCoordinator`

2. **`src/core/converter.test.ts`**

   - **Old**: `new SynchronizationContext()` or `createSynchronizationContext()`
   - **New**: Create mock state + logger for unit tests

   ```typescript
   import { SynchronizationState } from "../core/synchronization-state";
   import { createLogger } from "../core/logger";

   // In each test:
   const state = new SynchronizationState();
   const logger = createLogger(false);

   // Then pass to functions:
   plainObjectToYType(value, state, logger);
   ```

3. **`src/reconcile/reconciler.test.ts`**

   - **Old**: `new SynchronizationContext(debug)`
   - **New**: `new ValtioYjsCoordinator(doc, debug)`
   - **Update imports**:

     ```typescript
     // OLD:
     import { SynchronizationContext } from "../core/context";

     // NEW:
     import { ValtioYjsCoordinator } from "../core/coordinator";
     ```

   - **Update function calls**:

     ```typescript
     // OLD:
     reconcileValtioMap(context, yMap, doc);
     reconcileValtioArray(context, yArray, doc);

     // NEW:
     reconcileValtioMap(
       coordinator.state,
       coordinator.logger,
       yMap,
       doc,
       (fn) => coordinator.withReconcilingLock(fn)
     );
     ```

4. **`src/reconcile/reconciler.delta.test.ts`**
   - Same changes as `reconciler.test.ts`
   - Update `reconcileValtioArrayWithDelta` calls:
     ```typescript
     // NEW:
     reconcileValtioArrayWithDelta(
       coordinator.state,
       coordinator.logger,
       yArray,
       doc,
       delta,
       (fn) => coordinator.withReconcilingLock(fn)
     );
     ```

### **Priority 2: Scheduler/Apply Tests**

These may use context for setup/mocking:

5. **`src/scheduling/write-scheduler.test.ts`**

   - **Old**: Mock `SynchronizationContext`
   - **New**: `WriteScheduler` now uses constructor injection

   ```typescript
   import { WriteScheduler, type ApplyFunctions } from "./write-scheduler";
   import { createLogger } from "../core/logger";
   import * as Y from "yjs";

   const doc = new Y.Doc();
   const logger = createLogger(true);
   const mockApplyFns: ApplyFunctions = {
     applyMapDeletes: vi.fn(),
     applyMapSets: vi.fn(),
     applyArrayOperations: vi.fn(),
     withReconcilingLock: vi.fn((fn) => fn()),
   };

   const scheduler = new WriteScheduler(doc, logger, mockApplyFns, false);
   ```

6. **`src/scheduling/write-scheduler.purging.test.ts`**

   - Same changes as `write-scheduler.test.ts`

7. **`src/scheduling/array-apply.test.ts`**

   - **Old**: Pass `context` to `applyArrayOperations`
   - **New**: Pass `state`, `logger`, and `withReconcilingLock`

   ```typescript
   import { SynchronizationState } from "../core/synchronization-state";
   import { createLogger } from "../core/logger";

   const state = new SynchronizationState();
   const logger = createLogger(true);
   const withLock = (fn: () => void) => {
     state.isReconciling = true;
     try {
       fn();
     } finally {
       state.isReconciling = false;
     }
   };

   applyArrayOperations(
     state,
     logger,
     sets,
     deletes,
     replaces,
     queue,
     withLock
   );
   ```

8. **`src/scheduling/post-transaction-queue.test.ts`**
   - Should be unaffected (only uses Logger)
   - If it creates context, replace with:
     ```typescript
     const logger = createLogger(true);
     ```

### **Priority 3: Integration Tests**

9. **`src/synced-types.test.ts`**
   - **Old**: May use `createSynchronizationContext`
   - **New**: Use `createYjsProxy` directly (already uses new coordinator)
   - Or create coordinator manually:
     ```typescript
     import { ValtioYjsCoordinator } from "./core/coordinator";
     const coordinator = new ValtioYjsCoordinator(doc, true);
     ```

### **Other Test Files**

10. **`src/core/guards.test.ts`**
    - Likely unaffected (no context usage)

---

## Common Patterns

### Pattern 1: Direct Context Creation

```typescript
// OLD:
const context = new SynchronizationContext(true);
context.bindDoc(doc);

// NEW Option A: Use Coordinator (preferred for integration tests)
const coordinator = new ValtioYjsCoordinator(doc, true);

// NEW Option B: Use State + Logger (preferred for unit tests)
const state = new SynchronizationState();
const logger = createLogger(true);
```

### Pattern 2: Context Properties

```typescript
// OLD:
context.log.debug("message");
context.yTypeToValtioProxy.get(yMap);
context.isReconciling;
context.enqueueMapSet(yMap, key, value);

// NEW with Coordinator:
coordinator.logger.debug("message");
coordinator.state.yTypeToValtioProxy.get(yMap);
coordinator.state.isReconciling;
coordinator.enqueueMapSet(yMap, key, value);

// NEW with State + Logger (unit tests):
logger.debug("message");
state.yTypeToValtioProxy.get(yMap);
state.isReconciling;
// Note: enqueue methods only available on coordinator!
```

### Pattern 3: Function Signatures Changed

#### `plainObjectToYType`

```typescript
// OLD:
plainObjectToYType(value, context);

// NEW:
plainObjectToYType(value, state, logger);
```

#### `reconcileValtioMap` / `reconcileValtioArray`

```typescript
// OLD:
reconcileValtioMap(context, yMap, doc);
reconcileValtioArray(context, yArray, doc);

// NEW:
reconcileValtioMap(state, logger, yMap, doc, withReconcilingLock);
reconcileValtioArray(state, logger, yArray, doc, withReconcilingLock);

// Where withReconcilingLock is:
const withReconcilingLock = (fn: () => void) =>
  coordinator.withReconcilingLock(fn);
// OR for unit tests:
const withReconcilingLock = (fn: () => void) => {
  const prev = state.isReconciling;
  state.isReconciling = true;
  try {
    fn();
  } finally {
    state.isReconciling = prev;
  }
};
```

#### `reconcileValtioArrayWithDelta`

```typescript
// OLD:
reconcileValtioArrayWithDelta(context, yArray, doc, delta);

// NEW:
reconcileValtioArrayWithDelta(
  state,
  logger,
  yArray,
  doc,
  delta,
  withReconcilingLock
);
```

#### `getOrCreateValtioProxy` / `getValtioProxyForYType`

```typescript
// OLD:
getOrCreateValtioProxy(context, yType, doc);
getValtioProxyForYType(context, yType);

// NEW:
getOrCreateValtioProxy(coordinator, yType, doc);
getValtioProxyForYType(coordinator, yType);
```

#### `setupLeafNodeAsComputed` / `setupLeafNodeAsComputedInArray`

```typescript
// OLD:
setupLeafNodeAsComputed(context, proxy, key, leafNode);
setupLeafNodeAsComputedInArray(context, proxy, index, leafNode);

// NEW:
setupLeafNodeAsComputed(coordinator, proxy, key, leafNode);
setupLeafNodeAsComputedInArray(coordinator, proxy, index, leafNode);
```

#### `planArrayOps`

```typescript
// OLD:
planArrayOps(ops, yArrayLength, context);

// NEW:
planArrayOps(ops, yArrayLength, coordinator);
```

#### `applyArrayOperations`

```typescript
// OLD:
applyArrayOperations(context, sets, deletes, replaces, postQueue);

// NEW:
applyArrayOperations(
  state,
  logger,
  sets,
  deletes,
  replaces,
  postQueue,
  withReconcilingLock
);
```

#### `applyMapSets`

```typescript
// OLD:
applyMapSets(mapSets, postQueue, log, context);

// NEW:
applyMapSets(mapSets, postQueue, log, state, withReconcilingLock);
```

---

## Test Helper Utilities (Recommended)

Create a test utilities file for common patterns:

```typescript
// test-utils.ts
import * as Y from "yjs";
import { ValtioYjsCoordinator } from "./core/coordinator";
import { SynchronizationState } from "./core/synchronization-state";
import { createLogger, type Logger } from "./core/logger";

/**
 * Create a coordinator for integration tests
 */
export function createTestCoordinator(debug = true): {
  coordinator: ValtioYjsCoordinator;
  doc: Y.Doc;
} {
  const doc = new Y.Doc();
  const coordinator = new ValtioYjsCoordinator(doc, debug);
  return { coordinator, doc };
}

/**
 * Create state + logger for unit tests
 */
export function createTestState(debug = true): {
  state: SynchronizationState;
  logger: Logger;
  withReconcilingLock: (fn: () => void) => void;
} {
  const state = new SynchronizationState();
  const logger = createLogger(debug);
  const withReconcilingLock = (fn: () => void) => {
    const prev = state.isReconciling;
    state.isReconciling = true;
    try {
      fn();
    } finally {
      state.isReconciling = prev;
    }
  };
  return { state, logger, withReconcilingLock };
}
```

Then in tests:

```typescript
import { createTestCoordinator, createTestState } from "../test-utils";

describe("Integration test", () => {
  it("works", () => {
    const { coordinator, doc } = createTestCoordinator();
    // Use coordinator...
  });
});

describe("Unit test", () => {
  it("works", () => {
    const { state, logger, withReconcilingLock } = createTestState();
    // Use state + logger...
  });
});
```

---

## Decision Tree: Coordinator vs State+Logger

### Use **Coordinator** when:

- ✅ Integration tests that test full system behavior
- ✅ Tests that need enqueue methods (`enqueueMapSet`, etc.)
- ✅ Tests that need `withReconcilingLock` behavior
- ✅ Tests that call multiple layers (bridge → scheduler → apply)

### Use **State + Logger** when:

- ✅ Pure unit tests of individual functions
- ✅ Testing converter functions in isolation
- ✅ Testing reconciler logic without scheduling
- ✅ Mocking is simpler with direct dependencies

---

## Verification Checklist

After updating tests:

- [ ] All imports updated (`ValtioYjsCoordinator` not `SynchronizationContext`)
- [ ] No references to `createSynchronizationContext` or `context-factory.ts`
- [ ] Function signatures match new parameters (state, logger, withReconcilingLock)
- [ ] Tests compile without errors
- [ ] Tests run and pass
- [ ] No circular dependency warnings

---

## Example: Full Test Migration

### Before (`reconciler.test.ts`):

```typescript
import { SynchronizationContext } from "../core/context";
import { reconcileValtioMap } from "./reconciler";
import * as Y from "yjs";

describe("reconcileValtioMap", () => {
  it("reconciles map", () => {
    const doc = new Y.Doc();
    const context = new SynchronizationContext(true);
    context.bindDoc(doc);
    const yMap = new Y.Map();

    reconcileValtioMap(context, yMap, doc);

    expect(context.yTypeToValtioProxy.has(yMap)).toBe(true);
  });
});
```

### After (Option A - Integration):

```typescript
import { ValtioYjsCoordinator } from "../core/coordinator";
import { reconcileValtioMap } from "./reconciler";
import * as Y from "yjs";

describe("reconcileValtioMap", () => {
  it("reconciles map", () => {
    const doc = new Y.Doc();
    const coordinator = new ValtioYjsCoordinator(doc, true);
    const yMap = new Y.Map();

    reconcileValtioMap(coordinator.state, coordinator.logger, yMap, doc, (fn) =>
      coordinator.withReconcilingLock(fn)
    );

    expect(coordinator.state.yTypeToValtioProxy.has(yMap)).toBe(true);
  });
});
```

### After (Option B - Unit with Helper):

```typescript
import { createTestState } from "../test-utils";
import { reconcileValtioMap } from "./reconciler";
import * as Y from "yjs";

describe("reconcileValtioMap", () => {
  it("reconciles map", () => {
    const doc = new Y.Doc();
    const { state, logger, withReconcilingLock } = createTestState(true);
    const yMap = new Y.Map();

    reconcileValtioMap(state, logger, yMap, doc, withReconcilingLock);

    expect(state.yTypeToValtioProxy.has(yMap)).toBe(true);
  });
});
```

---

## Summary

**Total Files to Update**: 9-10 test files

**Estimated Time**:

- Simple unit tests: 5-10 min each
- Integration tests: 10-15 min each
- Total: 1-2 hours

**Risk Level**: **Low** - Changes are mechanical and type system catches errors

**Strategy**: Start with `context.test.ts` (rename/delete), then do unit tests (converter), then integration tests (reconciler).
