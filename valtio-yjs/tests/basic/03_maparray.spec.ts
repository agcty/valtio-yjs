/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from '../../src/index';

const waitMicrotask = () => Promise.resolve();

describe('map containing array', () => {
  it('array value in map syncs from yjs', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap<any>('root');
    const arr = new Y.Array();
    m.set('arr', arr);
    arr.push(['a', 'b']);

    const { proxy: p } = createYjsProxy<{ arr?: string[] }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    await waitMicrotask();

    expect(m.get('arr').toJSON()).toEqual(['a', 'b']);
    expect(p.arr).toEqual(['a', 'b']);
  });

  it('array value in map with bootstrap', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<{ arr: string[] }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    bootstrap({ arr: ['a', 'b'] });
    await waitMicrotask();

    expect(m.get('arr').toJSON()).toEqual(['a', 'b']);
    expect(p.arr).toEqual(['a', 'b']);
  });
});
