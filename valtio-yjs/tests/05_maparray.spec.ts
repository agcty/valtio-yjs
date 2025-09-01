/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from 'valtio-yjs';

describe('issue #4', () => {
  it('map array', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map') as any;
    const arr = new Y.Array();
    m.set('arr', arr);
    arr.push(['a', 'b']);

    const { proxy: p } = createYjsProxy<{ arr?: string[] }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });

    expect(m.get('arr').toJSON()).toEqual(['a', 'b']);
    expect(p.arr).toEqual(['a', 'b']);
  });
});

describe('issue #11', () => {
  it('map array with initial value', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map') as any;
    const arr = new Y.Array();
    m.set('arr', arr);
    arr.push(['a', 'b']);

    const { proxy: p } = createYjsProxy<{ arr?: string[] }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });

    expect(m.get('arr').toJSON()).toEqual(['a', 'b']);
    expect(p.arr).toEqual(['a', 'b']);
  });
});
