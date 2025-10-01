import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createRelayedProxiesMapRoot, waitMicrotask } from "../helpers/test-helpers";

describe("Debug: what does proxy return", () => {
  it("checks what proxyA.fragment actually returns after assignment", async () => {
    const { proxyA, docA } = createRelayedProxiesMapRoot();

    const fragment = new Y.XmlFragment();
    const el1 = new Y.XmlElement("div");
    fragment.insert(0, [el1]);

    console.log("1. Before assignment:");
    console.log("   fragment.doc:", fragment.doc);

    proxyA.fragment = fragment;
    await waitMicrotask();

    const mapA = docA.getMap("root");
    const fragmentInMap = mapA.get("fragment") as Y.XmlFragment;

    console.log("2. After assignment:");
    console.log("   fragment.doc:", fragment.doc ? "has doc" : "no doc");
    console.log("   fragmentInMap.doc:", fragmentInMap.doc ? "has doc" : "no doc");
    console.log("   fragmentInMap === fragment?", fragmentInMap === fragment);

    const fragmentFromProxy = proxyA.fragment;
    console.log("3. What proxy returns:");
    console.log("   typeof fragmentFromProxy:", typeof fragmentFromProxy);
    console.log("   fragmentFromProxy.constructor.name:", fragmentFromProxy?.constructor?.name);
    console.log("   fragmentFromProxy.doc:", fragmentFromProxy.doc ? "has doc" : "no doc");
    console.log("   fragmentFromProxy === fragment?", fragmentFromProxy === fragment);
    console.log("   fragmentFromProxy === fragmentInMap?", fragmentFromProxy === fragmentInMap);
    
    // Check if it's wrapped
    console.log("4. Checking if value is wrapped/unwrapped:");
    console.log("   fragmentFromProxy instanceof Y.XmlFragment?", fragmentFromProxy instanceof Y.XmlFragment);
    
    expect(fragmentFromProxy.doc).not.toBeNull();
  });
});

