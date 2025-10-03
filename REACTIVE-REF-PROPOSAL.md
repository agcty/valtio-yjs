# Reactive Ref Proposal for Valtio

## Executive Summary

I've implemented a new `reactiveRef()` API for Valtio that solves a fundamental limitation: **how to make opaque objects (like Y.Text) trigger React re-renders without deep proxying them**.

This eliminates the need for workarounds like version counters, computed properties, and reactive wrappers.

## The Problem

### Current Situation in valtio-yjs

The valtio-yjs library needs to integrate Y.js CRDT types (Y.Text, Y.XmlElement, etc.) with Valtio. These types:

1. **Cannot be deep proxied** - They have internal state and native methods that would break if proxied
2. **Need to trigger re-renders** - When their content changes, React components should update
3. **Have their own observers** - Y.js provides `observe()` for change notifications

### Current Workaround

The library currently uses a complex pattern:

```typescript
// 1. Store Y.Text in a symbol property wrapped in ref()
const storageKey = Symbol.for(`valtio-yjs:leaf:${key}`)
objProxy[storageKey] = ref(yText)

// 2. Create a manual version counter (string property)
objProxy['__valtio_yjs_version'] = 0

// 3. Create a reactive proxy wrapper around Y.Text
const reactiveWrapper = new Proxy(yText, {
  get(target, prop) {
    void objProxy['__valtio_yjs_version'] // Touch on EVERY access
    return target[prop]
  }
})

// 4. Define a computed property
Object.defineProperty(objProxy, key, {
  get() {
    return this[storageKey]
  }
})

// 5. Set up Y.js observer to increment version
yText.observe(() => {
  objProxy['__valtio_yjs_version']++
})
```

**Problems with this approach:**
- Complex and fragile
- Multiple layers of indirection
- Pollutes object namespace with string properties
- Reactive wrapper needs to touch version on every access
- Different handling for maps vs arrays
- Hard to understand and maintain

## The Solution: Reactive Refs

A `reactiveRef()` is like `ref()` but participates in Valtio's dependency tracking:

```typescript
import { proxy, reactiveRef, notifyReactiveRef } from 'valtio'
import * as Y from 'yjs'

const yText = new Y.Text()
const state = proxy({
  text: reactiveRef(yText), // ✨ That's it!
})

// Set up observer (one time)
yText.observe(() => {
  notifyReactiveRef(state.text)
})

// In React
function Editor() {
  const snap = useSnapshot(state)
  return <div>{snap.text.toString()}</div> // Re-renders when Y.Text changes!
}
```

## Implementation

### Core Mechanism

1. **ReactiveRef State** - WeakMap storing version and notification callback:
   ```typescript
   interface ReactiveRefState {
     version: number
     notifyUpdate: ((op: Op) => void) | null
     target: object
   }
   ```

2. **Version Tracking** - Each reactive ref has an internal version counter

3. **Snapshot Integration** - When creating snapshots, include the version in a hidden property:
   ```typescript
   if (isReactiveRef(value)) {
     const reactiveRefVersion = getReactiveRefVersion(value)
     desc.value = Object.assign(Object.create(Object.getPrototypeOf(value)), {
       ...value,
       __v: reactiveRefVersion, // Hidden version for change detection
     })
   }
   ```

4. **Notification Propagation** - When `notifyReactiveRef()` is called:
   - Increment the reactive ref's version
   - Call the parent proxy's `notifyUpdate()` with a 'set' operation
   - proxy-compare sees the version change in snapshots → triggers re-render

### Files Modified

1. **`valtio/src/vanilla/reactiveRef.ts`** (NEW)
   - Core reactive ref implementation
   - Exports: `reactiveRef()`, `notifyReactiveRef()`, `isReactiveRef()`

2. **`valtio/src/vanilla.ts`** (MODIFIED)
   - Import reactive ref utilities
   - Modify `createSnapshotDefault()` to handle reactive refs
   - Modify `addPropListener()` to set up notification callbacks
   - Modify `removePropListener()` to clean up callbacks
   - Export reactive ref API

## Benefits

### 1. **Simplicity**
```typescript
// Before (10+ lines)
const storageKey = Symbol.for(`valtio-yjs:leaf:${key}`)
objProxy[storageKey] = ref(yText)
objProxy['__valtio_yjs_version'] = 0
const reactiveWrapper = new Proxy(yText, { /* ... */ })
Object.defineProperty(objProxy, key, { /* ... */ })
yText.observe(() => { objProxy['__valtio_yjs_version']++ })

// After (2 lines)
state.text = reactiveRef(yText)
yText.observe(() => notifyReactiveRef(state.text))
```

### 2. **Clean API**
- No manual version counters
- No computed properties
- No reactive wrappers
- No symbol properties
- No string property pollution

### 3. **Architectural Soundness**
- Single responsibility: reactive refs only handle notification
- No workarounds or hacks
- Clear separation of concerns
- Integrates cleanly with Valtio's core

### 4. **Consistency**
- Works the same in maps and arrays
- Same pattern for all leaf types
- Predictable behavior

### 5. **Maintainability**
- Easy to understand
- Self-documenting code
- Fewer edge cases
- Easier to test

## Usage in valtio-yjs

### Before (Current Implementation)

**In `leaf-computed.ts`:**
```typescript
export function setupLeafNodeAsComputed(
  context: SynchronizationContext,
  objProxy: Record<string | symbol, unknown>,
  key: string,
  leafNode: YLeafType,
): void {
  // 40+ lines of complex setup...
  const reactiveLeaf = createReactiveLeafWrapper(leafNode, objProxy)
  const storageKey = Symbol.for(`valtio-yjs:leaf:${key}`)
  objProxy[storageKey] = ref(reactiveLeaf)
  Object.defineProperty(objProxy, key, { /* ... */ })
  // etc.
}
```

### After (With Reactive Refs)

**In `valtio-bridge.ts`:**
```typescript
import { reactiveRef, notifyReactiveRef } from 'valtio/vanilla'

function processYMapEntries(context, yMap, doc) {
  const initialObj = {}
  
  for (const [key, value] of yMap.entries()) {
    if (isYLeafType(value)) {
      // Simple: just wrap in reactiveRef
      initialObj[key] = reactiveRef(value)
      
      // Set up observer
      value.observe(() => {
        const proxy = getValtioProxyForYType(context, yMap)
        if (proxy) {
          notifyReactiveRef(proxy[key])
        }
      })
    } else if (isYSharedContainer(value)) {
      initialObj[key] = getOrCreateValtioProxy(context, value, doc)
    } else {
      initialObj[key] = value
    }
  }
  
  return initialObj
}
```

**Files that can be removed:**
- `valtio-yjs/src/bridge/leaf-computed.ts` (~165 lines)
- `valtio-yjs/src/bridge/leaf-wrapper.ts` (if exists)
- `valtio-yjs/src/bridge/leaf-reactivity.ts` (if exists)

## Testing

Comprehensive tests in `valtio/tests/reactiveRef.test.ts`:

1. ✅ Prevents deep proxying
2. ✅ Triggers re-renders when notified
3. ✅ Works with Y.Text-like objects
4. ✅ Cleans up when properties are removed
5. ✅ Handles multiple reactive refs
6. ✅ Works in nested proxies

## Migration Path for valtio-yjs

1. **Phase 1: Add reactive ref support** (Done in Valtio core)
2. **Phase 2: Update valtio-yjs to use reactive refs**
   - Update `valtio-bridge.ts` to use `reactiveRef()`
   - Set up observers with `notifyReactiveRef()`
   - Remove old computed property code
3. **Phase 3: Clean up**
   - Remove `leaf-computed.ts`
   - Remove wrapper implementations
   - Update tests
   - Update documentation

## Comparison: Architecturally Sound or Work-Around-y?

### Current Implementation (Computed Properties + Wrappers): **6/10**
- ⚠️ Multiple layers of indirection
- ⚠️ String properties pollute namespace
- ⚠️ Reactive wrappers feel hacky
- ⚠️ Different handling for maps vs arrays
- ✅ Works correctly
- ✅ Well-documented workarounds

### With Reactive Refs: **9/10**
- ✅ Clean, single-purpose abstraction
- ✅ Integrates naturally with Valtio's core
- ✅ No namespace pollution
- ✅ Consistent across all contexts
- ✅ Easy to understand and maintain
- ✅ Follows Valtio's design principles
- ⚠️ Requires explicit `notifyReactiveRef()` calls (but this is intentional design)

## Conclusion

The `reactiveRef()` implementation transforms leaf type integration from a "pragmatic workaround" into an "architecturally sound solution". It's the right abstraction at the right level, solving the core problem cleanly without fighting the framework.

This is what I initially suggested as "reactive refs" in my assessment, and implementing it reveals that it was the right approach all along.

## Next Steps

1. ✅ Implement reactive refs in Valtio core
2. ✅ Add tests
3. ✅ Add documentation
4. ⏳ Update valtio-yjs to use reactive refs
5. ⏳ Remove old workaround code
6. ⏳ Update valtio-yjs tests
7. ⏳ Update valtio-yjs documentation

## Questions?

The implementation is in:
- `valtio/src/vanilla/reactiveRef.ts` - Core implementation
- `valtio/src/vanilla.ts` - Integration with Valtio
- `valtio/tests/reactiveRef.test.ts` - Tests
- `valtio/docs/api/advanced/reactiveRef.mdx` - Documentation

