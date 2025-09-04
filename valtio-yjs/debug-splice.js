import * as Y from 'yjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function logState(doc, label) {
  const arr = doc.getArray('arr');
  const summary = arr.toArray().map((item, idx) => {
    if (item instanceof Y.Map) {
      const child = item.get('child');
      return {
        idx,
        keys: Array.from(item.keys()),
        childKeys: child instanceof Y.Map ? Array.from(child.keys()) : null,
        childIsMap: child instanceof Y.Map,
      };
    }
    return { idx, type: typeof item };
  });
  console.log(label, JSON.stringify(summary, null, 2));
}

function sync(docFrom, docTo) {
  const update = Y.encodeStateAsUpdate(docFrom);
  Y.applyUpdate(docTo, update);
}

function setupInitial(doc1, doc2) {
  const yArr1 = doc1.getArray('arr');
  const initial = new Y.Map();
  const child = new Y.Map();
  child.set('x', 'x');
  initial.set('a', 'init');
  initial.set('child', child);
  yArr1.insert(0, [initial]);
  sync(doc1, doc2);
}

function scenarioReplaceInSameTransaction() {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  setupInitial(doc1, doc2);

  const yArr1 = doc1.getArray('arr');

  doc1.transact(() => {
    // delete existing element and insert a new one at the same index
    yArr1.delete(0, 1);
    const replacement = new Y.Map();
    const replacementChild = new Y.Map();
    replacementChild.set('y', 'y');
    replacement.set('a', 'new');
    replacement.set('child', replacementChild);
    yArr1.insert(0, [replacement]);
  });

  sync(doc1, doc2);

  const yArr2 = doc2.getArray('arr');
  assert(yArr2.length === 1, 'Expected length 1 after replacement');
  const item = yArr2.get(0);
  assert(item instanceof Y.Map, 'Expected Y.Map at index 0');
  const child = item.get('child');
  assert(child instanceof Y.Map, 'Expected child to be Y.Map');
  logState(doc2, 'After scenarioReplaceInSameTransaction');
}

function scenarioMutateOldChildThenReplaceSameTransaction() {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  setupInitial(doc1, doc2);

  const yArr1 = doc1.getArray('arr');

  doc1.transact(() => {
    const oldItem = yArr1.get(0);
    const oldChild = oldItem.get('child');
    // mutate a nested child first
    oldChild.set('z', 'z');
    // then delete parent and insert a new item at same index
    yArr1.delete(0, 1);
    const replacement = new Y.Map();
    const replacementChild = new Y.Map();
    replacementChild.set('y', 'y');
    replacement.set('a', 'new');
    replacement.set('child', replacementChild);
    yArr1.insert(0, [replacement]);
  });

  sync(doc1, doc2);

  const yArr2 = doc2.getArray('arr');
  assert(yArr2.length === 1, 'Expected length 1 after replace with prior child mutation');
  const item = yArr2.get(0);
  assert(item instanceof Y.Map, 'Expected Y.Map at index 0');
  const child = item.get('child');
  assert(child instanceof Y.Map, 'Expected child to be Y.Map');
  logState(doc2, 'After scenarioMutateOldChildThenReplaceSameTransaction');
}

function main() {
  console.log('Running minimal Yjs-only repro scenarios...');
  scenarioReplaceInSameTransaction();
  scenarioMutateOldChildThenReplaceSameTransaction();
  console.log('All scenarios completed without Yjs errors.');
}

main();

 