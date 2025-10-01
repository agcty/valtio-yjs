import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createRelayedProxiesMapRoot, waitMicrotask } from "../helpers/test-helpers";

describe("Debug: XML reconciliation", () => {
  it("checks if proxyA points to the actual fragment in the Y.Map after write", async () => {
    const { proxyA, docA } = createRelayedProxiesMapRoot();

    const fragment = new Y.XmlFragment();
    const el1 = new Y.XmlElement("div");
    fragment.insert(0, [el1]);

    console.log("1. Before assignment:");
    console.log("   fragment.doc:", fragment.doc);
    console.log("   fragment.parent:", fragment.parent);

    // Assign fragment
    proxyA.fragment = fragment;
    
    console.log("2. Immediately after assignment (before microtask):");
    console.log("   fragment.doc:", fragment.doc);
    console.log("   fragment.parent:", fragment.parent);
    console.log("   proxyA.fragment === fragment?", proxyA.fragment === fragment);

    // Wait for write scheduler to flush
    await waitMicrotask();

    console.log("3. After microtask (write should be flushed):");
    console.log("   fragment.doc:", fragment.doc);
    console.log("   fragment.parent:", fragment.parent);
    
    const mapA = docA.getMap("root");
    const fragmentInMap = mapA.get("fragment");
    console.log("   fragmentInMap:", fragmentInMap);
    console.log("   fragmentInMap === fragment?", fragmentInMap === fragment);
    console.log("   proxyA.fragment === fragment?", proxyA.fragment === fragment);
    console.log("   proxyA.fragment === fragmentInMap?", proxyA.fragment === fragmentInMap);
    
    // The key insight: proxyA.fragment should point to fragmentInMap, not the original fragment
    // After the write flushes, Y.js integrates the fragment and it becomes part of the doc
    // So fragmentInMap might be the same instance or Y.js might have done something special
    
    console.log("4. Now delete from the fragment we get from proxy:");
    const fragmentFromProxy = proxyA.fragment;
    console.log("   fragmentFromProxy.length before:", fragmentFromProxy.length);
    fragmentFromProxy.delete(0, 1);
    
    console.log("5. After delete:");
    console.log("   fragment.length:", fragment.length);
    console.log("   fragmentInMap.length:", (fragmentInMap as Y.XmlFragment).length);
    console.log("   fragmentFromProxy.length:", fragmentFromProxy.length);
    console.log("   proxyA.fragment.length:", proxyA.fragment.length);
  });
});

