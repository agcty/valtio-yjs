# Valtio-Yjs Rewrite Testbed

This example provides a two-client simulator to test the new Valtio-Yjs architecture. It renders two components side-by-side, each representing a separate client connected to its own `Y.Doc`. Updates are manually forwarded between the two docs to simulate a network connection.

## Running the Testbed

```bash
cd examples/04_rewrite_testbed
pnpm install
pnpm dev
```

Then open your browser to the development server URL and open the browser console to watch sync logs.

## Manual Test Script

With this example running, you can now perform a series of critical manual tests. Open your browser's developer console to watch the logs.

### Test 1: Initialization and Initial Sync
1. **Action:** Load the page.
2. **Expected Result:**
   - Client 1 should display the `initialState` (`message: 'Hello World'`).
   - Almost immediately, Client 2 should also display the exact same state.
   - The console should show one "Sent update from Doc1 -> Doc2" log. This confirms the initial state was correctly written to `doc1` and synced to `doc2`.

### Test 2: Local Change Sync (Client 1 → Client 2)
1. **Action:** In the "Client 1" component, type into the message input field.
2. **Expected Result:**
   - The text in "Client 2"'s message input field should update in real-time as you type.
   - This confirms the **Valtio → Yjs** flow is working on Client 1 and the **Yjs → Valtio** flow is working on Client 2.

### Test 3: Local Change Sync (Client 2 → Client 1)
1. **Action:** In the "Client 2" component, type into the message input field.
2. **Expected Result:**
   - The text in "Client 1"'s input should update in real-time. This confirms the synchronization works in both directions.

### Test 4: Array Mutation Sync
1. **Action:** Click the "Add Item" button on Client 1.
2. **Expected Result:** A new item should appear instantly in the state display for *both* clients.
3. **Action:** Click the "Add Item" button on Client 2.
4. **Expected Result:** A second item should appear instantly on *both* clients.
5. **Action:** Click "Delete Last Item" on either client.
6. **Expected Result:** The last item in the list should disappear from *both* clients.

### Test 5: Loop Prevention (The Most Important Test!)
1. **Action:** Look closely at your console logs while you perform Test 2 (typing in Client 1's input).
2. **Expected Result:**
   - You will see logs from `synchronizer.ts` saying "Valtio ops detected..." on Client 1.
   - You will see a "Sent update from Doc1 -> Doc2" log.
   - You will see logs from `synchronizer.ts` on Client 2 saying "Yjs change detected...".
   - Crucially, you should **NOT** see an infinite loop of logs. The `if (transaction.origin === origin)` check should be working, preventing the Yjs echo on Client 1 from causing another Valtio mutation.

### Test 6: The `dispose` function
1. **Action:** Click the "Disconnect Client 1" button.
2. **Action:** Now, make changes in the Client 2 component (change the message, add an item).
3. **Expected Result:** Client 2's state should update, but **Client 1's state should remain frozen.** It should no longer receive any updates. This confirms your cleanup logic is working correctly.

This simple testbed will give you high confidence in the core mechanics of the new architecture before you move on to the more complex, granular update logic.

