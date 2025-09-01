import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from 'valtio-yjs';

// NOTE (new architecture): The library does not implement move semantics at the
// controller level (splice-based shifts/reorders). We plan to add a runtime
// warning that detects probable moves and informs the user to implement
// application-level move strategies (e.g., fractional indexing). Until then,
// these tests validate prior behavior but do not reflect the recommended API
// usage in the new architecture.

describe.skip('issue #7', () => {
  it('array item move up', async () => {
    const doc = new Y.Doc();
    const a = doc.getArray('arr');
    const { proxy: p, bootstrap } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('arr'),
    });
    bootstrap(['a', 'b', 'c', 'd', 'e']);

    const moveUp = (index: number) => {
      const [item] = p.splice(index, 1);
      p.splice(index - 1, 0, item!);
    };

    moveUp(2);
    await Promise.resolve();
    expect(a.toJSON()).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(p).toEqual(['a', 'c', 'b', 'd', 'e']);

    moveUp(3);
    await Promise.resolve();
    expect(a.toJSON()).toEqual(['a', 'c', 'd', 'b', 'e']);
    expect(p).toEqual(['a', 'c', 'd', 'b', 'e']);
  });

  it('array item move down', async () => {
    const doc = new Y.Doc();
    const a = doc.getArray('arr');
    const { proxy: p, bootstrap } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('arr'),
    });
    bootstrap(['a', 'b', 'c', 'd', 'e']);

    const moveDown = (index: number) => {
      const [item] = p.splice(index, 1);
      p.splice(index + 1, 0, item!);
    };

    moveDown(2);
    await Promise.resolve();
    expect(a.toJSON()).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(p).toEqual(['a', 'b', 'd', 'c', 'e']);

    moveDown(1);
    await Promise.resolve();
    expect(a.toJSON()).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(p).toEqual(['a', 'd', 'b', 'c', 'e']);
  });
});
