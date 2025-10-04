import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from '../../src/index';

const waitMicrotask = () => Promise.resolve();

describe('array item move operations', () => {
  it('array item move up', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<string>('root');

    bootstrap(['a', 'b', 'c', 'd', 'e']);
    await waitMicrotask();

    const moveUp = (index: number) => {
      const [item] = p.splice(index, 1);
      p.splice(index - 1, 0, item!);
    };

    moveUp(2);
    await waitMicrotask();
    expect(a.toJSON()).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(p).toEqual(['a', 'c', 'b', 'd', 'e']);

    moveUp(3);
    await waitMicrotask();
    expect(a.toJSON()).toEqual(['a', 'c', 'd', 'b', 'e']);
    expect(p).toEqual(['a', 'c', 'd', 'b', 'e']);
  });

  it('array item move down', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<string>('root');

    bootstrap(['a', 'b', 'c', 'd', 'e']);
    await waitMicrotask();

    const moveDown = (index: number) => {
      const [item] = p.splice(index, 1);
      p.splice(index + 1, 0, item!);
    };

    moveDown(2);
    await waitMicrotask();
    expect(a.toJSON()).toEqual(['a', 'b', 'd', 'c', 'e']);
    expect(p).toEqual(['a', 'b', 'd', 'c', 'e']);

    moveDown(1);
    await waitMicrotask();
    expect(a.toJSON()).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(p).toEqual(['a', 'd', 'b', 'c', 'e']);
  });
});
