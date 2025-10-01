import { describe, it, expect } from "vitest";
import * as Y from "yjs";

describe("Debug: Y.js XML sync", () => {
  it("verifies Y.XmlFragment deletion syncs at Y.js level", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    // Set up relay
    const RELAY = Symbol();
    docA.on("update", (update, origin) => {
      if (origin === RELAY) return;
      Y.applyUpdate(docB, update, RELAY);
    });
    docB.on("update", (update, origin) => {
      if (origin === RELAY) return;
      Y.applyUpdate(docA, update, RELAY);
    });

    // Create fragment with children on docA
    const mapA = docA.getMap("root");
    const fragment = new Y.XmlFragment();
    const el1 = new Y.XmlElement("div");
    const el2 = new Y.XmlElement("span");
    const el3 = new Y.XmlElement("p");
    fragment.insert(0, [el1, el2, el3]);
    
    // Add fragment to docA
    mapA.set("fragment", fragment);

    // Get fragment from docB (should be synced)
    const mapB = docB.getMap("root");
    const fragmentB = mapB.get("fragment") as Y.XmlFragment;
    
    console.log("Before delete - fragmentA.length:", fragment.length);
    console.log("Before delete - fragmentB.length:", fragmentB.length);
    expect(fragmentB.length).toBe(3);

    // Delete from fragmentA
    fragment.delete(1, 1);
    
    console.log("After delete - fragmentA.length:", fragment.length);
    console.log("After delete - fragmentB.length:", fragmentB.length);
    expect(fragment.length).toBe(2);
    expect(fragmentB.length).toBe(2); // This should pass if Y.js sync works
  });
});

