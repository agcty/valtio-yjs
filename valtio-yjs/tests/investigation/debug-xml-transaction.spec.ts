import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createRelayedProxiesMapRoot, waitMicrotask } from "../helpers/test-helpers";

describe("Debug: XML transaction tracking", () => {
  it("tracks Y.js transactions when XmlFragment is modified", async () => {
    const { proxyA, proxyB, bootstrapA, docA, docB } = createRelayedProxiesMapRoot();

    // Track updates on both docs
    const docAUpdates: any[] = [];
    const docBUpdates: any[] = [];
    
    docA.on("update", (update, origin) => {
      docAUpdates.push({ type: "update", origin: origin?.toString?.() || origin });
    });
    
    docB.on("update", (update, origin) => {
      docBUpdates.push({ type: "update", origin: origin?.toString?.() || origin });
    });

    const fragment = new Y.XmlFragment();
    const el1 = new Y.XmlElement("div");
    const el2 = new Y.XmlElement("span");
    const el3 = new Y.XmlElement("p");
    fragment.insert(0, [el1, el2, el3]);

    console.log("1. Initial state - no updates yet");
    console.log("   docA updates:", docAUpdates.length);
    console.log("   docB updates:", docBUpdates.length);

    proxyA.fragment = fragment;
    await waitMicrotask();

    console.log("2. After assigning fragment:");
    console.log("   docA updates:", docAUpdates.length, docAUpdates.map(u => u.origin));
    console.log("   docB updates:", docBUpdates.length, docBUpdates.map(u => u.origin));

    bootstrapA({});
    await waitMicrotask();

    console.log("3. After bootstrap:");
    console.log("   docA updates:", docAUpdates.length);
    console.log("   docB updates:", docBUpdates.length);

    const mapB = docB.getMap("root");
    const fragmentB = mapB.get("fragment") as Y.XmlFragment;
    console.log("   fragmentB.length:", fragmentB.length);

    // Clear updates
    docAUpdates.length = 0;
    docBUpdates.length = 0;

    console.log("4. About to delete - clearing update counters");

    // Delete via proxyA.fragment
    console.log("5. Calling proxyA.fragment.delete(1, 1)");
    proxyA.fragment.delete(1, 1);
    
    console.log("6. Immediately after delete (sync):");
    console.log("   docA updates:", docAUpdates.length, docAUpdates.map(u => u.origin));
    console.log("   docB updates:", docBUpdates.length, docBUpdates.map(u => u.origin));
    console.log("   proxyA.fragment.length:", proxyA.fragment.length);
    console.log("   fragmentB.length:", fragmentB.length);

    await waitMicrotask();

    console.log("7. After microtask:");
    console.log("   docA updates:", docAUpdates.length);
    console.log("   docB updates:", docBUpdates.length);
    console.log("   proxyA.fragment.length:", proxyA.fragment.length);
    console.log("   fragmentB.length:", fragmentB.length);
    console.log("   proxyB.fragment.length:", proxyB.fragment.length);
  });
});

