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
  { simple: 'element' },
  createDeepStructure(4)
]);

console.log('Level 0 (proxy[0]):', proxy[0].level);
console.log('Level 1 (proxy[0].children):', proxy[0].children);
console.log('Level 1 (proxy[0].children[0]):', proxy[0].children[0]);
console.log('Level 2 (proxy[0].children[0].level):', proxy[0].children[0].level);
console.log('Level 2 (proxy[0].children[0].children):', proxy[0].children[0].children);

const child0 = proxy[0].children[0];
console.log('\nchild0:', child0);
console.log('child0.level:', child0.level);
console.log('child0.children:', child0.children);

const child0child0 = child0.children[0];
console.log('\nchild0child0:', child0child0);
console.log('child0child0.level:', child0child0.level);
console.log('child0child0.children:', child0child0.children);

const child0child0child0 = child0child0.children[0];
console.log('\nchild0child0child0:', child0child0child0);
console.log('child0child0child0.level:', child0child0child0.level);
console.log('child0child0child0.children:', child0child0child0.children);

const child0child0child0child0 = child0child0child0.children[0];
console.log('\nchild0child0child0child0:', child0child0child0child0);
console.log('child0child0child0child0.level:', child0child0child0child0.level);
console.log('child0child0child0child0.children:', child0child0child0child0.children);

const child0child0child0child0child0 = child0child0child0child0.children[0];
console.log('\nchild0child0child0child0child0:', child0child0child0child0child0);
console.log('child0child0child0child0child0.value:', child0child0child0child0child0.value);

console.log('\nDirect access test:');
console.log('proxy[0].children[0].children[0].children[0].children[0].value:',
  proxy[0].children[0].children[0].children[0].children[0].value);
