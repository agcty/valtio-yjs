# Valtio-Yjs: Known Limitations

## Status

This library integrates Yjs CRDTs with Valtio's reactive state management:

- **Y.Map, Y.Array, primitives**: ✅ Work really well with clean implementations
- **Leaf types (Y.Text, Y.Xml\*)**: ⚠️ Work with multi-layer workarounds; tests pass but potential edge cases remain

---

## What Works Well

### ✅ Solid Foundation: Containers & Primitives

These work **really well** with clean, straightforward implementations:

- **Y.Map** - Full bidirectional sync with Valtio proxy objects
- **Y.Array** - Full bidirectional sync with Valtio proxy arrays
  - Standard methods: `push()`, `pop()`, `shift()`, `unshift()`
  - Direct index assignment: `arr[i] = value`
  - Splice operations: `arr.splice(start, deleteCount, ...items)`
- **Primitives** - Strings, numbers, booleans, null
- **Nested structures** - Deep nesting of maps, arrays, and primitives
- **Network sync** - WebRTC, WebSocket providers work correctly
- **React integration** - `useSnapshot()` triggers re-renders as expected

### ⚠️ Works, But With Workarounds: Leaf Types

These **work in practice** but use multi-layer workarounds. Tests pass, but there could be edge cases we haven't discovered:

- **Y.Text** - Rich text editing with React reactivity (computed properties + version counters)
- **Y.XmlElement** - XML elements with attributes and children (22/22 tests passing)
- **Y.XmlFragment** - XML fragments as containers
- **Y.XmlHook** - Custom XML node types
- **Y.XmlText** - XML text nodes

**Current status:** The implementation works for tested scenarios, but the workaround-heavy approach means we can't be 100% confident about all edge cases.

---

## What Doesn't Work (By Design)

### ❌ Direct Array Length Manipulation

The library **intentionally does not support** direct `length` property manipulation on arrays:

```javascript
// ❌ Not supported
arr.length = 0; // Clear array
arr.length = 5; // Extend array
arr.length = 2; // Truncate array

// ✅ Use splice instead
arr.splice(0); // Clear array
arr.splice(5, 0, ...Array(5 - arr.length).fill(null)); // Extend
arr.splice(2); // Truncate array
```

**Why this limitation?**

1. **CRDT semantics**: Y.Array is a continuous sequence without native support for "holes" or sparse arrays
2. **Collaborative conflicts**: Length changes during concurrent edits create ambiguous merge scenarios
3. **JSON serialization**: Sparse arrays serialize to `null`-filled arrays anyway
4. **Clearer intent**: `splice()` makes mutations explicit and maps cleanly to Y.Array operations
5. **Implementation complexity**: Valtio generates complex operation sequences for length mutations that don't translate cleanly to CRDT operations

**Design decision**: This is a **collaborative state synchronization library**, not a general-purpose JavaScript array emulator. It supports common, collaborative-friendly patterns and explicitly rejects patterns that don't translate well to CRDTs.

### ❌ Sparse Arrays

Related to the above, sparse arrays (arrays with "holes") are not supported:

```javascript
// ❌ Don't do this
const arr = ["a", "b", "c"];
arr.length = 5; // Creates holes
arr.toString(); // "a,b,c,," - but syncing will be unreliable

// ✅ Be explicit about null values
arr.push(null, null); // ['a', 'b', 'c', null, null]
```

Sparse arrays in JavaScript are essentially a quirk of the language that don't have a natural representation in:

- JSON (they serialize to null-filled arrays)
- CRDTs (Y.Array doesn't have a concept of "empty slots")
- Collaborative editing (what does it mean to have a hole that two users fill simultaneously?)

---

## The Challenge: Leaf Types vs. Containers

### Two Fundamentally Different Y.js Type Categories

**Containers** (Y.Map, Y.Array):

- Can be deeply proxied by Valtio
- Their properties/items are the reactive data
- Changes to properties naturally trigger Valtio updates

**Leaf Types** (Y.Text, Y.XmlElement, Y.XmlHook, etc.):

- Cannot be deeply proxied - they have internal CRDT state
- They ARE the reactive data themselves
- Changes happen via methods like `.insert()`, `.delete()`, `.setAttribute()`
- Need manual notification to trigger React re-renders

### The Core Problem

When you access `snap.text.toString()` in a React component, Valtio needs to know:

1. That you accessed the `text` property (for dependency tracking)
2. When the Y.Text content changes (to trigger re-renders)

But if Y.Text is wrapped in `ref()` to prevent deep proxying, accessing it doesn't create dependencies in Valtio's snapshot system.

---

## Current Implementation: Multi-Layer Workaround

The library currently uses a combination of techniques to achieve reactivity for leaf types:

### 1. Global Valtio Customization

**File:** `valtio-yjs/src/core/valtio-yjs-integration.ts`

We customize Valtio's internal `canProxy` function to never deep-proxy Y.js types:

```typescript
unstable_replaceInternalFunction("canProxy", (defaultCanProxy) => {
  return (x: unknown): boolean => {
    if (x instanceof Y.AbstractType) {
      return false; // Never proxy Y.js types
    }
    return defaultCanProxy(x);
  };
});
```

### 2. Version Counter Pattern

We add a version counter to the parent proxy:

```typescript
objProxy["__valtio_yjs_version"] = 0; // String property (Valtio only tracks strings)

leafNode.observe(() => {
  objProxy["__valtio_yjs_version"]++; // Increment on Y.js changes
});
```

### 3. Reactive Wrapper Proxy

We wrap the Y.js leaf in a proxy that touches the version counter on every access:

```typescript
const reactiveLeaf = new Proxy(leafNode, {
  get(target, prop) {
    void objProxy["__valtio_yjs_version"]; // Touch on EVERY access
    return Reflect.get(target, prop);
  },
});
```

### 4. Computed Property

We define a getter for the property:

```typescript
Object.defineProperty(objProxy, "text", {
  get() {
    return this[Symbol.for("valtio-yjs:leaf:text")]; // Returns reactive wrapper
  },
});
```

### 5. Symbol Storage

The actual Y.js instance is stored in a symbol property:

```typescript
objProxy[Symbol.for("valtio-yjs:leaf:text")] = ref(reactiveLeaf);
```

---

## Why This Feels "Work-Around-y"

### Multiple Layers of Indirection

1. **Version counter** (`__valtio_yjs_version`) - Manual change signal
2. **Symbol storage** - Hidden storage location
3. **Reactive wrapper** - Proxy around Y.js type
4. **Computed property** - Getter to access wrapper
5. **Y.js observer** - Increments version counter

Each layer serves a purpose, but the cumulative complexity feels like we're fighting the framework rather than working with it.

### Namespace Pollution

The version counter MUST be a string property (Valtio doesn't track symbols), so we have:

- `__valtio_yjs_version` visible in the proxy object
- Symbol properties like `Symbol.for('valtio-yjs:leaf:text')` in the internal state

### Different Handling for Arrays

Arrays can't use computed properties on numeric indices, so leaf nodes in arrays have different behavior - they use a version counter on the array itself rather than per-item. This asymmetry is a code smell.

### Reactive Wrapper Overhead

The wrapper touches the version counter on **every** property access, adding a proxy layer to every method call.

---

## Possible Solution: `reactiveRef()` in Valtio

The fundamental issue is that Valtio needs a way to handle **opaque objects** - objects that:

1. Cannot be deep proxied (they have internal state)
2. Still need to trigger re-renders when they change
3. Have their own notification mechanisms (like Y.Text's `observe()`)

Happy for POCs and PRs!
