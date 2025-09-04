/*
  Debug: Multi-Client Nested Operations
  - Reproduces: delete team on client1, then push member on client2
  - Logs Y and proxy states to detect duplicate insertions or missed purges
*/

/* eslint-disable no-console */

const Y = require('yjs');
const lib = require('./dist/index.cjs');

function waitMicrotask() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

async function main() {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const doc3 = new Y.Doc();

  const { proxy: proxy1, bootstrap: bootstrap1 } = lib.createYjsProxy(doc1, {
    getRoot: (d) => d.getArray('root'),
    debug: true,
  });
  const { proxy: proxy2 } = lib.createYjsProxy(doc2, {
    getRoot: (d) => d.getArray('root'),
    debug: true,
  });
  const { proxy: proxy3 } = lib.createYjsProxy(doc3, {
    getRoot: (d) => d.getArray('root'),
    debug: true,
  });

  // Bootstrap initial data on client 1
  bootstrap1([
    {
      name: 'Acme Corp',
      teams: [
        {
          name: 'Backend Team',
          members: [
            { name: 'Alice', role: 'lead', skills: ['node', 'postgres'] },
            { name: 'Bob', role: 'dev', skills: ['go', 'kafka'] },
          ],
        },
        {
          name: 'Frontend Team',
          members: [
            { name: 'Carol', role: 'lead', skills: ['react', 'typescript'] },
            { name: 'Dave', role: 'designer', skills: ['figma', 'css'] },
          ],
        },
      ],
    },
  ]);

  await waitMicrotask();

  // Sync all
  let update = Y.encodeStateAsUpdate(doc1);
  Y.applyUpdate(doc2, update);
  Y.applyUpdate(doc3, update);
  await waitMicrotask();

  console.log('Initial members on all docs:',
    proxy1[0].teams[0].members.map((m) => m.name),
    proxy1[0].teams[1].members.map((m) => m.name),
  );

  // Client 1: delete team 0
  proxy1[0].teams.splice(0, 1);
  await waitMicrotask();

  // Sync deletion
  update = Y.encodeStateAsUpdate(doc1);
  Y.applyUpdate(doc2, update);
  Y.applyUpdate(doc3, update);
  await waitMicrotask();

  console.log('After deletion: teams length', proxy1[0].teams.length, proxy2[0].teams.length, proxy3[0].teams.length);
  console.log('Remaining team name:', proxy1[0].teams[0].name);

  // Client 2: push a member to remaining team
  proxy2[0].teams[0].members.push({ name: 'Eve', role: 'developer', skills: ['vue', 'node'] });
  await waitMicrotask();

  // Sync addition from doc2
  update = Y.encodeStateAsUpdate(doc2);
  Y.applyUpdate(doc1, update);
  Y.applyUpdate(doc3, update);
  await waitMicrotask();

  // Inspect proxy states
  console.log('Members lengths (proxy):',
    proxy1[0].teams[0].members.length,
    proxy2[0].teams[0].members.length,
    proxy3[0].teams[0].members.length,
  );
  console.log('Members names (proxy1):', proxy1[0].teams[0].members.map((m) => m.name));
  console.log('Members names (proxy2):', proxy2[0].teams[0].members.map((m) => m.name));
  console.log('Members names (proxy3):', proxy3[0].teams[0].members.map((m) => m.name));

  // Inspect Y state directly
  const root1 = doc1.getArray('root');
  const org1 = root1.get(0);
  const teams1 = org1.get('teams');
  const members1 = teams1.get(0).get('members');
  console.log('Y.members length doc1:', members1.length, 'names:', members1.toArray().map((m) => m.get('name')));

  const root2 = doc2.getArray('root');
  const org2 = root2.get(0);
  const teams2 = org2.get('teams');
  const members2 = teams2.get(0).get('members');
  console.log('Y.members length doc2:', members2.length, 'names:', members2.toArray().map((m) => m.get('name')));

  const root3 = doc3.getArray('root');
  const org3 = root3.get(0);
  const teams3 = org3.get('teams');
  const members3 = teams3.get(0).get('members');
  console.log('Y.members length doc3:', members3.length, 'names:', members3.toArray().map((m) => m.get('name')));
}

main().catch((e) => {
  console.error('Debug script error:', e);
  process.exit(1);
});
