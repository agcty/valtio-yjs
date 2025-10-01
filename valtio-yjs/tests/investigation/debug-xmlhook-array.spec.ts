import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createRelayedProxiesArrayRoot, waitMicrotask } from "../helpers/test-helpers";

describe("Debug: Y.XmlHook in arrays", () => {
  it("checks what proxyB contains after sync", async () => {
    const { proxyA, proxyB, bootstrapA, docB } = createRelayedProxiesArrayRoot({ debug: true });

    const hook1 = new Y.XmlHook("hook1");
    hook1.set("name", "first");

    console.log("\n=== BEFORE PUSH ===");
    console.log("hook1 type:", hook1.constructor.name);
    console.log("hook1 instanceof Y.XmlHook?", hook1 instanceof Y.XmlHook);
    console.log("hook1 instanceof Y.Map?", hook1 instanceof Y.Map);

    proxyA.push(hook1);
    await waitMicrotask();

    console.log("\n=== AFTER PUSH (before bootstrap) ===");
    console.log("proxyA[0] type:", proxyA[0]?.constructor?.name);
    console.log("proxyA[0] instanceof Y.XmlHook?", proxyA[0] instanceof Y.XmlHook);

    bootstrapA([]);
    await waitMicrotask();

    console.log("\n=== AFTER BOOTSTRAP ===");
    const arrB = docB.getArray("arr");
    const itemFromYArrayB = arrB.get(0);
    console.log("itemFromYArrayB type:", itemFromYArrayB?.constructor?.name);
    console.log("itemFromYArrayB instanceof Y.XmlHook?", itemFromYArrayB instanceof Y.XmlHook);
    console.log("itemFromYArrayB === hook1?", itemFromYArrayB === hook1);
    
    console.log("\nproxyB[0] type:", proxyB[0]?.constructor?.name);
    console.log("proxyB[0] value:", proxyB[0]);
    console.log("proxyB[0] instanceof Y.XmlHook?", proxyB[0] instanceof Y.XmlHook);
    
    // If it's an object, check its properties
    if (typeof proxyB[0] === 'object' && proxyB[0] !== null) {
      console.log("proxyB[0] keys:", Object.keys(proxyB[0]));
    }
  });
});

