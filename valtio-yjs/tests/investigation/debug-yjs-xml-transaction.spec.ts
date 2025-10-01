import { describe, it, expect } from "vitest";
import * as Y from "yjs";

describe("Debug: Y.js XML transaction behavior", () => {
  it("does XmlFragment.delete() generate a transaction?", () => {
    const doc = new Y.Doc();
    const map = doc.getMap("root");
    
    // Create and insert fragment
    const fragment = new Y.XmlFragment();
    const el1 = new Y.XmlElement("div");
    const el2 = new Y.XmlElement("span");
    fragment.insert(0, [el1, el2]);
    
    map.set("fragment", fragment);
    
    console.log("After insertion:");
    console.log("  fragment.doc:", fragment.doc !== null);
    console.log("  fragment.parent:", fragment.parent !== null);
    console.log("  fragment.length:", fragment.length);
    
    // Setup update listener
    const updates: any[] = [];
    doc.on("update", (update: Uint8Array, origin: any) => {
      console.log("Update event, origin:", origin);
      updates.push({ update, origin });
    });
    
    console.log("\nCalling fragment.delete(0, 1):");
    fragment.delete(0, 1);
    
    console.log("After delete:");
    console.log("  fragment.length:", fragment.length);
    console.log("  updates.length:", updates.length);
    
    expect(updates.length).toBeGreaterThan(0);
    expect(fragment.length).toBe(1);
  });
  
  it("does XmlFragment retrieved from map.get() generate transactions?", () => {
    const doc = new Y.Doc();
    const map = doc.getMap("root");
    
    // Create and insert fragment
    const fragment = new Y.XmlFragment();
    const el1 = new Y.XmlElement("div");
    const el2 = new Y.XmlElement("span");
    fragment.insert(0, [el1, el2]);
    
    map.set("fragment", fragment);
    
    // Retrieve it back
    const retrieved = map.get("fragment") as Y.XmlFragment;
    console.log("\nRetrieved fragment:");
    console.log("  retrieved === fragment?", retrieved === fragment);
    console.log("  retrieved.doc:", retrieved.doc !== null);
    console.log("  retrieved.parent:", retrieved.parent !== null);
    
    // Setup update listener
    const updates: any[] = [];
    doc.on("update", (update: Uint8Array, origin: any) => {
      console.log("Update event, origin:", origin);
      updates.push({ update, origin });
    });
    
    console.log("\nCalling retrieved.delete(0, 1):");
    retrieved.delete(0, 1);
    
    console.log("After delete:");
    console.log("  retrieved.length:", retrieved.length);
    console.log("  updates.length:", updates.length);
    
    expect(updates.length).toBeGreaterThan(0);
    expect(retrieved.length).toBe(1);
  });
});

