# Architecture

## Core Philosophy: The "Live Controller" Model

- The Valtio proxy is not a snapshot. It is a live, stateful controller for a Yjs shared type.
- The proxy tree mirrors the Yjs structure and issues Yjs commands directly on mutation.
- This removes the impedance mismatch between Yjs's operational model and snapshot-based reactivity.

## System Layers

```text
Public API          Controller Layer              Synchronization Layer        Type Conversion
(createYjsProxy) -> (createYjsController)    ->   (setupSyncListener)      ->  (converter utils)
                      |                             |
                      v                             v
                 Valtio proxies  <--------------  Yjs observeDeep(yRoot)
                              ^
                              |
                     Context Write Scheduler (one transaction per microtask)
```

- Public API Layer: `createYjsProxy(doc, { getRoot })` creates the root controller, binds a context to the `Y.Doc`, sets up sync, and returns `{ proxy, dispose, bootstrap }`.
- Controller Layer: A tree of Valtio proxies mirrors `Y.Map`/`Y.Array`. Local mutations enqueue direct-child ops into the Context Write Scheduler; the scheduler flushes them in one `doc.transact(…, VALTIO_YJS_ORIGIN)` per microtask.
- Synchronization Layer: A root-scoped deep observer (`yRoot.observeDeep`) handles inbound updates. It ignores library-origin transactions and reconciles the nearest materialized ancestor for each event.
- Type Conversion Layer: Pure utilities convert plain JS data to Yjs types and vice versa.

## Key Components and Their Roles

- `SynchronizationContext` (`valtio-yjs/src/context.ts`):
  - Encapsulates all per-instance state: caches (`yTypeToValtioProxy`, `valtioProxyToYType`), subscription disposers, and a reconciliation lock (`isReconciling`).
  - Central Write Scheduler: coalesces direct-child ops from all controllers, flushes once per microtask, applies deterministic map/array writes in a single transaction, then performs eager upgrades under the lock.
  - Prevents global state leakage; supports multiple independent instances.

- `createYjsController` (router) (`valtio-yjs/src/controller.ts`):
  - Accepts any `Y.AbstractType` and returns the appropriate controller proxy.
  - Currently supports `Y.Map` and `Y.Array`; future types can be added.

- Controller proxies (Map/Array controllers):
  - Materialize Valtio proxies for `Y.Map`/`Y.Array` and maintain identity via context caches.
  - Responsibilities:
    1) Intercept local edits and enqueue only direct-child ops into the Context Write Scheduler (no deep routing).
    2) Lazily materialize nested controllers via `createYjsController` when reading Y types.
    3) Eagerly upgrade assigned plain objects/arrays: on write, convert to Y types and, after the scheduler’s transaction, replace the plain value with a live controller under the reconciliation lock.

- Synchronizer (`setupSyncListener`) (`valtio-yjs/src/synchronizer.ts`):
  - Listens via `yRoot.observeDeep`.
  - Skips transactions with our origin to avoid feedback loops.
  - For each event, walks `.parent` to find the nearest materialized ancestor and reconciles that container exactly once per tick.

- Reconciler (`reconcileValtioMap`, `reconcileValtioArray`) (`valtio-yjs/src/reconciler.ts`):
  - Ensures the Valtio proxy structure matches the Yjs structure, creating missing keys/items and controllers for nested Y types, deleting extras, and updating primitive values.
  - Solves lazy materialization for remote changes: newly created Y objects become visible in Valtio proxies on demand.

## Public API Overview

- `createYjsProxy(doc, { getRoot })`:
  - Returns `{ proxy, dispose, bootstrap }`.
  - `bootstrap(data)` initializes an empty Y document from plain data using converter utilities, then locally reconciles to materialize proxies.
  - Why separate `bootstrap`: supports asynchronous data loading and explicit control over when initial content is written to the Y document (e.g., wait for remote data or user input before initializing).
  - `dispose()` removes listeners and disposes subscriptions held in `SynchronizationContext`.
