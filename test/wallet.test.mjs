import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from '../web/wallet.js';

test('injected wallet authenticates separately and invalidates account/network changes', async (t) => {
  const calls = [], handlers = {}, changes = [];
  const account = '0x' + '12'.repeat(20);
  const provider = { on: (event, fn) => { handlers[event] = fn; }, request: async ({ method, params }) => {
    calls.push(method);
    if (method === 'eth_requestAccounts') return [account];
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'personal_sign') { assert.equal(params[1], account); return 'fixture-signature'; }
    if (method === 'eth_sendTransaction') return '0xfixture';
    if (method === 'eth_getTransactionReceipt') return { status: '0x1' };
    throw new Error(method);
  } };
  globalThis.window = { ethereum: provider, addEventListener() {}, dispatchEvent() {} };
  t.after(() => { delete globalThis.window; });
  const wallet = new Wallet({ chainId: 31337, onChange: (change) => changes.push(change) });
  assert.equal(await wallet.connect(), account);
  assert.equal(calls.includes('personal_sign'), false, 'connection is not authentication');
  assert.equal(await wallet.signMessage('fixture challenge', account), 'fixture-signature');
  assert.equal(await wallet.send({ to: account, data: '0x' }), '0xfixture');
  handlers.accountsChanged(['0x' + '34'.repeat(20)]);
  handlers.chainChanged('0x1');
  assert.deepEqual(changes, ['account changed', 'network changed']);
});
