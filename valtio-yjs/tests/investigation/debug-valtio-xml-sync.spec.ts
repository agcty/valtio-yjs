import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createRelayedProxiesMapRoot, waitMicrotask } from "../helpers/test-helpers";

describe("Debug: valtio-yjs XML sync", () => {
  it("traces what happens with XmlFragment deletion through valtio-yjs", async () => {
    const { proxyA, proxyB, bootstrapA, docA, docB } = createRelayedProxiesMapRoot();

    const fragment = new Y.XmlFragment();
    const el1 = new Y.XmlElement("div");
    const el2 = new Y.XmlElement("span");
    const el3 = new Y.XmlElement("p");
    fragment.insert(0, [el1, el2, el3]);

    console.log("1. Fragment created, length:", fragment.length);
    console.log("   Fragment.doc:", fragment.doc);

    proxyA.fragment = fragment;
    await waitMicrotask();

    console.log("2. After assigning to proxyA, fragment.doc:", fragment.doc);
    console.log("   Fragment.parent:", fragment.parent);
    
    const mapA = docA.getMap("root");
    const fragmentInMapA = mapA.get("fragment");
    console.log("   Fragment in mapA:", fragmentInMapA);
    console.log("   Is same instance?", fragmentInMapA === fragment);

    bootstrapA({});
    await waitMicrotask();

    console.log("3. After bootstrap:");
    const mapB = docB.getMap("root");
    const fragmentInMapB = mapB.get("fragment");
    console.log("   Fragment in mapB:", fragmentInMapB);
    console.log("   FragmentB length:", (fragmentInMapB as Y.XmlFragment).length);
    console.log("   proxyB.fragment:", proxyB.fragment);
    console.log("   proxyB.fragment length:", proxyB.fragment.length);

    expect(proxyB.fragment.length).toBe(3);

    // A deletes the middle element
    console.log("4. About to delete from proxyA.fragment");
    console.log("   proxyA.fragment:", proxyA.fragment);
    console.log("   proxyA.fragment === fragment?", proxyA.fragment === fragment);
    console.log("   proxyA.fragment === fragmentInMapA?", proxyA.fragment === fragmentInMapA);
    
    proxyA.fragment.delete(1, 1);
    await waitMicrotask();

    console.log("5. After delete:");
    console.log("   fragment.length:", fragment.length);
    console.log("   fragmentInMapA.length:", (fragmentInMapA as Y.XmlFragment).length);
    console.log("   fragmentInMapB.length:", (fragmentInMapB as Y.XmlFragment).length);
    console.log("   proxyA.fragment.length:", proxyA.fragment.length);
    console.log("   proxyB.fragment.length:", proxyB.fragment.length);

    // B sees the deletion
    expect(proxyB.fragment.length).toBe(2);
  });
});

