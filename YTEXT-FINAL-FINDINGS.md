# Y.Text Reactivity - Final Root Cause Analysis

## Summary of Findings

After extensive investigation and testing, I've identified **two separate bugs** that were masking each other:

### ✅ BUG #1: FIXED - Double Observer Registration

**What was wrong**: The reconciler was replacing wrapped leaf nodes during reconciliation, causing observers to be registered twice.

**Location**: `valtio-yjs/src/reconcile/reconciler.ts` lines 93-108

**The fix**: Modified reconciler to check if the underlying Y.js instance has changed before replacing the wrapper.

**Proof it's fixed**:

- Test `ytext-typing-sequential.spec.tsx` - "should only trigger ONE observer call per Y.Text modification" **PASSES** ✅
- Observer called exactly once per Y.Text change

### ❌ BUG #2: NOT FIXED - Leaf Wrapper Dependency Tracking

**What's wrong**: The leaf wrapper's `get` trap accesses the **proxy's** version counter, but `useSnapshot` tracks dependencies on the **snapshot**, not the proxy.

**Location**: `valtio-yjs/src/bridge/leaf-wrapper.ts` lines 64-67

```typescript
// CURRENT CODE (BROKEN):
if (LEAF_VERSION_SYMBOL in parentProxy) {
  void parentProxy[LEAF_VERSION_SYMBOL]; // ← Accessing PROXY, not snapshot!
}
```

**Why it doesn't work**:

1. Component renders with `snap = useSnapshot(proxy)`
2. Component calls `snap.text.toString()`
3. Wrapper's `get` trap accesses `parentProxy[LEAF_VERSION_SYMBOL]` (the **proxy**)
4. But `useSnapshot` only tracks accesses to the **snapshot**
5. Result: No dependency is created, so version counter changes don't trigger re-renders

**Evidence**:

- Y.Text observer fires ✅
- Valtio notifies subscribers ✅
- Version counter increments ✅
- But React components don't re-render ❌

## The Core Problem

When using `ref()` in Valtio:

- The ref'd object is NOT proxied
- Accessing properties on a ref'd object does NOT create dependencies
- The wrapper proxy we created is ref'd, so accessing it doesn't create dependencies

**The wrapper tries to create a dependency by touching `parentProxy[LEAF_VERSION_SYMBOL]`**, but this doesn't work because:

1. In the wrapper's `get` trap, `parentProxy` is the original proxy object
2. During rendering, the component has a `snapshot` object
3. Dependencies are only tracked on the `snapshot`, not on the `proxy`
4. So touching `proxy[LEAF_VERSION_SYMBOL]` doesn't create a dependency in the snapshot

## Possible Solutions

### Option 1: Don't use a wrapper - use computed properties

Instead of wrapping Y.Text, make leaf nodes **computed properties** that touch the version counter:

```typescript
Object.defineProperty(objProxy, key, {
  get() {
    // Touch version counter to create dependency
    void this[LEAF_VERSION_SYMBOL];
    return yTextInstance;
  },
  enumerable: true,
  configurable: true,
});
```

### Option 2: Make version counter a reactive nested proxy

Instead of a symbol property, use a nested proxy object:

```typescript
objProxy.__valtio_reactivity = proxy({ version: 0 });

// In leaf-reactivity setup:
leafNode.observe(() => {
  objProxy.__valtio_reactivity.version++;
});

// In wrapper:
get(target, prop) {
  // Create dependency on nested proxy
  void parentProxy.__valtio_reactivity.version;
  return Reflect.get(target, prop);
}
```

### Option 3: Abandon the wrapper approach

Store the Y.Text directly without wrapping, and increment a separate reactive property:

```typescript
objProxy.text = ref(yText); // Don't wrap
objProxy._textVersion = 0; // Separate tracked property

// In component:
const snap = useSnapshot(proxy);
void snap._textVersion; // Create dependency
return snap.text.toString(); // Access the ref'd Y.Text
```

## Next Steps

The developer who picks this up needs to:

1. **Choose a solution approach** (I recommend Option 1 - computed properties)
2. **Implement the fix** in leaf-wrapper.ts or valtio-bridge.ts
3. **Test with these existing tests**:
   - `ytext-typing-sequential.spec.tsx`
   - `ytext-rerender-diagnostic.spec.tsx`
   - `ytext-snapshot-tracking.spec.tsx`
4. **Verify the fix works** by running the example app at `examples/06_ytext`

## Test Results

All diagnostic tests are ready and will pass once Bug #2 is fixed:

- ✅ Observer registration (single observer per change)
- ✅ Valtio notifications work
- ✅ Version counter increments
- ❌ React re-renders (waiting for fix)

The infrastructure is solid - just need to fix the dependency tracking mechanism.
