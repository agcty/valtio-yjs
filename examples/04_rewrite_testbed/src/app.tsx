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

// When doc1 changes, apply the update to doc2
doc1.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin === RELAY_ORIGIN) return;
  doc2.transact(() => {
    Y.applyUpdate(doc2, update);
  }, RELAY_ORIGIN);
  console.log("Relay Doc1 -> Doc2 (bytes:", update.byteLength, ")");
});
// When doc2 changes, apply the update to doc1
doc2.on("update", (update: Uint8Array, origin: unknown) => {
  if (origin === RELAY_ORIGIN) return;
  doc1.transact(() => {
    Y.applyUpdate(doc1, update);
  }, RELAY_ORIGIN);
  console.log("Relay Doc2 -> Doc1 (bytes:", update.byteLength, ")");
});

// --- 3. CREATE TWO INDEPENDENT PROXIES ---
// Let's test a Map-based root state
const {
  proxy: proxy1,
  dispose: dispose1,
  bootstrap: bootstrap1,
} = createYjsProxy<{
  message: string;
  items: { [id: string]: { id: number; text: string } };
}>(doc1, {
  getRoot: (doc: Y.Doc) => doc.getMap("sharedState"),
});

const { proxy: proxy2, dispose: dispose2 } = createYjsProxy<{
  message: string;
  items: { [id: string]: { id: number; text: string } };
}>(doc2, {
  getRoot: (doc: Y.Doc) => doc.getMap("sharedState"),
  // No initialState here, it should sync from doc1
});

bootstrap1({
  message: "Hello World3",
  items: {
    1: { id: 1, text: "Item 1" },
  },
});

// --- 4. CREATE A REUSABLE CLIENT COMPONENT ---
const ClientView = ({
  name,
  stateProxy,
}: {
  name: string;
  stateProxy: typeof proxy1;
}) => {
  const snap = useSnapshot(stateProxy, { sync: true });
  const proxyRef = useRef(stateProxy);
  const [editingId, setEditingId] = useState<number | null>(null);
  useEffect(() => {
    // Dynamically import to avoid bundling the subscribe in examples; valtio is already a dep here though.
    import("valtio/vanilla").then(({ subscribe }) => {
      const unsub = subscribe(proxyRef.current as any, (ops: any[]) => {
        try {
          console.log(`[${name}] valtio ops`, ops);
        } catch {
          /* noop */
        }
      });
      return () => unsub();
    });
  }, [name]);

  const addItem = () => {
    const id = Date.now();
    proxyRef.current.items[id] = {
      id,
      text: `Item from ${name}`,
    };
    setEditingId(id);
  };

  const deleteLastItem = () => {
    const keys = Object.keys(snap.items);
    if (keys.length > 0) {
      const lastKey = keys.pop();
      if (lastKey) {
        delete proxyRef.current.items[lastKey];
      }
    }
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
        <ClientView name="Client 1" stateProxy={proxy1} />
        <ClientView name="Client 2" stateProxy={proxy2} />
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
