import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { proxy, ref } from "valtio/vanilla";

describe("Debug: Valtio ref behavior", () => {
  it("checks if Valtio ref preserves object identity", () => {
    const fragment = new Y.XmlFragment();
    const el = new Y.XmlElement("div");
    fragment.insert(0, [el]);

    console.log("1. Original fragment:");
    console.log("   fragment:", fragment);
    console.log("   fragment.length:", fragment.length);

    const state = proxy({ fragment: ref(fragment) });

    console.log("2. After storing in proxy with ref():");
    console.log("   state.fragment:", state.fragment);
    console.log("   state.fragment === fragment?", state.fragment === fragment);
    console.log("   state.fragment.length:", state.fragment.length);

    // Try reassigning
    state.fragment = ref(fragment);

    console.log("3. After reassigning with ref():");
    console.log("   state.fragment === fragment?", state.fragment === fragment);

    expect(state.fragment).toBe(fragment);
  });
});

