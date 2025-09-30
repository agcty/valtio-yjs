import * as Y from 'yjs';
import { createYjsProxy } from './dist/index.js';

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
]);

console.log('=== Checking proxy types ===');
const level5 = proxy[0];
console.log('level5 type:', typeof level5);

const level4 = level5.children[0];
console.log('level4 type:', typeof level4);

const level3 = level4.children[0];
console.log('level3 type:', typeof level3);

const level2 = level3.children[0];
console.log('level2 type:', typeof level2);

const level1 = level2.children[0];
console.log('level1 type:', typeof level1);

const level0 = level1.children[0];
console.log('level0 type:', typeof level0);
console.log('level0:', level0);
console.log('level0.value:', level0.value);
console.log('level0 constructor:', level0.constructor.name);
console.log('level0 keys:', Object.keys(level0));
console.log('level0 JSON:', JSON.stringify(level0));

console.log('\n=== Checking chained access ===');
const chained = proxy[0].children[0].children[0].children[0].children[0].children[0];
console.log('chained type:', typeof chained);
console.log('chained:', chained);
console.log('chained.value:', chained.value);
console.log('chained.value direct access:', chained['value']);
console.log('chained constructor:', chained.constructor.name);
console.log('chained keys:', Object.keys(chained));
console.log('chained JSON:', JSON.stringify(chained));

console.log('\n=== Are they the same object? ===');
console.log('level0 === chained:', level0 === chained);
console.log('typeof level0:', typeof level0);
console.log('typeof chained:', typeof chained);
