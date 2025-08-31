# Data Flow

## 1) Local Change (UI -> Yjs -> Network)

Scenario: `userProxy.profile.email = '...'` in the UI.

1. Accessing `profile` returns the `profile` controller proxy (a Valtio proxy for a `Y.Map`). This proxy is the object you use; it performs the controller behavior under the hood.
2. The Valtio subscription on the object proxy receives a top-level `set` operation for `email`.
3. The bridge's write scheduler starts `doc.transact(..., VALTIO_YJS_ORIGIN)`.
4. Call `yProfileMap.set('email', '...')` (or convert complex values using converter utilities if needed).
5. The transaction ends.
6. `doc.on('afterTransaction')` fires, but is ignored because `origin === VALTIO_YJS_ORIGIN`.
7. `doc.on('update')` may fire via the provider and propagate to peers.

Note: When assigning a plain object/array into a controller proxy, the system eagerly upgrades it to a Y type and replaces the plain value with a live controller proxy under a reconciliation lock. This keeps nested edits encapsulated within the child controller proxy and avoids parent-level routing.

## 2) Remote Change (Network -> Yjs -> UI)

Scenario: A peer inserts a new item into a shared list (a `Y.Array`).

1. The provider applies the update: `Y.applyUpdate(doc, update)`.
2. `doc.on('afterTransaction')` fires with a remote origin.
3. The synchronizer receives deep events from `yRoot.observeDeep` and identifies the relevant Y array boundary.
4. It finds the nearest materialized ancestor (often the same array) and calls `reconcileValtioArray(context, yArray, doc)` (or a delta-aware variant when available).
5. The reconciler builds new content, materializing controller proxies for any new Y children (for example, a `Y.Map` for the new list item).
6. The reconciler splices the Valtio array proxy to match the Y array (the Valtio array holds controller proxies for nested Y objects, not plain objects).
7. Valtio detects the splice; components using `useSnapshot` of that proxy re-render.

 
