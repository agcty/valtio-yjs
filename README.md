# valtio-yjs 💊🚀

[![CI](https://img.shields.io/github/actions/workflow/status/valtiojs/valtio-yjs/ci.yml?branch=main)](https://github.com/valtiojs/valtio-yjs/actions?query=workflow%3ACI)
[![npm](https://img.shields.io/npm/v/valtio-yjs)](https://www.npmjs.com/package/valtio-yjs)
[![size](https://img.shields.io/bundlephobia/minzip/valtio-yjs)](https://bundlephobia.com/result?p=valtio-yjs)
[![discord](https://img.shields.io/discord/627656437971288081)](https://discord.gg/MrQdmzd)

**Collaborative state made easy.** Two-way sync between [Valtio](https://github.com/pmndrs/valtio) proxies and [Yjs](https://github.com/yjs/yjs) CRDTs for building multi-user apps with minimal effort.

Write normal JavaScript, get real-time collaboration for free.

```bash
npm install valtio-yjs valtio yjs
```

:warning: **Project status:** Alpha. The experiment is finished and it works well. We encourage developers to try it in non-trivial apps and report bugs.

---

## Quick Start

Create a synchronized proxy and mutate it like any normal object. Changes automatically sync across clients.

```js
import * as Y from "yjs";
import { createYjsProxy } from "valtio-yjs";

// Create a Yjs document
const ydoc = new Y.Doc();

// Create a synchronized proxy
const { proxy: state } = createYjsProxy(ydoc, {
  getRoot: (doc) => doc.getMap("mymap"),
});

// Mutate state like a normal object
state.text = "hello";
state.count = 0;

// Nested objects work too
state.user = { name: "Alice", age: 30 };
state.user.age = 31;

// Arrays work naturally
state.todos = [{ text: "Learn valtio-yjs", done: false }];
state.todos.push({ text: "Build something cool", done: false });
state.todos[0].done = true;
```

That's it! State is now synchronized via Yjs. Add a provider to sync across clients.

## Use in React

Bind your components with Valtio's `useSnapshot`. Components re-render only when their data changes.

```jsx
import { useSnapshot } from "valtio/react";

function TodoList() {
  const snap = useSnapshot(state);

  return (
    <ul>
      {snap.todos.map((todo, i) => (
        <li key={i}>
          <input
            type="checkbox"
            checked={todo.done}
            onChange={() => (state.todos[i].done = !state.todos[i].done)}
          />
          {todo.text}
        </li>
      ))}
    </ul>
  );
}

function AddTodo() {
  return (
    <button onClick={() => state.todos.push({ text: "New task", done: false })}>
      Add Todo
    </button>
  );
}
```

### Why valtio-yjs?

- **Just JavaScript** - No special APIs, write like you normally would
- **Automatic sync** - Changes propagate via Yjs CRDTs without conflicts
- **React-friendly** - Works seamlessly with Valtio's `useSnapshot`
- **Offline-first** - Local changes merge cleanly when reconnected
- **Type-safe** - Full TypeScript support out of the box

---

## Collaboration Setup

Connect multiple clients with any Yjs provider:

```js
import { WebsocketProvider } from "y-websocket";

const ydoc = new Y.Doc();
const provider = new WebsocketProvider("ws://localhost:1234", "my-room", ydoc);

const { proxy: state } = createYjsProxy(ydoc, {
  getRoot: (doc) => doc.getMap("state"),
});

// Now all clients in "my-room" share the same state!
state.message = "Hello from client 1";
```

**Supported providers:**

- [y-websocket](https://github.com/yjs/y-websocket) - WebSocket sync
- [y-webrtc](https://github.com/yjs/y-webrtc) - P2P WebRTC sync
- [y-indexeddb](https://github.com/yjs/y-indexeddb) - Offline persistence
- Any Yjs provider

---

## Recipes

### Initializing state with network sync

When using network providers, initialize state after the first sync to avoid overwriting remote data:

```js
import { WebsocketProvider } from "y-websocket";

const ydoc = new Y.Doc();
const provider = new WebsocketProvider("ws://localhost:1234", "room", ydoc);

const { proxy: state, bootstrap } = createYjsProxy(ydoc, {
  getRoot: (doc) => doc.getMap("state"),
});

// Wait for sync, then safely initialize if empty
provider.on("synced", () => {
  bootstrap({
    todos: [],
    settings: { theme: "light" },
  });
  // ✅ Only writes if document is empty
});
```

For local-first apps without network sync, direct assignment works fine:

```js
// Just assign directly
if (!state.todos) {
  state.todos = [];
}
```

### Array operations

All standard JavaScript array methods work:

```js
// Add/remove items
state.items.push(newItem);
state.items.pop();
state.items.unshift(firstItem);
state.items.shift();

// Modify by index
state.items[0] = updatedItem;
delete state.items[2]; // Removes element (no sparse arrays)

// Splice for complex operations
state.items.splice(1, 2, replacement1, replacement2);

// Moving items
const [item] = state.items.splice(2, 1); // Remove from index 2
state.items.splice(0, 0, item); // Insert at index 0
```

### Object operations

```js
// Set properties
state.user.name = "Alice";
state.settings = { theme: "dark", fontSize: 14 };

// Delete properties
delete state.user.temporaryFlag;

// Nested updates
state.data.deeply.nested.value = 42;

// Replace entire nested object
state.user.preferences = { ...newPreferences };
```

### Accessing state outside React

```js
// Read current state (non-reactive)
const currentCount = state.count;

// Mutate from anywhere
state.count++;

// In event handlers, timers, etc.
setTimeout(() => {
  state.message = "Updated from timer";
}, 1000);
```

### Collaborative text editing (Y.Text)

For rich text editors with formatting, use `Y.Text`:

```js
import { syncedText } from "valtio-yjs";

// Create collaborative text
state.document = syncedText("Hello World");

// Text operations
state.document.insert(11, "!");
state.document.delete(0, 5);
state.document.format(0, 5, { bold: true });

// In React - automatically reactive!
function Editor() {
  const snap = useSnapshot(state);

  return (
    <div>
      <p>{snap.document.toString()}</p>
      <button onClick={() => state.document.insert(0, "New text: ")}>
        Add Text
      </button>
    </div>
  );
}
```

**When to use Y.Text vs plain strings:**

- Plain strings: Perfect for titles, labels, simple fields (95% of cases)
- Y.Text: Only when you need rich text formatting, large documents with efficient deltas, or complex collaborative text editing

### Undo/Redo

Use Yjs's UndoManager:

```js
import { UndoManager } from "yjs";

const ydoc = new Y.Doc();
const { proxy: state } = createYjsProxy(ydoc, {
  getRoot: (doc) => doc.getMap("state"),
});

const undoManager = new UndoManager(ydoc.getMap("state"));

// Perform some actions
state.count = 1;
state.count = 2;

// Undo/redo
undoManager.undo(); // state.count is now 1
undoManager.redo(); // state.count is now 2
```

---

## Performance

valtio-yjs is fast out of the box with automatic optimizations:

### Automatic Batching

Multiple mutations in the same tick are automatically batched:

```js
// These 100 operations become 1 network update
for (let i = 0; i < 100; i++) {
  state.count++;
}
// ✅ Single Yjs transaction, one sync event
```

### Bulk Operations

Large array operations are optimized automatically:

```js
// Optimized: 6.3x faster for large inserts
state.items.push(...Array(1000).fill({ data: "x" }));
state.items.unshift(...newItems);
```

### Lazy Materialization

Nested objects create proxies on-demand:

```js
state.users = Array(10000).fill({ name: "User", data: {...} });
// ✅ Fast initialization, proxies created when accessed
const user = state.users[0]; // Materializes this user only
```

**Performance characteristics:**

| Operation                   | Time     | Notes                      |
| --------------------------- | -------- | -------------------------- |
| Small updates (1-10 items)  | ~1-3ms   | Typical UI interactions    |
| Bulk operations (100 items) | ~3-8ms   | Automatically optimized    |
| Large arrays (1000 items)   | ~15-30ms | Bootstrap/import scenarios |
| Deep nesting (10+ levels)   | ~2-4ms   | Lazy materialization helps |

---

## Limitations

### Not Supported

- ❌ **`undefined` values** (use `null` or delete the key)
- ❌ **Non-serializable types** (functions, symbols, class instances)

### What Works

- ✅ **Objects & Arrays** - Full support with deep nesting
- ✅ **Primitives** - string, number, boolean, null
- ✅ **Y.Text & Y.XmlText** - Collaborative text (see Recipes)
- ✅ **XML types** - Y.XmlFragment, Y.XmlElement, Y.XmlHook
- ✅ **All array methods** - push, pop, splice, etc.
- ✅ **Undo/Redo** - via Yjs UndoManager

**Implementation note:** Core types (Y.Map, Y.Array, primitives) have clean, well-tested implementations. Leaf types (Y.Text, XML) use workarounds that pass all tests but may have edge cases. See [LIMITATIONS.md](./docs/limitations.md) for technical details.

---

## Best Practices

**Do:**

- ✅ Batch related updates in the same tick (automatically optimized into one transaction)
- ✅ Use bulk array operations (`push(...items)`) for better performance
- ✅ Initialize with `bootstrap()` when using network sync providers
- ✅ Use plain strings for simple text fields (Y.Text only when you need rich formatting)
- ✅ Cache references to deeply nested objects in loops

**Don't:**

- ❌ Use `undefined` (use `null` or delete the property instead)
- ❌ Store functions or class instances (not serializable)
- ❌ Use `await` between mutations if you want them batched together
- ❌ Repeatedly access deep paths in loops (cache the reference first)

### Advanced: Concurrent List Reordering

For most apps, standard array operations work perfectly. For **high-frequency concurrent reordering** in collaborative lists (e.g., drag-and-drop task boards with multiple simultaneous users), consider fractional indexing:

```js
// Standard approach (works for most cases)
const [task] = tasks.splice(from, 1);
tasks.splice(to, 0, task);

// Fractional indexing (for heavy concurrent reordering)
type Task = { order: number, title: string };
tasks[i].order = (tasks[i - 1].order + tasks[i + 1].order) / 2;
const sorted = [...tasks].sort((a, b) => a.order - b.order);
```

**When to use:** Large lists (>100 items) with multiple users frequently reordering  
**When NOT needed:** Single-user apps, small lists, or append-only scenarios

For more details, see [architecture docs](./docs/)

---

## Examples

Try these live collaborative demos:

- **[Object sync](https://stackblitz.com/github/valtiojs/valtio-yjs/tree/main/examples/01_obj)** - Basic object synchronization
- **[Array sync](https://stackblitz.com/github/valtiojs/valtio-yjs/tree/main/examples/02_array)** - Shared arrays and lists
- **[Minecraft clone](https://stackblitz.com/github/valtiojs/valtio-yjs/tree/main/examples/03_minecraft)** - Multi-player 3D world with WebRTC
- **[Todo app](https://stackblitz.com/github/valtiojs/valtio-yjs/tree/main/examples/04_todos)** - Full-featured collaborative todo list
- **[Simple todos](https://stackblitz.com/github/valtiojs/valtio-yjs/tree/main/examples/05_todos_simple)** - Minimal todo example
- **[Y.Text editor](https://stackblitz.com/github/valtiojs/valtio-yjs/tree/main/examples/06_ytext)** - Collaborative text editing

All examples use `useSnapshot` from Valtio and work with any Yjs provider for real-time sync.

---

**Feedback and contributions welcome!** If you find bugs or have suggestions, please [open an issue](https://github.com/valtiojs/valtio-yjs/issues).

For detailed technical documentation, see:

- [Architecture](./docs/architecture.md)
- [Limitations](./docs/limitations.md)
- [Data Flow](./docs/data-flow.md)
