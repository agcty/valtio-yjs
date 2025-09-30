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

// Check what's in the Y.Doc
const yArray = doc.getArray('deep');
console.log('Y.Doc contents (JSON):');
console.log(JSON.stringify(yArray.toJSON(), null, 2));

console.log('\n\nNow let\'s check the actual Y types:');
const level5 = yArray.get(0);
console.log('Level 5 Y type:', level5.constructor.name);
const childrenArray5 = level5.get('children');
console.log('Children array at level 5:', childrenArray5.constructor.name, 'length:', childrenArray5.length);

const level4 = childrenArray5.get(0);
console.log('Level 4 Y type:', level4.constructor.name);
const childrenArray4 = level4.get('children');
console.log('Children array at level 4:', childrenArray4.constructor.name, 'length:', childrenArray4.length);

const level3 = childrenArray4.get(0);
console.log('Level 3 Y type:', level3.constructor.name);
const childrenArray3 = level3.get('children');
console.log('Children array at level 3:', childrenArray3.constructor.name, 'length:', childrenArray3.length);

const level2 = childrenArray3.get(0);
console.log('Level 2 Y type:', level2.constructor.name);
const childrenArray2 = level2.get('children');
console.log('Children array at level 2:', childrenArray2.constructor.name, 'length:', childrenArray2.length);

const level1 = childrenArray2.get(0);
console.log('Level 1 Y type:', level1.constructor.name);
const childrenArray1 = level1.get('children');
console.log('Children array at level 1:', childrenArray1.constructor.name, 'length:', childrenArray1.length);

const level0 = childrenArray1.get(0);
console.log('Level 0 Y type:', level0.constructor.name);
console.log('Level 0 value:', level0.get('value'));
