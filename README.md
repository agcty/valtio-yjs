# valtio-yjs 💊🚀

[![CI](https://img.shields.io/github/actions/workflow/status/valtiojs/valtio-yjs/ci.yml?branch=main)](https://github.com/valtiojs/valtio-yjs/actions?query=workflow%3ACI)
[![npm](https://img.shields.io/npm/v/valtio-yjs)](https://www.npmjs.com/package/valtio-yjs)
[![size](https://img.shields.io/bundlephobia/minzip/valtio-yjs)](https://bundlephobia.com/result?p=valtio-yjs)
[![discord](https://img.shields.io/discord/627656437971288081)](https://discord.gg/MrQdmzd)

valtio-yjs makes yjs state easy

## What is this

[valtio](https://github.com/pmndrs/valtio) is
a proxy state library for ReactJS and VanillaJS.
[yjs](https://github.com/yjs/yjs) is
an implementation of CRDT algorithm
(which allows to merge client data without server coordination).

valtio-yjs is a two-way binding to bridge them.

## Project status

It started as an experiment, and the experiment is finished.
Now, it's in alpha.
We encourage developers to try it in non-trivial apps, and find bugs.

## Install

```bash
yarn add valtio-yjs valtio yjs
```

## How to use it

```js
import * as Y from "yjs";
import { createYjsProxy } from "valtio-yjs";

// create a new Y doc
const ydoc = new Y.Doc();

// create a synchronized proxy
const { proxy: state, dispose, bootstrap } = createYjsProxy(ydoc, {
  getRoot: (doc) => doc.getMap("mymap"),
});

// optionally bootstrap with initial data (only works on empty docs)
bootstrap({});

// now you can mutate the state
state.text = "hello";

// you can nest objects
state.obj = { count: 0 };

// and mutate the nested object value
++state.obj.count;

// you can use arrays too
state.arr = [1, 2, 3];

// mutating the array is also possible
state.arr.push(4);

// dispose when you're done to clean up listeners
dispose();
```

## What's Supported

### Data Types

- ✅ **Objects** (Y.Map → Valtio proxy)
- ✅ **Arrays** (Y.Array → Valtio proxy)
- ✅ **Collaborative text** (Y.Text & Y.XmlText) - [See below](#collaborative-text-ytext)
- ✅ **Primitives** (string, number, boolean, null)
- ✅ **Deep nesting** (arbitrary depth)

### Array Operations

All standard JavaScript array operations are fully supported:

- ✅ **push**, **pop**, **unshift**, **shift**
- ✅ **splice** (insert, delete, replace)
- ✅ **Direct index assignment**: `arr[i] = value`
- ✅ **Element deletion**: `delete arr[i]` (automatically removes element, no sparse arrays)
- ✅ **Array reordering/moves**: `arr.splice(from, 1); arr.splice(to, 0, item)`

```js
// Array moves work naturally
const [item] = state.arr.splice(2, 1); // Remove from index 2
state.arr.splice(0, 0, item); // Insert at index 0
// ✅ Item successfully moved!
```

### Object Operations

- ✅ **Set properties**: `obj.key = value`
- ✅ **Delete properties**: `delete obj.key`
- ✅ **Nested updates**: `obj.nested.deep.value = x`
- ✅ **Object replacement**: `obj.nested = { ...newObj }`

### Collaboration Features

- ✅ **Multi-client sync** (via Yjs providers)
- ✅ **Conflict-free merging** (CRDT guarantees)
- ✅ **Offline-first** (local-first architecture)
- ✅ **Undo/Redo** (via Yjs UndoManager)

## Collaborative Text (Y.Text)

valtio-yjs provides **automatic reactivity** for Y.Text and Y.XmlText with zero configuration needed.

### Usage - It Just Works! ✨

```js
import { createYjsProxy, syncedText } from "valtio-yjs";
import { useSnapshot } from "valtio/react";

const { proxy } = createYjsProxy(doc, {
  getRoot: (d) => d.getMap("root"),
});

// Create collaborative text
proxy.document = syncedText("Hello World");

// In React - automatically reactive! No hooks needed
function Editor() {
  const snap = useSnapshot(proxy);

  return (
    <div>
      <p>{snap.document.toString()}</p>
      <button onClick={() => proxy.document.insert(11, "!")}>Add !</button>
    </div>
  );
}
```

**That's it!** The component automatically re-renders when the text changes, whether from local edits or remote collaborators.

### Supported Leaf Types

- ✅ **Y.Text** - Collaborative rich text CRDT
- ✅ **Y.XmlText** - XML-specific text (automatically supported)

### When to Use Y.Text vs Plain Strings

**Use plain strings** (95% of cases):

```js
state.title = "My Document"; // ✅ Syncs perfectly
state.author = "Alice"; // ✅ Simple and efficient
```

**Use Y.Text** only when you need:

1. **Rich text editing** with formatting (bold, italic, colors)
2. **Large documents** with efficient delta syncing
3. **Collaborative text** where multiple users edit simultaneously
4. **Text with embedded content** (images, mentions, etc.)

```js
// Y.Text for collaborative rich text editor
const content = syncedText("Hello");
content.format(0, 5, { bold: true }); // Needs Y.Text for formatting
state.documentBody = content;
```

### Arrays and Nested Structures

Y.Text works seamlessly in arrays and nested objects:

```js
// Multiple text fields
proxy.article = {
  title: syncedText("My Article"),
  subtitle: syncedText("A subtitle"),
  body: syncedText("Content here"),
};

// In React - all automatically reactive!
function Article() {
  const snap = useSnapshot(proxy);

  return (
    <div>
      <h1>{snap.article.title.toString()}</h1>
      <h2>{snap.article.subtitle.toString()}</h2>
      <p>{snap.article.body.toString()}</p>
    </div>
  );
}

// Text in arrays
proxy.paragraphs = [
  syncedText("First paragraph"),
  syncedText("Second paragraph"),
];
```

### How It Works (Technical)

**The Challenge**: Y.Text has internal CRDT state that can't be deeply proxied without interfering with its merge algorithm.

**Our Solution**:

1. **Wrap with `ref()`** - Prevents Valtio from deep-proxying Y.Text internals
2. **Observe Y.js events** - Listen to Y.Text's native `observe()` for content changes
3. **Trigger Valtio updates** - Re-assign the reference to notify Valtio's snapshot system
4. **Automatic cleanup** - Unobserve when proxy is disposed

**vs SyncedStore's Approach**:

- SyncedStore: Patches Y.Text methods (`toString()`, `toJSON()`) to trigger reactivity
- valtio-yjs: Observes Y.Text changes and uses Valtio's existing change detection
- Result: Cleaner implementation, no method patching, same automatic reactivity ✨

## Limitations

### Not Supported

- ❌ **`undefined` values** (use `null` or delete the key)
- ❌ **Non-serializable types** (functions, symbols, classes)

## Performance

### Automatic Optimizations

valtio-yjs includes several performance optimizations out of the box:

#### Microtask Batching

All mutations in the same JavaScript task are automatically batched into a single Yjs transaction:

```js
// These 100 operations become 1 network update
for (let i = 0; i < 100; i++) {
  state.obj.count++;
}
// ✅ Single transaction, single sync event
```

#### Bulk Insert Optimization

Large array operations are automatically optimized:

```js
// Optimized: 6.3x faster for unshift, efficient for push
state.items.push(...Array(1000).fill({ data: "x" }));
state.items.unshift(...newItems);

// Also optimized when done sequentially in same tick
state.items.push(item1);
state.items.push(item2);
// ... more pushes
```

**Performance gains:**

- **Bulk unshift**: 6.3x faster (53 → 336 ops/sec for 100 items)
- **Bulk push**: Efficient batching, no regression
- **Large datasets**: Handles 1000+ item operations smoothly

#### Lazy Materialization

Nested objects only create Valtio proxies when accessed:

```js
state.data = {
  users: Array(10000).fill({
    /* large objects */
  }),
};

// ✅ Proxy created instantly, users materialized on access
const firstUser = state.data.users[0]; // Materializes this user only
```

**Benefits:**

- Fast initialization of large structures
- Memory efficient for sparse data
- Scales to deep nesting (20+ levels tested)

### Performance Characteristics

| Operation                     | Performance | Notes                      |
| ----------------------------- | ----------- | -------------------------- |
| Small updates (1-10 items)    | ~1-3ms      | Typical UI interactions    |
| Bulk push/unshift (100 items) | ~3-8ms      | Optimized automatically    |
| Large arrays (1000 items)     | ~15-30ms    | Bootstrap/import scenarios |
| Deep nesting (10 levels)      | ~2-4ms      | Lazy materialization helps |
| Two-client sync               | +1-2ms      | Network latency dominates  |

### Best Practices

#### ✅ Do This

```js
// Batch related updates in same tick
state.user.name = "Alice";
state.user.age = 30;
state.user.active = true;
// ✅ Single transaction

// Use bulk operations for multiple items
state.todos.push(...newTodos);
// ✅ Optimized bulk insert

// Access nested data as needed
const user = state.users[id]; // Materializes on demand
// ✅ Efficient lazy loading
```

#### ❌ Avoid This

```js
// Don't manually batch with setTimeout/Promise
for (const item of items) {
  await doSomething(); // ❌ Creates many transactions
  state.items.push(item);
}
// Instead: prepare all items, then push in bulk

// Don't repeatedly access deep paths in loops
for (let i = 0; i < 1000; i++) {
  state.deeply.nested.array.push(i); // ❌ Repeated lookups
}
// Instead: get reference once
const arr = state.deeply.nested.array;
for (let i = 0; i < 1000; i++) {
  arr.push(i); // ✅ Efficient
}
```

### When to Optimize Further

For most applications, the built-in optimizations are sufficient. Consider additional optimization if you have:

- **Very large lists** (10,000+ items): Consider pagination or virtualization
- **High-frequency updates** (60+ updates/sec): May need throttling at app level
- **Deeply nested structures** (20+ levels): Consider flattening data model
- **Concurrent reordering**: See [Fractional Indexing](#advanced-fractional-indexing-for-list-ordering) below

## Advanced: Fractional Indexing for List Ordering

For most applications, standard array operations work great. However, if you're building a collaborative app with **high-frequency concurrent reordering** (e.g., shared task list with drag-and-drop), consider fractional indexing:

```js
// Standard approach (works for most cases)
const [task] = tasks.splice(from, 1);
tasks.splice(to, 0, task);

// Fractional indexing (for concurrent reordering)
type Task = { order: number, title: string };

// Each task has an order field
tasks[i].order = (tasks[i - 1].order + tasks[i + 1].order) / 2;

// Display sorted by order
const sorted = [...tasks].sort((a, b) => a.order - b.order);
```

**When to use fractional indexing:**

- Multiple users frequently reordering the same list
- Critical ordering where conflicts need deterministic resolution
- Large lists (>100 items) with frequent moves

**When NOT needed:**

- Single-user applications
- Small lists or infrequent reordering
- Append-only lists (chat, logs)

## Demos

Using `useSnapshot` in valtio and
`WebsocketProvider` in [y-websocket](https://github.com/yjs/y-websocket),
we can create multi-client React apps pretty easily.

- [Messages object](https://stackblitz.com/github/valtiojs/valtio-yjs/tree/main/examples/01_obj)
- [Messages array](https://stackblitz.com/github/valtiojs/valtio-yjs/tree/main/examples/02_array)
- [Minecraft + webrtc](https://stackblitz.com/github/valtiojs/valtio-yjs/tree/main/examples/03_minecraft)
