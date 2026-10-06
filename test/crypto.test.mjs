import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, hex, privToAddress, recoverPersonal, signPersonal, leafHash, merkle, verifyProof } from '../server/src/crypto/eth.js';
import { calldata } from '../server/src/crypto/abi.js';
import { signTx1559 } from '../server/src/chain/rpc.js';

// Vectors produced with Foundry `cast` (see docs/review.md for the commands).
const ANVIL0 = BigInt('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

test('keccak256 matches cast', () => {
  assert.equal(hex(keccak256('abc')), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(hex(keccak256('a'.repeat(200))), '0x96ea54061def936c4be90b518992fdc6f12f535068a256229aca54267b4d084d');
  assert.equal(hex(keccak256('')), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
});

test('address derivation and personal_sign round-trip match cast', () => {
  assert.equal(privToAddress(ANVIL0), '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  const sig = '0x68578e3e9f83e250d87f85db47aba279e15163b54e009a35700698d10933f2b4614d6752c8b4dd6e9306d6c3436d6e7b7fa5f0c793e2ceb2e4d634bc5015d2c81c';
  assert.equal(signPersonal('hello pepe', ANVIL0), sig);
  assert.equal(recoverPersonal('hello pepe', sig), '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  assert.notEqual(recoverPersonal('hello pepf', sig), '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
});

test('Merkle leaf encoding matches GameReserve (shared vector with Reserve.t.sol)', () => {
  assert.equal(hex(leafHash(7, '0x000000000000000000000000000000000000BEEF', 25n * 10n ** 18n)), '0xb717d7d73203b2deb937bf9d246ead68deb067233a3a75858925c4c799ca3fe8');
  const leaves = [1, 2, 3, 4, 5].map((i) => leafHash(i, '0x000000000000000000000000000000000000BEEF', BigInt(i)));
  const t = merkle(leaves);
  leaves.forEach((l, i) => assert.ok(verifyProof(t.proofs[i], t.root, l)));
  assert.ok(!verifyProof(t.proofs[0], t.root, leaves[1]));
});

test('ABI calldata matches cast', () => {
  assert.equal(calldata('purchase(bytes32,uint256,uint256)', ['bytes32', 'uint256', 'uint256'], ['0x' + 'ab'.repeat(32), 2n, 10n]),
    '0xab2d662babababababababababababababababababababababababababababababababab0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a');
});

test('EIP-1559 signing matches cast (cast decode-transaction recovers the anvil signer)', () => {
  const raw = signTx1559({ chainId: 31337, nonce: 0n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2n, gas: 21000n, to: '0x000000000000000000000000000000000000dEaD', value: 0n, data: '0x' }, ANVIL0);
  assert.equal(raw, '0x02f864827a6980010282520894000000000000000000000000000000000000dead8080c001a0ac3a9bdb94520c63fc15dd96510a41c22117448a960e87ca66037581a6c77a35a06329292ce539d17c607b280e31b2b4ce7efbf02ac990050893dca3a577ca7a4f');
});
