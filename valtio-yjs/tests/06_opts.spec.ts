/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy, VALTIO_YJS_ORIGIN } from 'valtio-yjs';

describe('controller options', () => {
  it('library tags transactions with VALTIO_YJS_ORIGIN', async () => {
    const doc = new Y.Doc();
    const { proxy: p } = createYjsProxy<{ foo?: string }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });

    const fn = vi.fn();
    doc.on('updateV2', (_: Uint8Array, origin: unknown) => {
      fn(origin);
    });

    p.foo = 'bar';
    await Promise.resolve();
    expect(fn).toBeCalledWith(VALTIO_YJS_ORIGIN);
    fn.mockClear();

    p.foo = 'baz';
    await Promise.resolve();
    expect(fn).toBeCalledWith(VALTIO_YJS_ORIGIN);
  });
});

describe('controller', () => {
  it('array operations also use VALTIO_YJS_ORIGIN', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('arr'),
    });
    bootstrap([]);

    const fn = vi.fn();
    doc.on('updateV2', (_: Uint8Array, origin: unknown) => {
      fn(origin);
    });

    p.push('a');
    await Promise.resolve();
    expect(fn).toBeCalledWith(VALTIO_YJS_ORIGIN);
  });
});
