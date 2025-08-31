import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from 'valtio-yjs';

describe('push', () => {
  it('y array', async () => {
    const doc = new Y.Doc();
    const a = doc.getArray('arr');
    a.insert(0, ['a', 'b', 'c']);
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
      ]
    `);

    const listener = vi.fn();
    a.observe((event) => {
      listener(event.changes.delta);
    });

    a.push(['d']);
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
        "d",
      ]
    `);
    expect(listener).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            [
              {
                "retain": 3,
              },
              {
                "insert": [
                  "d",
                ],
              },
            ],
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `);
    listener.mockClear();

    a.push(['e', 'f']);
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
      ]
    `);
    expect(listener).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            [
              {
                "retain": 4,
              },
              {
                "insert": [
                  "e",
                  "f",
                ],
              },
            ],
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `);
    listener.mockClear();
  });

  it('controller proxy -> y array', async () => {
    const doc = new Y.Doc();
    const a = doc.getArray<string>('arr');
    const { proxy: p, bootstrap } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('arr'),
    });
    bootstrap(['a', 'b', 'c']);
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
      ]
    `);

    const listener = vi.fn();
    a.observe((event) => listener(event.changes.delta));

    p.push('d');
    await Promise.resolve();
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
        "d",
      ]
    `);
    expect(listener).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            [
              {
                "retain": 3,
              },
              {
                "insert": [
                  "d",
                ],
              },
            ],
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `);
    listener.mockClear();

    p.push('e', 'f');
    await Promise.resolve();
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
      ]
    `);
    expect(listener).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            [
              {
                "retain": 4,
              },
              {
                "insert": [
                  "e",
                  "f",
                ],
              },
            ],
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `);
    listener.mockClear();
  });
});

describe('pop', () => {
  it('y array', async () => {
    const doc = new Y.Doc();
    const a = doc.getArray('arr');
    a.insert(0, ['a', 'b', 'c']);
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
      ]
    `);

    const listener = vi.fn();
    a.observe((event) => {
      listener(event.changes.delta);
    });

    a.delete(a.length - 1);
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
      ]
    `);
    expect(listener).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            [
              {
                "retain": 2,
              },
              {
                "delete": 1,
              },
            ],
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `);
    listener.mockClear();

    a.delete(a.length - 1);
    a.delete(a.length - 1);
    expect(a.toJSON()).toMatchInlineSnapshot('[]');
    expect(listener).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            [
              {
                "retain": 1,
              },
              {
                "delete": 1,
              },
            ],
          ],
          [
            [
              {
                "delete": 1,
              },
            ],
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `);
    listener.mockClear();
  });

  it('controller proxy -> y array', async () => {
    const doc = new Y.Doc();
    const a = doc.getArray<string>('arr');
    const { proxy: p, bootstrap } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('arr'),
    });
    bootstrap(['a', 'b', 'c']);
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
      ]
    `);

    const listener = vi.fn();
    a.observe((event) => listener(event.changes.delta));

    p.pop();
    await Promise.resolve();
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
      ]
    `);
    expect(listener).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            [
              {
                "retain": 2,
              },
              {
                "delete": 1,
              },
            ],
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `);
    listener.mockClear();

    p.pop();
    p.pop();
    await Promise.resolve();
    expect(a.toJSON()).toMatchInlineSnapshot('[]');
    expect(listener).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            [
              {
                "delete": 2,
              },
            ],
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `);
    listener.mockClear();
  });
});

describe('unshift', () => {
  it('y array', async () => {
    const doc = new Y.Doc();
    const a = doc.getArray('arr');
    a.insert(0, ['a', 'b', 'c']);
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "a",
        "b",
        "c",
      ]
    `);

    const listener = vi.fn();
    a.observe((event) => {
      listener(event.changes.delta);
    });

    a.insert(0, ['d']);
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "d",
        "a",
        "b",
        "c",
      ]
    `);
    expect(listener).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            [
              {
                "insert": [
                  "d",
                ],
              },
            ],
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `);
    listener.mockClear();

    a.insert(0, ['e', 'f']);
    expect(a.toJSON()).toMatchInlineSnapshot(`
      [
        "e",
        "f",
        "d",
        "a",
        "b",
        "c",
      ]
    `);
    expect(listener).toMatchInlineSnapshot(`
      [MockFunction spy] {
        "calls": [
          [
            [
              {
                "insert": [
                  "e",
                  "f",
                ],
              },
            ],
          ],
        ],
        "results": [
          {
            "type": "return",
            "value": undefined,
          },
        ],
      }
    `);
    listener.mockClear();
  });

  // Note: controller-level unshift/moves are not asserted here because library does not implement moves.
});
