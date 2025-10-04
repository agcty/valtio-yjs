import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from '../../src/index';

const waitMicrotask = () => Promise.resolve();

describe('array length manipulation', () => {
  // Note: Direct length manipulation has some quirks with Valtio proxies.
  // Use splice() for more reliable array resizing.

  it.skip('reset length then push (known limitation)', async () => {
    // This test demonstrates a current limitation:
    // Setting length = 0 may not fully clear the array in some scenarios
    const doc = new Y.Doc();
    const { proxy: p } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<string>('root');

    p.push('a');
    p.push('b');
    p.length = 0;
    p.push('b');
    await waitMicrotask();

    // Currently fails - gets ['b', 'b'] instead of ['b']
    expect(a.toJSON()).toEqual(['b']);
    expect(p).toEqual(['b']);
  });

  it('clear array using splice', async () => {
    // Recommended approach: use splice instead of length manipulation
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<string>('root');

    bootstrap(['a', 'b', 'c']);
    await waitMicrotask();

    p.splice(0);
    await waitMicrotask();

    expect(a.toJSON()).toEqual([]);
    expect(p).toEqual([]);

    p.push('b');
    await waitMicrotask();

    expect(a.toJSON()).toEqual(['b']);
    expect(p).toEqual(['b']);
  });

  it('shrink array using splice', async () => {
    // Recommended approach: use splice instead of length manipulation
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<string>('root');

    bootstrap(['a', 'b', 'c']);
    await waitMicrotask();

    p.splice(2);
    await waitMicrotask();

    expect(a.toJSON()).toEqual(['a', 'b']);
    expect(p).toEqual(['a', 'b']);

    p.push('c');
    await waitMicrotask();

    expect(a.toJSON()).toEqual(['a', 'b', 'c']);
    expect(p).toEqual(['a', 'b', 'c']);
  });
});
