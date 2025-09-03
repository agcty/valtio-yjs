## **Valtio-Yjs Library: Architectural Capabilities & Design Philosophy (Revised)**

### **1. Core Mandate: Predictability over Magic**

The primary goal of this library is to be a **correct, predictable, and robust** bridge between Valtio's reactive state management and Yjs's collaborative data structures. Our core philosophy is **predictability over magic**.

We achieve this by translating a developer's actions into unambiguous CRDT operations. When a developer's action is ambiguous, the library will prefer to **throw a clear error with guidance** rather than guess the intent, which could lead to silent data corruption or unpredictable behavior.

This library is a **transparent bridge**, not an extension of the Valtio API. It does not add new methods to Valtio proxies. Instead, it defines a clear "contract" of supported and unsupported mutation patterns, enforcing this contract through runtime checks and extensive documentation.

### **2. Supported Capabilities (The "Do's")**

This section defines the features the library **must** implement flawlessly.

#### **2.1. Atomic Operations on Maps (`Y.Map`)**

- **Capability:** All primitive property assignments and deletions on a collaborative object will be synced.
- **Implementation Details:**
  - A `set` operation in Valtio (`proxy.foo = 'bar'`) translates directly to `yMap.set('foo', 'bar')`.
  - A `delete` operation in Valtio (`delete proxy.foo`) translates directly to `yMap.delete('foo')`.
  - Yjs `YMapEvent`s will be reconciled back to the Valtio proxy.

#### **2.2. Explicit, CRDT-Safe Array Operations (`Y.Array`)**

- **Capability:** The library supports a specific subset of native Valtio array mutations that can be translated unambiguously to CRDT operations.
- **Implementation Details:** These are the **only** supported ways to mutate a collaborative array.
  - **`push(...items)`:** Translates to `yArray.insert(yArray.length, items)`.
  - **`pop()`:** Translates to `yArray.delete(yArray.length - 1, 1)`.
  - **`shift()`:** Translates to `yArray.delete(0, 1)`.
  - **`unshift(...items)`:** Translates to `yArray.insert(0, items)`.
  - **`splice(start, deleteCount?, ...items)`:** This is the **primary and recommended method for all complex mutations**. It translates directly to a `yArray.delete()` followed by a `yArray.insert()` in a single transaction. It is the designated way to **replace, insert, or remove** elements from anywhere in the array.

#### **2.3. Data Model & Type Safety**

- **Capability:** The library will manage the conversion between plain JavaScript objects/arrays and their Yjs counterparts, enforcing a JSON-compatible data model.
- **Implementation Details:**
  - The `plainObjectToYType` converter will handle the recursive creation of `Y.Map` and `Y.Array` types.
  - The library **must throw a runtime error** for unsupported data types (e.g., Functions, Symbols, class instances other than Date/RegExp).
  - Special types like `Date` will be serialized to a primitive (ISO string) for storage in Yjs.

#### **2.4. Lazy Materialization and Reconciliation**

- **Capability:** The library will efficiently manage state by only creating Valtio proxies for parts of the Yjs document tree that are active or have received updates.
- **Implementation Details:**
  - The bridge will maintain bidirectional weak maps (`yTypeToValtioProxy`, `valtioProxyToYType`) to manage proxy identity.
  - Remote changes (`observeDeep` events) will trigger reconciliation on the nearest materialized ancestor, ensuring the Valtio state tree correctly reflects the Yjs state tree. Delta-based updates (`reconcileValtioArrayWithDelta`) should be used for array changes for performance.

### **3. Unsupported Capabilities (The "Don'ts")**

This section defines the features the library **must not** implement. The responsibility for these patterns is explicitly placed on the application developer, and the library will provide clear runtime errors and documentation to guide them.

#### **3.1. No Direct Array Index Assignment (`arr[i] = ...`)**

- **Capability:** The library **must actively detect and forbid** direct index assignment on a collaborative array.
- **Why:** This action is fundamentally ambiguous in a collaborative context and is the primary source of bugs when trying to infer developer intent. To enforce correctness and predictability, we require a more explicit operation.
- **Implementation Details:** The subscription planner (`planArrayOps`) **must** identify the `delete(i)` + `set(i)` pattern within a single batch. Upon detection, it **must throw a descriptive runtime error**. The error message will be crucial for the developer experience:
  > **Error Example:** `[valtio-yjs] Direct array index assignment (arr[${i}] = ...) is not supported. This operation is ambiguous in a collaborative context. Please use splice() to perform a replace: arr.splice(${i}, 1, newValue).`

#### **3.2. No Automatic "Move" Operations**

- **Capability:** The library **must not** attempt to automatically detect or implement "move" operations.
- **Why:** The developer's intent cannot be reliably determined, and Yjs does not support re-parenting of shared types, making a true "move" impossible.
- **Implementation Details:**
  - The library will treat a `delete(i)` and `insert(j)` as two separate, atomic operations and execute them as such.
  - A `console.warn` should be issued when this pattern is detected to alert the developer that they may be performing an inefficient or unintended action.
  - Documentation must guide developers on how to implement moves correctly at the application layer (e.g., via fractional indexing).

#### **3.3. No Re-Parenting of Collaborative Objects**

- **Capability:** The library **must forbid** assigning an existing collaborative object to a new location in the state tree.
- **Why:** This violates the core principle of Yjs's tree model. The application builder must be explicit about their intent when duplicating or moving data. The library will not magically clone anything.
- **Implementation Details:** Before setting a value, the library **must** check if the value corresponds to an existing Yjs type that already has a parent (`yValue.parent`). If it does, the library **must throw a runtime error with clear guidance**:
  > **Error Example:** `[valtio-yjs] Cannot re-assign a collaborative object that is already in the document. If you intended to move or copy this object, you must explicitly create a deep clone of it at the application layer before assigning it.`

Excellent. Let's create that concise "Translator's Guide." This document will define the exact, unambiguous mappings from Valtio operations to Yjs operations. We will then assess the safety and reliability of detecting each pattern.

This is the definitive contract for your subscription planner.

---

## **Valtio-to-Yjs Operations: The Translator's Guide**

This guide defines the precise translation rules for converting batched Valtio operations into atomic Yjs CRDT operations. The primary goal is **100% deterministic translation**, eliminating ambiguity.

### **I. Map Operations (`Y.Map`)**

These are simple and have a direct 1-to-1 mapping.

| Valtio Operation (`op`)    | Yjs CRDT Operation(s)           | Detectable? | Assessment                                           |
| :------------------------- | :------------------------------ | :---------- | :--------------------------------------------------- |
| `['set', [key], newValue]` | `yMap.set(key, convertedValue)` | **Yes**     | **SAFE.** This is a direct, unambiguous translation. |
| `['delete', [key]]`        | `yMap.delete(key)`              | **Yes**     | **SAFE.** This is a direct, unambiguous translation. |

---

### **II. Array Operations (`Y.Array`)**

This is where precision is critical. The planner must analyze the _entire batch_ before acting.

#### **A. Supported & Unambiguous Translations**

| Valtio Mutation (User Action) | Resulting Valtio `ops` Pattern                                                                 | Yjs CRDT Operation(s)                                                | Detectable? | Assessment                                                                                                                                                                                                                                                                                                                         |
| :---------------------------- | :--------------------------------------------------------------------------------------------- | :------------------------------------------------------------------- | :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`arr.push(val)`**           | `['set', [oldLen], val]`                                                                       | `yArray.insert(oldLen, [val])`                                       | **Yes**     | **SAFE.** A single `set` op at the end of the array is a clear "push" intent.                                                                                                                                                                                                                                                      |
| **`arr.unshift(val)`**        | _Complex:_ `['set', [0], val]` plus sets for all shifted items (`['set', [1], oldVal0]`, etc.) | `yArray.insert(0, [val])`                                            | **Yes**     | **SAFE, but requires careful implementation.** The planner must identify the `set` at index 0 _and_ the subsequent index shifts. Optimizing this into a single `insert(0, ...)` is ideal. If too complex, a full reconciliation (`splice(0, len, ...newContent)`) on the array is a simpler, safe fallback for this specific case. |
| **`arr.pop()`**               | `['delete', [oldLen - 1]]`                                                                     | `yArray.delete(oldLen - 1, 1)`                                       | **Yes**     | **SAFE.** A single `delete` at the end of the array is a clear "pop" intent.                                                                                                                                                                                                                                                       |
| **`arr.shift()`**             | _Complex:_ `['delete', [0]]` plus sets for all shifted items (`['set', [0], oldVal1]`, etc.)   | `yArray.delete(0, 1)`                                                | **Yes**     | **SAFE, but requires careful implementation.** Similar to `unshift`, the planner must correctly identify the "shift" pattern. A full reconciliation is a safe fallback.                                                                                                                                                            |
| **`arr.splice(...)`**         | A combination of `delete` and/or `set` ops.                                                    | A sequence of `yArray.delete(...)` followed by `yArray.insert(...)`. | **Yes**     | **SAFE.** Splice is the most explicit and versatile tool. The resulting `delete` and `set` ops from Valtio provide a clear recipe for the equivalent Yjs operations. No guessing is needed.                                                                                                                                        |

#### **B. Forbidden & Ambiguous Translations**

| Valtio Mutation (User Action)                                                  | Resulting Valtio `ops` Pattern                                   | Library Action                 | Detectable?           | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| :----------------------------------------------------------------------------- | :--------------------------------------------------------------- | :----------------------------- | :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`arr[i] = val`** (Direct Assignment)                                         | **`['delete', [i]]` + `['set', [i]]` in the same batch.**        | **THROW ERROR.**               | **Yes**               | **UNSAFE TO TRANSLATE.** This pattern is the primary source of ambiguity. **The library's job is to detect this specific pattern and forbid it.** This is a hard rule. The detection is reliable because both ops occur at the same index in the same batch.                                                                                                                                                                                                       |
| **"Move"** (e.g., `const item = arr.splice(i, 1)[0]; arr.splice(j, 0, item);`) | **`['delete', [i]]` + `['set', [j]]` + potential index shifts.** | **WARN & PROCESS SEPARATELY.** | **No, not reliably.** | **UNSAFE TO TRANSLATE AS A "MOVE".** This is the key insight. The heuristic to detect a "move" is fundamentally unreliable. It can't be distinguished from a user deleting one item and adding a completely different one. **Therefore, the library must not try.** It should process the `delete` and the `set` as two independent, atomic operations. The `console.warn` is a helpful hint to the developer, not a signal for the library to alter its behavior. |
| **`delete arr[i]`**                                                            | `['delete', [i]]`                                                | `yArray.delete(i, 1)`          | **Yes**               | **SAFE, but potentially confusing.** This operation is a pure delete and can be translated safely. However, it can create "holes" if the developer doesn't also handle the index shifts, which can lead to confusion. It's safe for the library to support, but documentation should strongly recommend `splice` for clarity.                                                                                                                                      |

### **III. Final Assessment & Planner Implementation Strategy**

1.  **Safety Check:** Can we safely and reliably detect the patterns we've committed to supporting or forbidding?
    - **Maps:** Yes. Trivial.
    - **Array push/pop/splice/delete:** Yes. The Valtio ops provide a clear, unambiguous signal.
    - **Array unshift/shift:** Yes, but the resulting cascade of `set` ops makes the detection logic more complex than for other operations. A safe fallback is to trigger a full structural reconciliation of the array for this specific pattern if a simple detection is too difficult.
    - **Forbidden `arr[i] = val`:** **Yes, this is reliably detectable.** The planner must look for a `delete` and a `set` at the _exact same index_ within a single batch. This is a clear, machine-readable signal.

2.  **Implementation Flow:**
    - The planner must first analyze the **entire batch of operations**.
    - **Priority 1:** Scan for the forbidden `delete(i)` + `set(i)` pattern. If found, **stop and throw the descriptive error immediately.** This check must run before any other logic.
    - **Priority 2:** If the forbidden pattern is not found, proceed to translate the remaining supported operations (`push`, `pop`, `splice`, `delete arr[i]`, etc.) into their Yjs equivalents.
    - **Move Heuristic:** After processing, if there are remaining `delete` and `set` operations that were not part of a forbidden pattern, the library can issue a `console.warn` about a potential move, but it **must** still process them as separate atomic operations.

This translator's guide provides a clear and robust blueprint. It prioritizes safety by explicitly forbidding the most ambiguous operation, provides a safe path for all other explicit mutations, and avoids the dangerous guessing game of automatic move detection.
