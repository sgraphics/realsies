// Wallet sign-in (protocol v1.3), unit level: NEP-413 verification against near-api-js's own signer with keys
// made here, the sign-in service (wrong recipient, reused and expired nonces, a function-call key, a key that
// is not the account's), sessions and WebSocket tickets, play keys, the checks on client-signed play and call
// transactions (the browser's encoder against near-api-js byte for byte), mainnet secrets, and the mock
// chain's access-key rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KeyPairSigner, PublicKey, actions, baseDecode, baseEncode, createTransaction } from 'near-api-js';
import { NEP413_TAG, decodeSignature, serializeNep413, signNep413, verifyNep413 } from '../src/auth/nep413.js';
import { AuthError, AuthService } from '../src/auth/service.js';
import { checkSignedTx, signRequestOf, type ExpectedTx } from '../src/auth/tx.js';
import { MockChain } from '../src/chain/mock.js';
import { NearChain, readSecrets } from '../src/chain/near.js';
import { Db } from '../src/db.js';
import { sha256Hex } from '../src/crypto.js';
import { loadWebTx, newKey, signChallenge, txOfRequest, type FunctionCallTx } from './wallet-helpers.js';

const TGAS = 10n ** 12n;
const code = (c: string) => (e: unknown) => e instanceof AuthError && e.code === c;

function authOn(chain: MockChain) {
  const db = new Db(':memory:');
  const auth = new AuthService(db, chain, { recipient: 'realsies.lol', sessionDays: 30, contractId: chain.contractId });
  return { db, auth, close: () => (auth.close(), db.close()) };
}

test('NEP-413: our payload matches near-api-js signNep413Message; a wrong recipient, message, nonce or key fails; every signature encoding wallets use is read', async () => {
  const k = newKey();
  const signer = new KeyPairSigner(k.nearKeyPair);
  const nonce = new Uint8Array(crypto.randomBytes(32));
  const payload = { message: 'Sign in to Realsies at realsies.lol.', recipient: 'realsies.lol', nonce };
  const sm = await signer.signNep413Message('player.testnet', payload);
  assert.equal(sm.publicKey.toString(), k.publicKey);
  const b64 = Buffer.from(sm.signature).toString('base64');
  assert.ok(verifyNep413(payload, k.publicKey, b64), 'a signature made by near-api-js verifies here');
  assert.equal(signNep413(payload, k.secret), b64, 'and ours is byte for byte the same (ed25519 is deterministic)');
  assert.equal(Buffer.from(serializeNep413(payload).subarray(0, 4)).readUInt32LE(0), NEP413_TAG);
  assert.equal(NEP413_TAG, 2147484061);

  assert.ok(!verifyNep413({ ...payload, recipient: 'evil.example' }, k.publicKey, b64), 'another recipient');
  assert.ok(!verifyNep413({ ...payload, message: payload.message + ' ' }, k.publicKey, b64), 'another message');
  assert.ok(!verifyNep413({ ...payload, nonce: new Uint8Array(crypto.randomBytes(32)) }, k.publicKey, b64), 'another nonce');
  assert.ok(!verifyNep413({ ...payload, callbackUrl: 'https://realsies.lol/' }, k.publicKey, b64), 'a callback URL is part of what is signed');
  assert.ok(!verifyNep413(payload, newKey().publicKey, b64), 'another key');
  assert.ok(!verifyNep413(payload, k.publicKey, 'not a signature'), 'garbage never throws');

  const raw = Buffer.from(sm.signature);
  for (const enc of [raw.toString('base64'), raw.toString('base64url'), `ed25519:${baseEncode(raw)}`, raw.toString('hex')]) {
    assert.equal(Buffer.compare(Buffer.from(decodeSignature(enc)), raw), 0, `decodes ${enc.slice(0, 12)}…`);
    assert.ok(verifyNep413(payload, k.publicKey, enc));
  }
  assert.throws(() => decodeSignature(raw.subarray(0, 63).toString('base64')), /64 bytes/);
});

test('sign-in: a full-access key signs the challenge; reused, unknown and expired nonces, a wrong recipient, a function-call key or a key that is not the account\'s are refused', async () => {
  const chain = new MockChain();
  chain.txLatencyMs = 0;
  const { auth, close } = authOn(chain);
  try {
    const acct = 'player.testnet';
    const fa = newKey();
    chain.addKey(acct, fa.publicKey, 'FullAccess');

    const ch = auth.challenge();
    assert.equal(ch.recipient, 'realsies.lol');
    assert.equal(Buffer.from(ch.nonce, 'base64').length, 32);
    assert.match(ch.message, /Sign in to Realsies at realsies\.lol/);
    assert.match(ch.message, /not a transaction/);
    const { token, session } = await auth.verify(signChallenge(ch, acct, fa));
    assert.equal(session.account, acct);
    assert.equal(session.signInKey, fa.publicKey);
    assert.ok(token.length >= 40);
    assert.equal(auth.session(token)?.account, acct);

    await assert.rejects(auth.verify(signChallenge(ch, acct, fa)), code('nonce_used'), 'the same signed challenge twice');
    await assert.rejects(auth.verify({ ...signChallenge(ch, acct, fa), nonce: crypto.randomBytes(32).toString('base64') }), code('nonce_unknown'), 'a nonce the relay never issued');

    const stale = auth.challenge(Date.now() - 11 * 60_000);
    await assert.rejects(auth.verify(signChallenge(stale, acct, fa)), code('nonce_expired'), 'a challenge older than ten minutes');

    const ch2 = auth.challenge();
    await assert.rejects(auth.verify(signChallenge(ch2, acct, fa, 'evil.example')), code('bad_signature'), 'signed for another recipient');
    await assert.rejects(auth.verify(signChallenge(ch2, acct, fa)), code('nonce_used'), 'a failed attempt spends the nonce');

    const fc = newKey();
    chain.addKey(acct, fc.publicKey, { receiverId: chain.contractId, methodNames: ['play', 'call'], allowance: '250000000000000000000000' });
    await assert.rejects(auth.verify(signChallenge(auth.challenge(), acct, fc)), (e) => code('not_full_access')(e) && (e as AuthError).status === 403, 'a function-call key cannot sign in');

    const stranger = newKey();
    await assert.rejects(auth.verify(signChallenge(auth.challenge(), acct, stranger)), code('key_not_found'), 'a key that is not on the account');
    await assert.rejects(auth.verify(signChallenge(auth.challenge(), 'victim.testnet', fa)), code('key_not_found'), "my key, someone else's account");

    const forged = signChallenge(auth.challenge(), acct, stranger);
    forged.publicKey = fa.publicKey; // claims the account's key, signed by another
    await assert.rejects(auth.verify(forged), code('bad_signature'));

    await assert.rejects(auth.verify({ ...signChallenge(auth.challenge(), acct, fa), accountId: 'Not An Account' }), code('invalid_request'));
    await assert.rejects(auth.verify({ ...signChallenge(auth.challenge(), acct, fa), publicKey: 'secp256k1:abc' }), code('invalid_request'));
  } finally {
    close();
  }
});

test('sessions: only the token\'s sha256 is stored; they expire and sign out; WebSocket tickets are single use and short-lived', async () => {
  const chain = new MockChain();
  chain.txLatencyMs = 0;
  const { db, auth, close } = authOn(chain);
  try {
    const acct = 'player.testnet';
    const fa = newKey();
    chain.addKey(acct, fa.publicKey, 'FullAccess');
    const { token, session } = await auth.verify(signChallenge(auth.challenge(), acct, fa));
    const rows = db.sql.prepare('SELECT token_sha256, data FROM sessions').all() as { token_sha256: string; data: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_sha256, crypto.createHash('sha256').update(token).digest('hex'));
    assert.ok(!rows[0].data.includes(token), 'the token itself is not stored');
    assert.equal(session.id, rows[0].token_sha256);

    assert.equal(auth.session(token, Date.now() + 29 * 86_400_000)?.account, acct, 'alive for 30 days');
    assert.equal(auth.session(token, Date.now() + 31 * 86_400_000), null, 'expired after');
    assert.equal(auth.session('nope'), null);
    assert.equal(auth.session(undefined), null);

    const t = auth.ticket(session);
    assert.ok(t.expiresAt - Date.now() <= 30_000);
    assert.equal(auth.redeemTicket(t.ticket)?.account, acct);
    assert.equal(auth.redeemTicket(t.ticket), null, 'a ticket works once');
    const old = auth.ticket(session, Date.now() - 31_000);
    assert.equal(auth.redeemTicket(old.ticket), null, 'an old ticket is refused');

    const before = auth.ticket(session);
    assert.ok(auth.revoke(token));
    assert.equal(auth.session(token), null, 'signed out');
    assert.equal(auth.redeemTicket(before.ticket), null, "a signed-out session's tickets stop working");
    assert.equal(auth.sessionsOf(acct).length, 0);
  } finally {
    close();
  }
});

test('play keys: a function-call key for the game contract allowed exactly play and call; anything broader, elsewhere or missing is refused', async () => {
  const chain = new MockChain();
  chain.txLatencyMs = 0;
  const { auth, close } = authOn(chain);
  try {
    const acct = 'player.testnet';
    const fa = newKey();
    chain.addKey(acct, fa.publicKey, 'FullAccess');
    const { session } = await auth.verify(signChallenge(auth.challenge(), acct, fa));
    const put = (methodNames: string[], receiverId = chain.contractId, allowance: string | null = '250000000000000000000000') => {
      const k = newKey();
      chain.addKey(acct, k.publicKey, { receiverId, methodNames, allowance });
      return k.publicKey;
    };
    const good = await auth.registerPlayKey(session, put(['play', 'call']));
    assert.equal(good.status, 'active');
    assert.deepEqual(good.methodNames, ['play', 'call']);
    assert.equal(auth.byId(session.id)?.playKey?.publicKey, good.publicKey, 'kept on the session');
    assert.equal((await auth.registerPlayKey(session, put(['call', 'play']))).status, 'active', 'any order');
    await assert.rejects(auth.registerPlayKey(session, put(['play'])), code('play_key_methods'));
    await assert.rejects(auth.registerPlayKey(session, put([])), code('play_key_methods'), 'a key that may call any method');
    await assert.rejects(auth.registerPlayKey(session, put(['play', 'call', 'withdraw'])), code('play_key_methods'), 'a key that could withdraw');
    await assert.rejects(auth.registerPlayKey(session, put(['play', 'call', 'transfer'])), code('play_key_methods'), 'a key that could move coins');
    await assert.rejects(auth.registerPlayKey(session, put(['play', 'call'], 'evil.testnet')), code('play_key_wrong_contract'));
    const fa2 = newKey();
    chain.addKey(acct, fa2.publicKey, 'FullAccess');
    await assert.rejects(auth.registerPlayKey(session, fa2.publicKey), code('play_key_full_access'));
    await assert.rejects(auth.registerPlayKey(session, fa.publicKey), code('play_key_full_access'), 'the sign-in key itself');
    await assert.rejects(auth.registerPlayKey(session, newKey().publicKey), (e) => code('play_key_not_found')(e) && (e as AuthError).status === 409);
    assert.equal((await auth.registerPlayKey(session, put(['play', 'call'], chain.contractId, '0'))).status, 'exhausted', 'no allowance left');
    assert.equal((await auth.registerPlayKey(session, put(['play', 'call'], chain.contractId, null))).allowance, null, 'an unlimited key is accepted as is');
  } finally {
    close();
  }
});

test('client-signed transactions: the browser\'s encoder matches near-api-js byte for byte; the relay accepts exactly the requested play or call and nothing else', async () => {
  const w = await loadWebTx();
  const k = newKey();
  const want: ExpectedTx = {
    signerId: 'player.testnet', publicKey: k.publicKey, receiverId: 'game.realsies.testnet', nonce: 276_231_708_000_017n,
    blockHash: baseEncode(new Uint8Array(crypto.randomBytes(32))), methodName: 'play',
    args: JSON.stringify({ round_id: 7, handle: 'ab'.repeat(32), coins: 10 }), gas: 10n * TGAS,
  };
  const req = signRequestOf(want);
  assert.equal(req.actions[0].deposit, '0');
  const t = txOfRequest(req);
  const nTx = createTransaction(want.signerId, PublicKey.fromString(k.publicKey), want.receiverId, want.nonce, [actions.functionCall('play', Buffer.from(want.args), want.gas, 0n)], baseDecode(want.blockHash));
  assert.deepEqual(Buffer.from(w.encodeTransaction(t)), Buffer.from(nTx.encode()), 'Transaction bytes');
  const nSigned = await new KeyPairSigner(k.nearKeyPair).signTransaction(nTx);
  const wSigned = w.signTransaction(t, k.secret);
  assert.deepEqual(Buffer.from(wSigned.signed), Buffer.from(nSigned.signedTransaction.encode()), 'SignedTransaction bytes');
  assert.equal(wSigned.hash, baseEncode(nSigned.txHash), 'transaction hash');
  const ok = checkSignedTx(wSigned.signed, want);
  assert.ok(ok.ok, ok.ok ? '' : ok.reason);
  assert.equal(ok.ok && ok.hash, wSigned.hash);
  const call = checkSignedTx(w.signTransaction({ ...t, methodName: 'call', args: Buffer.from(JSON.stringify({ round_id: 7, handle: 'ab'.repeat(32), human: true })) }, k.secret).signed, {
    ...want, methodName: 'call', args: JSON.stringify({ round_id: 7, handle: 'ab'.repeat(32), human: true }),
  });
  assert.ok(call.ok, 'a call');

  const other = newKey();
  const refused = (label: string, mutate: (x: FunctionCallTx) => FunctionCallTx, expect: string, key = k) => {
    const r = checkSignedTx(w.signTransaction(mutate({ ...t }), key.secret).signed, want);
    assert.ok(!r.ok, `${label}: refused`);
    assert.equal(r.ok ? '' : r.code, expect, `${label}: ${r.ok ? '' : r.reason}`);
  };
  const args = (o: object) => new TextEncoder().encode(JSON.stringify(o));
  refused('another signer', (x) => ({ ...x, signerId: 'thief.testnet' }), 'wrong_signer');
  refused('another key', (x) => ({ ...x, publicKey: baseDecode(other.publicKey.slice(8)) }), 'wrong_key', other);
  refused('another receiver', (x) => ({ ...x, receiverId: 'evil.testnet' }), 'wrong_receiver');
  refused('another method', (x) => ({ ...x, methodName: 'withdraw' }), 'wrong_method');
  refused('more coins', (x) => ({ ...x, args: args({ round_id: 7, handle: 'ab'.repeat(32), coins: 500 }) }), 'wrong_args');
  refused('another handle', (x) => ({ ...x, args: args({ round_id: 7, handle: 'cd'.repeat(32), coins: 10 }) }), 'wrong_args');
  refused('an extra argument', (x) => ({ ...x, args: args({ round_id: 7, handle: 'ab'.repeat(32), coins: 10, to: 'thief.testnet' }) }), 'wrong_args');
  refused('the same JSON, other bytes', (x) => ({ ...x, args: args({ coins: 10, round_id: 7, handle: 'ab'.repeat(32) }) }), 'wrong_args');
  refused('a deposit', (x) => ({ ...x, deposit: 1n }), 'deposit');
  refused('more gas', (x) => ({ ...x, gas: 300n * TGAS }), 'wrong_gas');
  refused('another nonce', (x) => ({ ...x, nonce: x.nonce + 5n }), 'wrong_nonce');
  refused('another block hash', (x) => ({ ...x, blockHash: new Uint8Array(crypto.randomBytes(32)) }), 'wrong_block');

  // a valid signature of one transaction on another transaction's bytes
  const a = w.signTransaction(t, k.secret);
  const b = w.encodeTransaction({ ...t, nonce: want.nonce }); // same tx bytes, so splice the signature of another one
  const otherSig = w.signTransaction({ ...t, nonce: t.nonce + 1n }, k.secret).signed.subarray(-64);
  const spliced = new Uint8Array(b.length + 65);
  spliced.set(b, 0);
  spliced[b.length] = 0;
  spliced.set(otherSig, b.length + 1);
  const r1 = checkSignedTx(spliced, want);
  assert.ok(!r1.ok && r1.code === 'bad_signature', 'a signature of another transaction');
  const flipped = new Uint8Array(a.signed);
  flipped[flipped.length - 1] ^= 1;
  const r2 = checkSignedTx(flipped, want);
  assert.ok(!r2.ok && r2.code === 'bad_signature', 'one flipped signature bit');
  const r3 = checkSignedTx(new Uint8Array(crypto.randomBytes(200)), want);
  assert.ok(!r3.ok && r3.code === 'bad_encoding', 'random bytes');
  const r4 = checkSignedTx(new Uint8Array([...a.signed, 0]), want);
  assert.ok(!r4.ok, 'trailing bytes');

  // two actions, or a key added instead of a call (near-api-js builds them, the relay refuses them)
  const signer = new KeyPairSigner(k.nearKeyPair);
  const two = await signer.signTransaction(createTransaction(want.signerId, PublicKey.fromString(k.publicKey), want.receiverId, want.nonce, [
    actions.functionCall('play', Buffer.from(want.args), want.gas, 0n), actions.functionCall('play', Buffer.from(want.args), want.gas, 0n),
  ], baseDecode(want.blockHash)));
  const r5 = checkSignedTx(two.signedTransaction.encode(), want);
  assert.ok(!r5.ok && r5.code === 'wrong_action', 'two calls in one transaction');
  const addKey = await signer.signTransaction(createTransaction(want.signerId, PublicKey.fromString(k.publicKey), want.receiverId, want.nonce, [
    actions.addFullAccessKey(PublicKey.fromString(other.publicKey)),
  ], baseDecode(want.blockHash)));
  const r6 = checkSignedTx(addKey.signedTransaction.encode(), want);
  assert.ok(!r6.ok && r6.code === 'wrong_action', 'an AddKey instead of a call');
});

test('mainnet secrets: no faucet, no test users and no coin yet; TEST_MODE=0 ignores test users even when the file has them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-secrets-'));
  const key = () => newKey().nearKeyPair.toString();
  const file = path.join(dir, 'mainnet.json');
  fs.writeFileSync(file, JSON.stringify({
    network: 'mainnet', contractId: 'game.example.near', tokenDecimals: 18,
    operator: { accountId: 'ops.example.near', privateKey: key() }, promo: { accountId: 'promo.example.near', privateKey: key() },
    accounts: { fund: 'fund.example.near', house: 'house.example.near', bots: 'bots.example.near' },
  }));
  const s = readSecrets(file);
  assert.deepEqual(s.testUsers, []);
  assert.equal(s.rpc[0], 'https://free.rpc.fastnear.com', 'mainnet RPC by default');
  const c = new NearChain(s, { withTestUsers: false });
  assert.equal(c.network, 'mainnet');
  assert.equal(c.tokenId, '', 'the coin comes from the contract once it is set');
  assert.equal(c.accounts.faucet, '');
  assert.equal(c.testUsers.length, 0);
  const t = path.join(dir, 'testnet.json');
  fs.writeFileSync(t, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), network: 'testnet', testUsers: [{ accountId: 'ana.example.testnet', label: 'Ana', privateKey: key() }] }));
  assert.equal(new NearChain(readSecrets(t), { withTestUsers: true }).testUsers.length, 1);
  assert.equal(new NearChain(readSecrets(t), { withTestUsers: false }).testUsers.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mock chain: a play key signs plays and calls with fresh nonces; other methods, deposits, unknown keys and an empty allowance are refused like NEAR does', async () => {
  const w = await loadWebTx();
  const chain = new MockChain();
  chain.txLatencyMs = 0;
  const acct = 'player.testnet';
  const secret = 'f'.repeat(64);
  assert.ok((await chain.startRound(1, sha256Hex(secret), Date.now() + 60_000)).ok);
  chain.mintToWallet(acct, 100n * chain.coinUnit);
  assert.ok((await chain.walletDeposit(acct, 50n * chain.coinUnit)).ok, 'a deposit from the wallet');
  assert.equal(await chain.balanceOf(acct), 50n * chain.coinUnit);
  const k = newKey();
  chain.addKey(acct, k.publicKey, { receiverId: chain.contractId, methodNames: ['play', 'call'], allowance: '250000000000000000000000' });
  const view = (await chain.viewAccessKey(acct, k.publicKey))!;
  const handle = 'ab'.repeat(32);
  const tx = (method: string, args: object, nonce: bigint, extra: Partial<FunctionCallTx> = {}): Uint8Array =>
    w.signTransaction({
      signerId: acct, publicKey: baseDecode(k.publicKey.slice(8)), nonce, receiverId: chain.contractId, blockHash: baseDecode(view.blockHash),
      methodName: method, args: new TextEncoder().encode(JSON.stringify(args)), gas: 10n * TGAS, deposit: 0n, ...extra,
    }, k.secret).signed;
  const play = tx('play', { round_id: 1, handle, coins: 10 }, view.nonce + 1n);
  const r = await chain.sendSignedTx(play, acct, 'play');
  assert.ok(r.ok, r.error ?? '');
  assert.equal((await chain.getPlay(1, handle))?.account, acct, 'the play is the signer\'s');
  assert.equal((await chain.sendSignedTx(play, acct, 'play')).code, 'nonce', 'the same bytes again');
  assert.ok((await chain.sendSignedTx(tx('call', { round_id: 1, handle, human: false }, view.nonce + 3n), acct, 'call')).ok, 'a call; nonces may skip');
  assert.equal((await chain.getPlay(1, handle))?.call, false);
  const wd = await chain.sendSignedTx(tx('withdraw', { amount: '1' }, view.nonce + 4n), acct, 'withdraw');
  assert.ok(!wd.ok && /MethodNameMismatch/.test(wd.error ?? ''), 'a play key cannot withdraw');
  const dep = await chain.sendSignedTx(tx('play', { round_id: 1, handle: 'cd'.repeat(32), coins: 5 }, view.nonce + 5n, { deposit: 1n }), acct, 'play');
  assert.ok(!dep.ok && /Deposit/.test(dep.error ?? ''), 'no deposit');
  const stranger = newKey();
  const unk = w.signTransaction({ signerId: acct, publicKey: baseDecode(stranger.publicKey.slice(8)), nonce: 1n, receiverId: chain.contractId, blockHash: baseDecode(view.blockHash), methodName: 'play', args: new TextEncoder().encode('{}'), gas: 10n * TGAS, deposit: 0n }, stranger.secret).signed;
  assert.equal((await chain.sendSignedTx(unk, acct, 'play')).code, 'key', 'a key the account does not have');
  const poor = newKey();
  chain.addKey(acct, poor.publicKey, { receiverId: chain.contractId, methodNames: ['play', 'call'], allowance: '1000' });
  const pv = (await chain.viewAccessKey(acct, poor.publicKey))!;
  const broke = w.signTransaction({ signerId: acct, publicKey: baseDecode(poor.publicKey.slice(8)), nonce: pv.nonce + 1n, receiverId: chain.contractId, blockHash: baseDecode(pv.blockHash), methodName: 'play', args: new TextEncoder().encode(JSON.stringify({ round_id: 1, handle: 'ef'.repeat(32), coins: 5 })), gas: 10n * TGAS, deposit: 0n }, poor.secret).signed;
  assert.equal((await chain.sendSignedTx(broke, acct, 'play')).code, 'allowance', 'out of gas allowance');
  // withdraw from the wallet: an account not registered on the coin gets its coins back in the game
  const fresh = 'fresh.testnet';
  assert.ok((await chain.transfer(acct, fresh, 5n * chain.coinUnit)).ok);
  await chain.walletWithdraw(fresh, 5n * chain.coinUnit);
  assert.equal(await chain.balanceOf(fresh), 5n * chain.coinUnit, 'an unregistered account keeps its coins');
  chain.registerOnToken(fresh);
  assert.ok((await chain.walletWithdraw(fresh, 5n * chain.coinUnit)).ok);
  assert.equal(chain.walletBalance(fresh), 5n * chain.coinUnit, 'a registered one gets them in its wallet');
  // no coin yet (mainnet before REAL launches)
  chain.coinsOpen = false;
  assert.equal((await chain.getConfig()).coinsOpen, false);
  assert.ok(!(await chain.walletDeposit(acct, 1n)).ok, 'no deposits without a coin');
});
