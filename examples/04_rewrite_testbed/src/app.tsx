import * as Y from "yjs";
import { useSnapshot } from "valtio";
import { createYjsProxy } from "valtio-yjs";
import { useEffect, useRef, useState } from "react";

// --- 1. SETUP TWO Y.DOCS ---
const doc1 = new Y.Doc();
const doc2 = new Y.Doc();

// --- 2. SIMULATE THE NETWORK ---
// Tag relayed updates with an origin so we can ignore them on the receiving side.
const RELAY_ORIGIN = Symbol("relay-origin");

// Helper to log state of a doc's sharedState map
function logDocState(doc: Y.Doc, label: string, docName: string) {
  try {
    const map = doc.getMap("sharedState");
    // Convert Y.Map to plain object for logging
    const obj: any = {};
    for (const [k, v] of map.entries()) {
      if (v instanceof Y.Map) {
        obj[k] = Object.fromEntries((v as Y.Map<any>).entries());
      } else if (v instanceof Y.Array) {
        obj[k] = (v as Y.Array<any>).toArray();
      } else {
        obj[k] = v;
      }
    }
    console.log(`[${docName}] ${label}:`, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.log(`[${docName}] ${label}: <error reading state>`);
  }
}

// When doc1 changes, apply the update to doc2
doc1.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin === RELAY_ORIGIN) return;
  doc2.transact(() => {
    Y.applyUpdate(doc2, update);
  }, RELAY_ORIGIN);
  console.log("Relay Doc1 -> Doc2 (bytes:", update.byteLength, ")");
  logDocState(doc1, "Doc1 state after local change", "Doc1");
  logDocState(doc2, "Doc2 state after receiving update", "Doc2");
});
// When doc2 changes, apply the update to doc1
doc2.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin === RELAY_ORIGIN) return;
  doc1.transact(() => {
    Y.applyUpdate(doc1, update);
  }, RELAY_ORIGIN);
  console.log("Relay Doc2 -> Doc1 (bytes:", update.byteLength, ")");
  logDocState(doc2, "Doc2 state after local change", "Doc2");
  logDocState(doc1, "Doc1 state after receiving update", "Doc1");
});

// --- 3. CREATE TWO INDEPENDENT PROXIES ---
// Let's test a Map-based root state
const yRoot1 = doc1.getMap("sharedState");
const yRoot2 = doc2.getMap("sharedState");
const {
  proxy: proxy1,
  dispose: dispose1,
  bootstrap: bootstrap1,
} = createYjsProxy<{
  message: string;
  items: { [id: string]: { id: number; text: string } };
  list: { id: number; text: string }[];
}>(doc1, {
  getRoot: (doc: Y.Doc) => doc.getMap("sharedState"),
});

const { proxy: proxy2, dispose: dispose2 } = createYjsProxy<{
  message: string;
  items: { [id: string]: { id: number; text: string } };
  list: { id: number; text: string }[];
}>(doc2, {
  getRoot: (doc: Y.Doc) => doc.getMap("sharedState"),
  // No initialState here, it should sync from doc1
});

bootstrap1({
  message: "Hello World3",
  items: {
    1: { id: 1, text: "Item 1" },
  },
  list: [
    { id: 1, text: "Alpha" },
    { id: 2, text: "Beta" },
  ],
});

// --- 4. CREATE A REUSABLE CLIENT COMPONENT ---
const ClientView = ({
  name,
  stateProxy,
  yRoot,
}: {
  name: string;
  stateProxy: typeof proxy1;
  yRoot: Y.Map<unknown>;
}) => {
  const snap = useSnapshot(stateProxy, { sync: true });
  const proxyRef = useRef(stateProxy);
  const [editingId, setEditingId] = useState<number | null>(null);

  const logState = (label: string) => {
    try {
      console.log(`[testbed][${name}] ${label}`, JSON.stringify(proxyRef.current, null, 2));
    } catch {
      // ignore stringify errors
    }
    // Improved logs: show state after microtask (post-reconciliation) and raw Yjs root
    queueMicrotask(() => {
      try {
        console.log(`[testbed][${name}] ${label} (after microtask)`, JSON.stringify(proxyRef.current, null, 2));
      } catch {}
      try {
        console.log(`[testbed][${name}] ${label} (yRoot.toJSON)`, yRoot.toJSON());
      } catch {}
    });
  };

  const addItem = () => {
    const id = Date.now();
    proxyRef.current.items[id] = {
      id,
      text: `Item from ${name}`,
    };
    setEditingId(id);
    logState('items.add');
  };

  const deleteLastItem = () => {
    const keys = Object.keys(snap.items);
    if (keys.length > 0) {
      const lastKey = keys.pop();
      if (lastKey) {
        delete proxyRef.current.items[lastKey];
        logState(`items.delete(${lastKey})`);
      }
    }
  };

  // --- Array (Y.Array) operations ---
  const pushListItem = () => {
    const id = Date.now();
    const arr = (proxyRef.current as any).list as any[];
    arr[arr.length] = { id, text: `List item ${name}` };
    setEditingId(id);
    logState('list.push');
  };

  const replaceFirstListItem = () => {
    const arr = (proxyRef.current as any).list as any[];
    if (arr.length === 0) return;
    const id = arr[0]?.id ?? Date.now();
    arr[0] = { id, text: `Replaced by ${name}` };
    setEditingId(id);
    logState('list.replace(0)');
  };

  const deleteFirstListItem = () => {
    const arr = (proxyRef.current as any).list as any[];
    if (arr.length === 0) return;
    arr.splice(0, 1);
    logState('list.splice(0, 1)');
  };

  const insertWithGap = () => {
    // Set beyond current length to force a gap fill and an insert delta
    const arr = (proxyRef.current as any).list as any[];
    const targetIndex = arr.length + 1;
    const id = Date.now();
    arr[targetIndex] = { id, text: `Gap insert by ${name}` };
    setEditingId(id);
    logState(`list.set(${targetIndex})`);
  };

  return (
    <div
      style={{
        border: "1px solid black",
        padding: "10px",
        margin: "10px",
        width: "400px",
      }}
    >
      <h2>{name}</h2>
      <div style={{ marginBottom: "10px" }}>
        <label htmlFor={`message-${name}`}>Message: </label>
        <input
          id={`message-${name}`}
          style={{ width: "100%", padding: "4px" }}
          value={snap.message}
          onChange={(e) => {
            const newValue = e.target.value;
            proxyRef.current.message = newValue;
          }}
        />
      </div>
      <div style={{ marginBottom: "10px" }}>
        <button onClick={addItem} style={{ marginRight: "5px" }}>
          Add Item
        </button>
        <button onClick={deleteLastItem}>Delete Last Item</button>
      </div>
      <div style={{ marginBottom: "10px" }}>
        <h3>List (Array)</h3>
        <div style={{ marginBottom: "6px" }}>
          <button onClick={pushListItem} style={{ marginRight: "5px" }}>
            Push Item
          </button>
          <button onClick={replaceFirstListItem} style={{ marginRight: "5px" }}>
            Replace First
          </button>
          <button onClick={deleteFirstListItem} style={{ marginRight: "5px" }}>
            Delete First
          </button>
          <button onClick={insertWithGap}>Insert With Gap</button>
        </div>
        {Array.isArray((snap as any).list) && (snap as any).list.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {((snap as any).list as any[]).map((item: any, index: number) => (
              <li
                key={item?.id ?? index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  marginBottom: "6px",
                }}
              >
                <span style={{ width: 60, color: "#555" }}>
                  {item ? `#${item.id}` : "<null>"}
                </span>
                <input
                  style={{ flex: 1, padding: "4px" }}
                  value={item?.text ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    const arr = (proxyRef.current as any).list as any[];
                    if (arr[index]) {
                      (arr[index] as any).text = v;
                    }
                  }}
                />
                <button
                  onClick={() => {
                    const arr = (proxyRef.current as any).list as any[];
                    if (index <= 0) return;
                    const [moved] = arr.splice(index, 1);
                    arr.splice(index - 1, 0, moved);
                    logState(`list.move(${index} -> ${index - 1})`);
                  }}
                >
                  Up
                </button>
                <button
                  onClick={() => {
                    const arr = (proxyRef.current as any).list as any[];
                    if (index >= arr.length - 1) return;
                    const [moved] = arr.splice(index, 1);
                    arr.splice(index + 1, 0, moved);
                    logState(`list.move(${index} -> ${index + 1})`);
                  }}
                >
                  Down
                </button>
                <button
                  onClick={() => {
                    const arr = (proxyRef.current as any).list as any[];
                    arr.splice(index, 1);
                    logState(`list.splice(${index}, 1)`);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ color: "#666", fontSize: "12px" }}>No list items yet.</div>
        )}
      </div>
      <div style={{ marginBottom: "10px" }}>
        <h3>Items</h3>
        {Object.values(snap?.items ?? {}).length === 0 ? (
          <div style={{ color: "#666", fontSize: "12px" }}>
            No items yet. Click "Add Item".
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {Object.values(snap?.items ?? {})
              .sort((a: any, b: any) => (a as any).id - (b as any).id)
              .map((item: any) => (
                <li
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    marginBottom: "6px",
                  }}
                >
                  <span style={{ width: 60, color: "#555" }}>#{item.id}</span>
                  <input
                    style={{ flex: 1, padding: "4px" }}
                    value={item.text}
                    autoFocus={editingId === item.id}
                    onChange={(e) => {
                      const v = e.target.value;
                      const key = String(item.id);
                      if ((proxyRef.current.items as any)[key]) {
                        (proxyRef.current.items as any)[key].text = v;
                      }
                    }}
                    onBlur={() =>
                      setEditingId((prev) => (prev === item.id ? null : prev))
                    }
                  />
                  <button
                    onClick={() => {
                      const key = String(item.id);
                      delete (proxyRef.current.items as any)[key];
                      logState(`items.delete(${key})`);
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
      <h3>Current State:</h3>
      <pre
        style={{
          backgroundColor: "#f5f5f5",
          padding: "10px",
          borderRadius: "4px",
          fontSize: "12px",
          overflow: "auto",
          maxHeight: "200px",
        }}
      >
        {JSON.stringify(snap, null, 2)}
      </pre>
    </div>
  );
};

// --- 5. RENDER THE APP ---
const App = () => {
  const [client1Disconnected, setClient1Disconnected] = useState(false);
  const [client2Disconnected, setClient2Disconnected] = useState(false);

  const disconnectClient1 = () => {
    dispose1();
    setClient1Disconnected(true);
    console.log("Client 1 disconnected");
  };

  const disconnectClient2 = () => {
    dispose2();
    setClient2Disconnected(true);
    console.log("Client 2 disconnected");
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Valtio-Yjs Rewrite Testbed</h1>
      <p style={{ marginBottom: "20px", fontSize: "14px", color: "#666" }}>
        Open browser console to watch sync logs. Test the synchronization by
        making changes in either client.
      </p>

      <div style={{ marginBottom: "20px" }}>
        {!client1Disconnected && (
          <button
            onClick={disconnectClient1}
            style={{
              marginRight: "10px",
              padding: "8px 16px",
              backgroundColor: "#ff4444",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Disconnect Client 1
          </button>
        )}
        {!client2Disconnected && (
          <button
            onClick={disconnectClient2}
            style={{
              padding: "8px 16px",
              backgroundColor: "#ff4444",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Disconnect Client 2
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <ClientView name="Client 1" stateProxy={proxy1} yRoot={yRoot1} />
        <ClientView name="Client 2" stateProxy={proxy2} yRoot={yRoot2} />
      </div>

      {(client1Disconnected || client2Disconnected) && (
        <div
          style={{
            marginTop: "20px",
            padding: "10px",
            backgroundColor: "#fff3cd",
            border: "1px solid #ffeaa7",
            borderRadius: "4px",
          }}
        >
          {client1Disconnected && (
            <div>
              <strong>Client 1 Disconnected:</strong> Client 1 will no longer
              receive updates.
            </div>
          )}
          {client2Disconnected && (
            <div>
              <strong>Client 2 Disconnected:</strong> Client 2 will no longer
              receive updates.
            </div>
          )}
          <div style={{ marginTop: "5px" }}>
            Make changes in the remaining connected client to verify the
            disconnected client(s) remain frozen.
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
