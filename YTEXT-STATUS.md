# Y.Text Reactivity - Current Status

## Summary

Working on fixing Y.Text reactivity issues. Two bugs were identified:

- ✅ **Bug #1 FIXED**: Double observer registration
- ⚠️ **Bug #2 IN PROGRESS**: React components not re-rendering when Y.Text changes

## Bug #1: Double Observer Registration (FIXED ✅)

**Problem**: Reconciler was replacing wrapped leaf nodes during reconciliation, destroying the wrapper and causing observers to be registered multiple times.

**Location**: `valtio-yjs/src/reconcile/reconciler.ts` lines 88-99

**Fix Applied**: Check if the underlying Y.js instance has changed before replacing the wrapper.

```typescript
// Get the underlying Y.js leaf node from the computed property
const underlyingCurrent = getUnderlyingLeaf(valtioProxy, key);

// Only replace if the underlying Y.js instance has changed
if (underlyingCurrent !== yValue) {
  context.log.debug("[REPLACE] leaf node instance changed", key);
  setupLeafNodeAsComputed(context, valtioProxy, key, yValue);
} else {
  context.log.debug("[SKIP] leaf node unchanged", key);
}
```

**Test Proof**: `ytext-typing-sequential.spec.tsx` - "should only trigger ONE observer call per Y.Text modification" **PASSES** ✅

## Bug #2: React Components Not Re-rendering (IN PROGRESS ⚠️)

### Current Implementation

Replaced the wrapper approach with **computed properties** that touch a version counter:

**Location**: `valtio-yjs/src/bridge/valtio-bridge.ts` lines 262-288

```typescript
// Initialize version counter
initialObj["__valtio_yjs_version"] = 0;

// Create proxy
const objProxy = proxy(initialObj);

// Define computed property on the proxy
Object.defineProperty(objProxy, key, {
  get() {
    // Touch version counter to create dependency
    const version = this["__valtio_yjs_version"];
    void version;
    // Return the stored leaf node
    return this[`__valtio_yjs_leaf_${key}`];
  },
  enumerable: true,
  configurable: true,
});

// Y.js observer increments version counter
leafNode.observe(() => {
  objProxy["__valtio_yjs_version"]++;
});
```

### What's Working

- ✅ Observer fires when Y.Text changes
- ✅ Version counter increments (`__valtio_yjs_version` goes from 0 to 1, 2, etc.)
- ✅ Manually incrementing version counter (`proxy.__valtio_yjs_version++`) triggers re-renders
- ✅ Computed property exists and returns Y.Text correctly
- ✅ Pattern matches the working test in `valtio-computed-test.spec.tsx`

### What's NOT Working

- ❌ React components don't re-render when Y.Text observer increments the version counter
- ❌ Controlled textarea doesn't update when typing

### The Mystery

**This works** (manual increment):

```typescript
proxy.__valtio_yjs_version++; // ✅ Triggers re-render
```

**This doesn't work** (observer increment):

```typescript
leafNode.observe(() => {
  proxy.__valtio_yjs_version++; // ❌ Doesn't trigger re-render
});
```

Both are doing the exact same mutation, but only the manual one triggers re-renders.

### Theories

1. **Timing issue**: Observer might be firing in a different microtask/tick
2. **Transaction context**: Y.js observer might be inside a transaction that blocks reactivity
3. **Dependency tracking**: The getter might not be creating dependencies properly during snapshot access
4. **Ref isolation**: Even though we're using a string property for version, something about the leaf storage might be interfering

## Test Results

### Passing Tests ✅

- `valtio-yjs/tests/integration/ytext-typing-sequential.spec.tsx` - "should only trigger ONE observer call" (proves Bug #1 fixed)
- `valtio-yjs/tests/integration/valtio-computed-test.spec.tsx` - Both tests pass (proves computed property pattern works)

### Failing Tests ❌

- `valtio-yjs/tests/integration/ytext-typing-sequential.spec.tsx` - "should handle typing 'hello' character by character"
- `valtio-yjs/tests/integration/ytext-typing-sequential.spec.tsx` - "should handle progressive .fill() calls"

## Files Modified

1. **`valtio-yjs/src/bridge/valtio-bridge.ts`**

   - Replaced wrapper approach with computed properties
   - Define getter on proxy after creation
   - Use string properties for version counter and leaf storage

2. **`valtio-yjs/src/reconcile/reconciler.ts`**

   - Updated to use `setupLeafNodeAsComputed` instead of wrappers
   - Added check to prevent unnecessary leaf node replacement

3. **`valtio-yjs/src/bridge/leaf-computed.ts`**
   - Reference implementation of computed property approach
   - Currently not used (inline implementation in valtio-bridge.ts instead)

## Next Steps

1. **Debug why observer increments don't trigger re-renders**

   - Add timing/logging to understand execution context
   - Check if Y.js transaction isolation is blocking Valtio reactivity
   - Verify getter is actually being called during snapshot access

2. **Alternative approaches if current doesn't work**:
   - Try using a nested proxy for version tracking instead of primitive
   - Try manual notification via Valtio's internal APIs
   - Consider if we need to flush/sync after observer updates

## How to Test

```bash
cd valtio-yjs/valtio-yjs

# Test observer registration (should pass)
pnpm vitest run tests/integration/ytext-typing-sequential.spec.tsx -t "should only trigger ONE observer"

# Test computed property pattern (should pass)
pnpm vitest run tests/integration/valtio-computed-test.spec.tsx

# Test typing (currently fails)
pnpm vitest run tests/integration/ytext-typing-sequential.spec.tsx -t "should handle typing"

# Run example app
cd ../examples/06_ytext
pnpm dev
# Visit http://localhost:5174 and try typing
```

## Key Learnings

1. **Valtio computed properties DO work** - proven by `valtio-computed-test.spec.tsx`
2. **Symbol properties for version don't create dependencies** - must use string properties
3. **Define getters on the proxy object, not the base object** - matches working test pattern
4. **Double observer registration was a real issue** - fixed and verified
5. **Version counter increments correctly** - but doesn't trigger re-renders when done from observer

The implementation is very close to working. The pattern is correct, but there's something subtle about the execution context or timing when the Y.js observer fires that prevents Valtio from triggering re-renders.
