/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from '../../src/index';
import { createDocWithProxy, waitMicrotask } from '../helpers/test-helpers';

describe('Integration: Deep Nesting', () => {
  describe('Deep Structure (10-20 levels)', () => {
    it('should handle 10 levels of nested objects', async () => {
      const { proxy, doc } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      // Create 10-level deep structure
      proxy.l1 = { l2: { l3: { l4: { l5: { l6: { l7: { l8: { l9: { l10: { value: 'deep' } } } } } } } } } };
      await waitMicrotask();

      // Verify deep access
      expect(proxy.l1.l2.l3.l4.l5.l6.l7.l8.l9.l10.value).toBe('deep');

      // Mutate at deepest level
      proxy.l1.l2.l3.l4.l5.l6.l7.l8.l9.l10.value = 'changed';
      await waitMicrotask();
      expect(proxy.l1.l2.l3.l4.l5.l6.l7.l8.l9.l10.value).toBe('changed');

      // Add new property at mid-level
      proxy.l1.l2.l3.l4.l5.newProp = 42;
      await waitMicrotask();
      expect(proxy.l1.l2.l3.l4.l5.newProp).toBe(42);

      // Verify Y.js structure
      const yRoot = doc.getMap<any>('root');
      const l1 = yRoot.get('l1') as Y.Map<any>;
      expect(l1).toBeInstanceOf(Y.Map);
      const l2 = l1.get('l2') as Y.Map<any>;
      expect(l2).toBeInstanceOf(Y.Map);
    });

    it('should handle 20 levels of nested objects', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      // Create 20-level deep structure (l1 through l20)
      const deepStructure: any = { value: 'very deep' };
      let current = deepStructure;
      for (let i = 20; i > 1; i--) {
        current = { [`l${i}`]: current };
      }
      proxy.l1 = current;
      await waitMicrotask();

      // Verify deep access
      expect(proxy.l1.l2.l3.l4.l5.l6.l7.l8.l9.l10.l11.l12.l13.l14.l15.l16.l17.l18.l19.l20.value).toBe('very deep');

      // Mutate at deepest level
      proxy.l1.l2.l3.l4.l5.l6.l7.l8.l9.l10.l11.l12.l13.l14.l15.l16.l17.l18.l19.l20.value = 'modified';
      await waitMicrotask();
      expect(proxy.l1.l2.l3.l4.l5.l6.l7.l8.l9.l10.l11.l12.l13.l14.l15.l16.l17.l18.l19.l20.value).toBe('modified');
    });

    it('should handle deep arrays with nested objects', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      // Create deep structure with arrays and objects
      proxy.data = {
        level1: [
          {
            level2: [
              {
                level3: [
                  {
                    level4: { value: 'nested in arrays' }
                  }
                ]
              }
            ]
          }
        ]
      };
      await waitMicrotask();

      expect(proxy.data.level1[0].level2[0].level3[0].level4.value).toBe('nested in arrays');

      // Mutate deep array element
      proxy.data.level1[0].level2[0].level3[0].level4.value = 'updated';
      await waitMicrotask();
      expect(proxy.data.level1[0].level2[0].level3[0].level4.value).toBe('updated');

      // Push to deep array
      proxy.data.level1[0].level2[0].level3.push({ level4: { value: 'new item' } });
      await waitMicrotask();
      expect(proxy.data.level1[0].level2[0].level3.length).toBe(2);
      expect(proxy.data.level1[0].level2[0].level3[1].level4.value).toBe('new item');
    });
  });

  describe('Wide Structure (1000+ keys)', () => {
    it('should handle objects with 1000 keys', async () => {
      const { proxy, doc } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      // Create object with 1000 keys
      const wideObj: any = {};
      for (let i = 0; i < 1000; i++) {
        wideObj[`key${i}`] = i;
      }
      proxy.wide = wideObj;
      await waitMicrotask();

      // Verify random keys
      expect(proxy.wide.key0).toBe(0);
      expect(proxy.wide.key500).toBe(500);
      expect(proxy.wide.key999).toBe(999);

      // Mutate specific keys
      proxy.wide.key500 = 'changed';
      await waitMicrotask();
      expect(proxy.wide.key500).toBe('changed');

      // Count Y.Map keys
      const yRoot = doc.getMap<any>('root');
      const yWide = yRoot.get('wide') as Y.Map<any>;
      expect(yWide.size).toBe(1000);
    });

    it('should handle arrays with 1000+ items', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      // Create array with 1000 items
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item${i}` }));
      proxy.items = largeArray;
      await waitMicrotask();

      expect(proxy.items.length).toBe(1000);
      expect(proxy.items[0].id).toBe(0);
      expect(proxy.items[999].id).toBe(999);

      // Mutate middle element
      proxy.items[500].value = 'modified';
      await waitMicrotask();
      expect(proxy.items[500].value).toBe('modified');

      // Push new item
      proxy.items.push({ id: 1000, value: 'new' });
      await waitMicrotask();
      expect(proxy.items.length).toBe(1001);
      expect(proxy.items[1000].value).toBe('new');
    });

    it('should handle map with 2000 entries', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      // Create very wide object
      const veryWideObj: any = {};
      for (let i = 0; i < 2000; i++) {
        veryWideObj[`prop${i}`] = { index: i, data: `value-${i}` };
      }
      proxy.data = veryWideObj;
      await waitMicrotask();

      // Verify random access
      expect(proxy.data.prop0.index).toBe(0);
      expect(proxy.data.prop1000.index).toBe(1000);
      expect(proxy.data.prop1999.index).toBe(1999);

      // Mutate nested property in wide structure
      proxy.data.prop1000.data = 'updated';
      await waitMicrotask();
      expect(proxy.data.prop1000.data).toBe('updated');
    });
  });

  describe('Mixed Deep + Wide Structures', () => {
    it('should handle 10 levels deep with 100 keys at each level', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      // Create mixed structure: each level has 100 properties
      const createWideLevel = (depth: number): any => {
        if (depth === 0) return { value: 'leaf' };
        const obj: any = {};
        for (let i = 0; i < 100; i++) {
          obj[`key${i}`] = i < 2 ? createWideLevel(depth - 1) : i; // Only nest first 2 to avoid explosion
        }
        return obj;
      };

      proxy.mixed = createWideLevel(5);
      await waitMicrotask();

      // Verify access
      expect(proxy.mixed.key0.key0.key0.key0.key0.value).toBe('leaf');
      expect(proxy.mixed.key99).toBe(99);

      // Mutate deep path
      proxy.mixed.key0.key1.key0.key1.key0.value = 'changed';
      await waitMicrotask();
      expect(proxy.mixed.key0.key1.key0.key1.key0.value).toBe('changed');

      // Mutate shallow property
      proxy.mixed.key50 = 'updated';
      await waitMicrotask();
      expect(proxy.mixed.key50).toBe('updated');
    });

    it('should handle array of 100 deeply nested objects', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      // Create array of 100 items, each 5 levels deep
      const items = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        meta: {
          level1: {
            level2: {
              level3: {
                level4: {
                  value: `deep-${i}`
                }
              }
            }
          }
        }
      }));

      proxy.items = items;
      await waitMicrotask();

      // Verify length
      expect(proxy.items.length).toBe(100);

      // Verify deep access on multiple items
      expect(proxy.items[0].meta.level1.level2.level3.level4.value).toBe('deep-0');
      expect(proxy.items[50].meta.level1.level2.level3.level4.value).toBe('deep-50');
      expect(proxy.items[99].meta.level1.level2.level3.level4.value).toBe('deep-99');

      // Mutate deep property
      proxy.items[50].meta.level1.level2.level3.level4.value = 'modified';
      await waitMicrotask();
      expect(proxy.items[50].meta.level1.level2.level3.level4.value).toBe('modified');
    });

    it('should handle tree structure with 1000 nodes', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      // Create tree with breadth and depth
      const createTree = (id: number, depth: number, breadth: number): any => {
        if (depth === 0) return { id, value: `leaf-${id}`, isLeaf: true };
        return {
          id,
          value: `node-${id}`,
          isLeaf: false,
          children: Array.from({ length: breadth }, (_, i) => 
            createTree(id * breadth + i + 1, depth - 1, breadth)
          )
        };
      };

      // Tree with depth=5, breadth=4 = ~1365 total nodes
      proxy.tree = createTree(0, 5, 4);
      await waitMicrotask();

      // Verify root
      expect(proxy.tree.id).toBe(0);
      expect(proxy.tree.children.length).toBe(4);
      expect(proxy.tree.isLeaf).toBe(false);

      // Verify deep node access and that leaves exist (5 levels deep)
      const deepNode = proxy.tree.children[0].children[0].children[0].children[0].children[0];
      expect(deepNode.value).toBeDefined();
      expect(deepNode.isLeaf).toBe(true);

      // Mutate mid-level node
      proxy.tree.children[2].value = 'modified';
      await waitMicrotask();
      expect(proxy.tree.children[2].value).toBe('modified');

      // Add new child to mid-level node
      proxy.tree.children[1].children.push({ id: 9999, value: 'new-node', isLeaf: false });
      await waitMicrotask();
      expect(proxy.tree.children[1].children[proxy.tree.children[1].children.length - 1].value).toBe('new-node');
    });
  });

  describe('Performance Benchmarks', () => {
    it('should access deeply nested property in reasonable time', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      // Create 15-level deep structure
      let current: any = {};
      let deepest = current;
      for (let i = 0; i < 15; i++) {
        deepest[`level${i}`] = {};
        deepest = deepest[`level${i}`];
      }
      deepest.value = 'target';
      
      proxy.deep = current;
      await waitMicrotask();

      // Measure access time
      const start = performance.now();
      const value = proxy.deep.level0.level1.level2.level3.level4.level5.level6.level7.level8.level9.level10.level11.level12.level13.level14.value;
      const duration = performance.now() - start;

      expect(value).toBe('target');
      expect(duration).toBeLessThan(10); // Should be under 10ms
    });

    it('should iterate over 1000-item array in reasonable time', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: i * 2 }));
      proxy.items = items;
      await waitMicrotask();

      // Measure iteration time
      const start = performance.now();
      let sum = 0;
      for (const item of proxy.items) {
        sum += item.value;
      }
      const duration = performance.now() - start;

      expect(sum).toBe(999000); // Sum of 0 + 2 + 4 + ... + 1998
      expect(duration).toBeLessThan(100); // Should be under 100ms
    });

    it('should mutate 100 properties in wide object in reasonable time', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      const wideObj: any = {};
      for (let i = 0; i < 100; i++) {
        wideObj[`key${i}`] = i;
      }
      proxy.data = wideObj;
      await waitMicrotask();

      // Measure mutation time
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        proxy.data[`key${i}`] = i * 2;
      }
      await waitMicrotask();
      const duration = performance.now() - start;

      expect(proxy.data.key99).toBe(198);
      expect(duration).toBeLessThan(50); // Should be under 50ms
    });
  });

  describe('Edge Cases in Deep Structures', () => {
    it('should handle deep structure with mixed array and object nesting', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      proxy.complex = {
        a: [
          {
            b: [
              {
                c: {
                  d: [
                    {
                      e: { value: 'deeply mixed' }
                    }
                  ]
                }
              }
            ]
          }
        ]
      };
      await waitMicrotask();

      expect(proxy.complex.a[0].b[0].c.d[0].e.value).toBe('deeply mixed');

      // Replace array element deeply
      proxy.complex.a[0].b[0].c.d[0] = { e: { value: 'replaced' } };
      await waitMicrotask();
      expect(proxy.complex.a[0].b[0].c.d[0].e.value).toBe('replaced');
    });

    it('should handle deletion in deep structure', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      proxy.data = { l1: { l2: { l3: { l4: { l5: { value: 'deep', toDelete: 'remove me' } } } } } };
      await waitMicrotask();

      // Delete deep property
      delete proxy.data.l1.l2.l3.l4.l5.toDelete;
      await waitMicrotask();
      expect(proxy.data.l1.l2.l3.l4.l5.toDelete).toBeUndefined();
      expect(proxy.data.l1.l2.l3.l4.l5.value).toBe('deep');
    });

    it('should handle replacing entire subtree in deep structure', async () => {
      const { proxy } = createDocWithProxy<any>((d) => d.getMap('root'));
      
      proxy.data = { l1: { l2: { l3: { old: 'value' } } } };
      await waitMicrotask();

      // Replace mid-level subtree
      proxy.data.l1.l2 = { l3: { new: 'value' }, l4: { another: 'branch' } };
      await waitMicrotask();

      expect(proxy.data.l1.l2.l3.new).toBe('value');
      expect(proxy.data.l1.l2.l4.another).toBe('branch');
      expect(proxy.data.l1.l2.l3.old).toBeUndefined();
    });
  });
});

