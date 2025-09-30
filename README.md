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
import { proxy } from "valtio";
import { bind } from "valtio-yjs";

// create a new Y doc
const ydoc = new Y.Doc();

// create a Y map
const ymap = ydoc.getMap("mymap");

// create a valtio state
const state = proxy({});

// bind them
const unbind = bind(state, ymap);

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

// unbind them by calling the result
unbind();
```

## What's Supported

### Data Types

- ✅ **Objects** (Y.Map → Valtio proxy)
- ✅ **Arrays** (Y.Array → Valtio proxy)
- ✅ **Collaborative text** (Y.Text via `syncedText()`)
- ✅ **Primitives** (string, number, boolean, null)
- ✅ **Deep nesting** (arbitrary depth)

### Array Operations

All standard JavaScript array operations are fully supported:

- ✅ **push**, **pop**, **unshift**, **shift**
- ✅ **splice** (insert, delete, replace)
- ✅ **Direct index assignment**: `arr[i] = value`
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

## Limitations

### Not Supported

- ❌ **Sparse arrays** (use `splice()` for deletions, not `delete arr[i]`)
- ❌ **`undefined` values** (use `null` or delete the key)
- ❌ **Non-serializable types** (functions, symbols, classes)

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
