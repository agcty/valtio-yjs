import * as Y from 'yjs';
import { createYjsProxy } from './dist/index.js';
import { snapshot } from 'valtio/vanilla';

const createDeepStructure = (depth) => {
  if (depth === 0) {
    return { value: 'leaf', timestamp: Date.now() };
  }
  return {
    level: depth,
    children: [
      createDeepStructure(depth - 1),
      createDeepStructure(depth - 1),
    ],
    metadata: {
      depth,
      created: `level-${depth}`,
      properties: Array.from({ length: depth }, (_, i) => ({ key: `prop${i}`, value: i * depth }))
    }
  };
};

const doc = new Y.Doc();
const { proxy, bootstrap } = createYjsProxy(doc, {
  getRoot: (d) => d.getArray('deep'),
  debug: false
});

bootstrap([
  createDeepStructure(5),
  { simple: 'element' },
  createDeepStructure(4)
]);

// Test different access patterns
console.log('=== Direct proxy access ===');
console.log('1. proxy[0].level:', proxy[0].level);
console.log('2. proxy[0].children:', typeof proxy[0].children);
console.log('3. proxy[0].children[0]:', typeof proxy[0].children[0]);
console.log('4. proxy[0].children[0].level:', proxy[0].children[0].level);

console.log('\n=== Chained access (1 level) ===');
const test1 = proxy[0].children[0].level;
console.log('proxy[0].children[0].level:', test1);

console.log('\n=== Chained access (2 levels) ===');
const test2 = proxy[0].children[0].children[0].level;
console.log('proxy[0].children[0].children[0].level:', test2);

console.log('\n=== Chained access (3 levels) ===');
const test3 = proxy[0].children[0].children[0].children[0].level;
console.log('proxy[0].children[0].children[0].children[0].level:', test3);

console.log('\n=== Chained access (4 levels) ===');
const test4 = proxy[0].children[0].children[0].children[0].children[0].level;
console.log('proxy[0].children[0].children[0].children[0].children[0].level:', test4);

console.log('\n=== Chained access (5 levels - to leaf) ===');
const test5 = proxy[0].children[0].children[0].children[0].children[0].children[0];
console.log('proxy[0].children[0].children[0].children[0].children[0].children[0]:', test5);

console.log('\n=== Chained access to .value ===');
const test6 = proxy[0].children[0].children[0].children[0].children[0].value;
console.log('proxy[0].children[0].children[0].children[0].children[0].value:', test6);

console.log('\n=== Testing with snapshot ===');
const snap = snapshot(proxy);
console.log('snap[0].children[0].children[0].children[0].children[0].value:', snap[0].children[0].children[0].children[0].children[0].value);

console.log('\n=== Step by step for comparison ===');
const a = proxy[0];
console.log('a.level:', a.level);
const b = a.children;
console.log('b is array:', Array.isArray(b));
const c = b[0];
console.log('c.level:', c.level);
const d = c.children;
const e = d[0];
console.log('e.level:', e.level);
const f = e.children;
const g = f[0];
console.log('g.level:', g.level);
const h = g.children;
const i = h[0];
console.log('i.level:', i.level);
const j = i.children;
const k = j[0];
console.log('k:', k);
console.log('k.value:', k.value);
