# Architecture

## Core Philosophy: The "Live Controller" Model

- The Valtio proxy is not a snapshot. It is a live, stateful controller for a Yjs shared type.
- The proxy tree mirrors the Yjs structure and issues Yjs commands directly on mutation.
- This removes the impedance mismatch between Yjs's operational model and snapshot-based reactivity.

## System Layers

```text
Public API          Controller Layer            Synchronization Layer        Type Conversion
(createYjsProxy) -> (createYjsController)  ->  (setupSyncListener)       ->  (converter utils)
                      |                           |
                      v                           v
                 Valtio proxies  <-------------- Yjs afterTransaction
```

- Public API Layer: `createYjsProxy(doc, { getRoot })` creates the root controller, sets up sync, and returns `{ proxy, dispose, bootstrap }`.
- Controller Layer: A tree of Valtio proxies mirrors `Y.Map`/`Y.Array`. Local mutations are translated to minimal Yjs ops within `doc.transact` tagged by `VALTIO_YJS_ORIGIN`.
- Synchronization Layer: A single doc-level listener (`afterTransaction`) inspects `transaction.changedParentTypes` and triggers reconciliation for affected containers.
- Type Conversion Layer: Pure utilities convert plain JS data to Yjs types and vice versa.

## Key Components and Their Roles

- `SynchronizationContext` (`valtio-yjs/src/context.ts`):
  - Encapsulates all per-instance state: caches (`yTypeToValtioProxy`, `valtioProxyToYType`), subscription disposers, and a reconciliation lock (`isReconciling`).
  - Prevents global state leakage; supports multiple independent instances.

- `createYjsController` (router) (`valtio-yjs/src/controller.ts`):
  - Accepts any `Y.AbstractType` and returns the appropriate controller proxy.
  - Currently supports `Y.Map` and `Y.Array`; future types can be added.

- Controller proxies (Map/Array controllers):
  - Map controller returns a Valtio proxy that acts as a live controller for the underlying `Y.Map`.
  - Array controller returns a Valtio proxy that acts as a live controller for the underlying `Y.Array`.
  - Responsibilities:
    1) Intercept local edits via Valtio subscriptions and translate top-level changes to minimal Yjs ops inside `doc.transact(…, VALTIO_YJS_ORIGIN)`.
    2) Lazily materialize nested controllers when encountering nested Y types via `createYjsController`.
    3) Eagerly upgrade assigned plain objects/arrays into controller-backed Y types on write, replacing the plain value in the Valtio proxy under a reconciliation lock. This ensures nested edits are always handled by the child controller and preserves encapsulation (no parent-level nested routing).

- Synchronizer (`setupSyncListener`) (`valtio-yjs/src/synchronizer.ts`):
  - Listens to `doc.on('afterTransaction')`.
  - Skips transactions with our origin to avoid feedback loops.
  - Uses `transaction.changedParentTypes` to identify affected parent containers and triggers the reconciler for each, walking up to the nearest materialized ancestor as needed.

- Reconciler (`reconcileValtioMap`, `reconcileValtioArray`) (`valtio-yjs/src/reconciler.ts`):
  - Ensures the Valtio proxy structure matches the Yjs structure, creating missing keys/items and controllers for nested Y types, deleting extras, and updating primitive values.
  - Solves lazy materialization for remote changes: newly created Y objects become visible in Valtio proxies on demand.

## Public API Overview

- `createYjsProxy(doc, { getRoot })`:
  - Returns `{ proxy, dispose, bootstrap }`.
  - `bootstrap(data)` initializes an empty Y document from plain data using converter utilities, then locally reconciles to materialize proxies.
  - Why separate `bootstrap`: supports asynchronous data loading and explicit control over when initial content is written to the Y document (e.g., wait for remote data or user input before initializing).
  - `dispose()` removes listeners and disposes subscriptions held in `SynchronizationContext`.
