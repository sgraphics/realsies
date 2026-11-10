#!/usr/bin/env node
// Launches the REAL token straight into a Rhea (Ref) concentrated pool, with no NEAR from us.
// On mainnet this spends real NEAR and its last step cannot be undone.
//
//   token      real.<owner>        near-examples FT (contracts/test-token/fungible_token.wasm): fixed supply, no minting
//   liquidity  liquidity.<owner>   gets the whole supply at the token's init, funds the vault, puts the rest in the
//                                  pool as ONE token-only position, and in the end loses its keys: the position
//                                  can never be taken out
//   vault      vault.<owner>       contracts/vault: the team share; a cliff, then a linear release to <team>; no owner
//
// Usage:  node scripts/launch-real.mjs <step> [<step> ...]
//   plan       print the plan and the numbers; sends nothing (the default)
//   pool       create liquidity.<owner>, then the pool at the start price. Before the token exists on purpose:
//              whoever creates a pool first sets its price, and nobody knows the token's name yet
//   token      create real.<owner>, deploy and initialise it (the whole supply goes to liquidity.<owner>)
//   liquidity  register, deposit, preview, add the position; stops if the preview is not exactly token-only
//   vault      create vault.<owner>, deploy and initialise it, fund it with ft_transfer_call
//   register   storage on the token for the accounts in REGISTER (the game's accounts)
//   check      read everything back from the chain: supply, balances, pool, position, vault, keys, quotes
//   lock       LOCK=yes: send the liquidity account's spare NEAR home, then delete every key of the token,
//              the vault and the liquidity account. From then on nobody can change or move anything
// Every step reads the chain first and skips what is done, so a run that stopped can simply be started again.
//
// Settings (environment):
//   NET=testnet|mainnet (default testnet)   OWNER (mainnet default realsies.near; on testnet a funded faucet account)
//   REAL_PER_NEAR (4000000)   TEAM_BPS (2000 = 20%)   CLIFF_MS, VEST_MS (mainnet 7 and 21 days; testnet 2 and 4 minutes)
//   FEE (2000 = 0.2%)   RIGHT (500000)   TEAM (the vault's beneficiary, default OWNER)   REGISTER (comma list)
//   OWNER_KEY  a key file with full access to OWNER for the three account creations (near-cli format:
//              {"public_key","private_key"}); without it the CLI's legacy keychain signs for OWNER
//   GO=mainnet is required for every sending step on mainnet.
// Sub-account keys are made by the CLI and stay in its legacy keychain. The CLI's full output goes to
// relay/.secrets/launch-real-<net>.log (gitignored); the console shows transaction ids and what was checked.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const NET = env.NET ?? 'testnet';
if (NET !== 'mainnet' && NET !== 'testnet') die('NET must be mainnet or testnet');
const MAIN = NET === 'mainnet';
const CONN = env.CONN ?? (MAIN ? 'mainnet-fast' : 'testnet');
const RPCS = MAIN ? ['https://rpc.mainnet.fastnear.com', 'https://free.rpc.fastnear.com'] : ['https://test.rpc.fastnear.com', 'https://rpc.testnet.fastnear.com'];
const NEAR_BIN = env.NEAR ?? join(ROOT, '.tooling', 'bin', process.platform === 'win32' ? 'near.exe' : 'near');
const DEX = env.DEX ?? (MAIN ? 'dclv2.ref-labs.near' : 'dclv2.ref-dev.testnet');
const WRAP = env.WRAP ?? (MAIN ? 'wrap.near' : 'wrap.testnet');
const OWNER = env.OWNER ?? (MAIN ? 'realsies.near' : die('set OWNER to a funded testnet account'));
const TOKEN = env.TOKEN ?? `real.${OWNER}`;
const LP = env.LP ?? `liquidity.${OWNER}`;
const VAULT = env.VAULT ?? `vault.${OWNER}`;
const TEAM = env.TEAM ?? OWNER;
const REGISTER = (env.REGISTER ?? (MAIN ? 'game.realsies.near,promo.realsies.near,fund.realsies.near,house.realsies.near,bots.realsies.near' : '')).split(',').map((s) => s.trim()).filter(Boolean);

const DECIMALS = 18;
const SUPPLY = 10n ** 27n; // 1,000,000,000 tokens
const TEAM_BPS = BigInt(env.TEAM_BPS ?? 2000);
if (TEAM_BPS < 0n || TEAM_BPS >= 10000n) die('TEAM_BPS must be 0..9999');
const TEAM_AMT = (SUPPLY * TEAM_BPS) / 10000n;
const POOL_AMT = SUPPLY - TEAM_AMT;
const REAL_PER_NEAR = Number(env.REAL_PER_NEAR ?? 4_000_000);
if (!(REAL_PER_NEAR > 0)) die('REAL_PER_NEAR must be positive');
const FEE = Number(env.FEE ?? 2000);
const DELTA = { 100: 1, 400: 8, 2000: 40, 10000: 200 }[FEE] ?? die('FEE must be 100, 400, 2000 or 10000');
// the pool's price is yocto-wNEAR per smallest token unit = 1.0001^point; for an 18-decimal token that is NEAR per token * 1e6
const LEFT = Math.floor(Math.log(1e6 / REAL_PER_NEAR) / Math.log(1.0001) / DELTA) * DELTA;
const INIT = LEFT - 1; // the pool starts one point under the position, or the position would need wNEAR
const RIGHT = Number(env.RIGHT ?? 500000); // what mainnet launchpads use; wider ranges hit a rounding panic in the pool contract
const POOL_ID = `${TOKEN}|${WRAP}|${FEE}`;
const DAY = 86_400_000;
const CLIFF_MS = BigInt(env.CLIFF_MS ?? (MAIN ? 7 * DAY : 120_000));
const VEST_MS = BigInt(env.VEST_MS ?? (MAIN ? 21 * DAY : 240_000));
const TOKEN_NEAR = env.TOKEN_NEAR ?? '3.2'; // 281 KB of code is 2.81 NEAR of storage
const LP_NEAR = env.LP_NEAR ?? '1.0'; // 0.5 pool-contract storage, registrations, gas; the spare goes home at lock
const VAULT_NEAR = env.VAULT_NEAR ?? '1.6'; // 128 KB of code is 1.29 NEAR of storage
const GAS_DEPOSIT = env.GAS_DEPOSIT ?? (MAIN ? '300' : '1000'); // the testnet pool contract burns about 920 Tgas on a Deposit
const FT_WASM = join(ROOT, 'contracts', 'test-token', 'fungible_token.wasm');
const VAULT_WASM = join(ROOT, 'contracts', 'vault', 'realsies_vault.wasm');
const ICON = join(ROOT, 'scripts', 'assets', 'realsies-coin-160.png');
const LOG = join(ROOT, 'relay', '.secrets', `launch-real-${NET}.log`);
const META = {
  spec: 'ft-1.0.0',
  name: env.TOKEN_NAME ?? (MAIN ? 'Realsies' : 'Realsies Dress Rehearsal'),
  symbol: env.TOKEN_SYMBOL ?? (MAIN ? 'REAL' : 'dREAL'),
  decimals: DECIMALS,
};

function die(msg) {
  console.error(`\nSTOP: ${msg}`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => console.log(`\n== ${s}`);
const ok = (s) => console.log(`   ok  ${s}`);
const note = (s) => console.log(`   ..  ${s}`);
const tokens = (u) => {
  const s = BigInt(u).toString().padStart(DECIMALS + 1, '0');
  const whole = s.slice(0, -DECIMALS).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = s.slice(-DECIMALS).replace(/0+$/, '').slice(0, 6);
  return frac ? `${whole}.${frac}` : whole;
};
const nearOf = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(4);
const priceAt = (point) => 1.0001 ** point / 1e6; // NEAR per token
const span = (ms) => (Number(ms) >= DAY ? `${Number(ms) / DAY} days` : `${Number(ms) / 60_000} minutes`);

// ---------- chain reads ----------
async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const d = await r.json();
      if (d.result !== undefined) return d.result;
      last = d.error;
      if (d.error?.cause?.name) return { __error: d.error.cause.name, detail: d.error };
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`RPC ${method} failed: ${JSON.stringify(last)?.slice(0, 300)}`);
}
/** A view call; undefined when the contract or method is missing or the call panics. */
async function view(contract, method, args = {}) {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (r.__error || r.error || !r.result) return undefined;
  return JSON.parse(Buffer.from(r.result).toString());
}
async function viewError(contract, method, args = {}) {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  return r.error ?? (r.__error ? JSON.stringify(r.detail) : undefined);
}
async function account(id) {
  const r = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: id });
  return r.__error ? null : r;
}
async function keysOf(id) {
  const r = await rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: id });
  return r.__error ? [] : r.keys.map((k) => k.public_key);
}
const balanceOf = async (id) => BigInt((await view(TOKEN, 'ft_balance_of', { account_id: id })) ?? '0');
const registered = async (id) => !!(await view(TOKEN, 'storage_balance_of', { account_id: id }));
/** Waits until `fn` is truthy (the chain needs a moment after a transaction). */
async function until(what, fn, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    await sleep(1500);
  }
  die(`${what}: not seen on chain after ${tries * 1.5} s. Look at ${LOG}, then run the step again.`);
}

// ---------- chain writes (through near-cli-rs) ----------
const SIGN_KEYCHAIN = ['sign-with-legacy-keychain', 'send'];
const SIGN_OWNER = env.OWNER_KEY ? ['sign-with-access-key-file', env.OWNER_KEY, 'send'] : SIGN_KEYCHAIN;
function guard() {
  if (MAIN && env.GO !== 'mainnet') die('this step sends mainnet transactions: set GO=mainnet once the plan is confirmed');
}
function near(args, what) {
  guard();
  mkdirSync(dirname(LOG), { recursive: true });
  const r = spawnSync(NEAR_BIN, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  appendFileSync(LOG, `\n\n=== ${new Date().toISOString()} ${what}\n${out}`);
  const tx = /Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{32,})/.exec(out)?.[1];
  if (r.status !== 0 || /Error:|panicked/.test(out)) {
    const why = out.split('\n').filter((l) => /Error|error|panicked|Failure|E\d{3}/.test(l)).slice(0, 4).join('\n      ');
    throw new Error(`${what} failed${tx ? ` (tx ${tx})` : ''}:\n      ${why || `exit ${r.status}`}`);
  }
  console.log(`   tx  ${tx ?? '(no id printed)'}  ${what}`);
  return tx;
}
const call = (contract, method, args, { as, gas = '30', deposit = '0 NEAR' }, what) =>
  near(['contract', 'call-function', 'as-transaction', contract, method, 'json-args', JSON.stringify(args), 'prepaid-gas', `${gas} Tgas`, 'attached-deposit', deposit, 'sign-as', as, 'network-config', CONN, ...(as === OWNER ? SIGN_OWNER : SIGN_KEYCHAIN)], what);
async function createAccount(id, amount) {
  if (await account(id)) return ok(`${id} exists`);
  near(['account', 'create-account', 'fund-myself', id, `${amount} NEAR`, 'autogenerate-new-keypair', 'save-to-legacy-keychain', 'sign-as', OWNER, 'network-config', CONN, ...SIGN_OWNER], `create ${id} with ${amount} NEAR`);
  await until(`${id} created`, () => account(id));
}
async function storageFor(id, payer) {
  if (await registered(id)) return ok(`${id} is registered on the token`);
  const min = (await view(TOKEN, 'storage_balance_bounds'))?.min ?? '1250000000000000000000';
  call(TOKEN, 'storage_deposit', { account_id: id, registration_only: true }, { as: payer, deposit: `${min} yoctoNEAR` }, `register ${id} on the token`);
  await until(`${id} registered`, () => registered(id));
}
/**
 * Prepaid gas is charged up front at a pessimistic price (about 0.001 NEAR per Tgas, most of it refunded), so a
 * 1000 Tgas call needs about 1 NEAR lying in the account for a moment. The owner tops the account up if it is short.
 */
async function ensureGasMoney(id, tgas) {
  const a = await account(id);
  const free = BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n;
  const need = BigInt(tgas) * 11n * 10n ** 20n + 5n * 10n ** 22n;
  if (free >= need) return;
  const add = need - free;
  near(['tokens', OWNER, 'send-near', id, `${add} yoctoNEAR`, 'network-config', CONN, ...SIGN_OWNER], `top up ${id} with ${nearOf(add)} NEAR for the gas of the next call`);
  await sleep(2500);
}
const codeHashOf = (file) => {
  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(`0x${createHash('sha256').update(readFileSync(file)).digest('hex')}`);
  let s = '';
  while (n > 0n) {
    s = ALPHA[Number(n % 58n)] + s;
    n /= 58n;
  }
  return s;
};
const hasCode = (a) => !!a && a.code_hash !== '11111111111111111111111111111111';

// ---------- steps ----------
async function plan() {
  say(`plan for ${NET}`);
  const o = await account(OWNER);
  const rows = [
    ['owner (pays, signs the three account creations)', `${OWNER}${o ? `, ${nearOf(o.amount)} NEAR` : ' (does not exist!)'}`],
    ['token', `${TOKEN}: "${META.name}", ${META.symbol}, ${DECIMALS} decimals, supply ${tokens(SUPPLY)}, fixed`],
    ['liquidity account', `${LP} (its keys are deleted at lock)`],
    ['vault', `${VAULT}: ${tokens(TEAM_AMT)} ${META.symbol} (${Number(TEAM_BPS) / 100}%) for ${TEAM}`],
    ['vault schedule', `nothing for ${span(CLIFF_MS)}, then linear over ${span(VEST_MS)} (from the vault's deploy)`],
    ['pool', `${POOL_ID} on ${DEX}`],
    ['in the pool', `${tokens(POOL_AMT)} ${META.symbol} as one position, points ${LEFT} to ${RIGHT}, no NEAR`],
    ['pool created at', `point ${INIT}`],
    ['start price', `${priceAt(LEFT).toExponential(4)} NEAR per ${META.symbol} = ${Math.round(1 / priceAt(LEFT)).toLocaleString('en-US')} ${META.symbol} per NEAR (asked: ${REAL_PER_NEAR.toLocaleString('en-US')})`],
    ['whole supply at the start price', `${(priceAt(LEFT) * 1e9).toFixed(1)} NEAR`],
    ['depth', `behaves like ${((Number(POOL_AMT / 10n ** 18n)) * priceAt(LEFT)).toFixed(1)} NEAR against the tokens: 1 NEAR buys about ${Math.round((Number(POOL_AMT / 10n ** 18n) * 1) / (Number(POOL_AMT / 10n ** 18n) * priceAt(LEFT) + 1)).toLocaleString('en-US')} ${META.symbol}`],
    ['NEAR needed from the owner', `${TOKEN_NEAR} + ${LP_NEAR} + ${VAULT_NEAR} = ${(Number(TOKEN_NEAR) + Number(LP_NEAR) + Number(VAULT_NEAR)).toFixed(1)} NEAR (storage; the liquidity account's spare comes back at lock)`],
    ['registered on the token', REGISTER.length ? REGISTER.join(', ') : '(none)'],
    ['files', `${existsSync(FT_WASM) ? 'ok' : 'MISSING'} token wasm, ${existsSync(VAULT_WASM) ? 'ok' : 'MISSING'} vault wasm (${existsSync(VAULT_WASM) ? codeHashOf(VAULT_WASM) : '-'}), ${existsSync(ICON) ? 'ok' : 'MISSING'} icon`],
  ];
  for (const [k, v] of rows) console.log(`   ${k.padEnd(48)} ${v}`);
  if (TOKEN >= WRAP) die(`${TOKEN} does not sort before ${WRAP}: the token would be token_y and every number here mirrors. Not supported.`);
  const p = await view(DEX, 'get_pool', { pool_id: POOL_ID });
  console.log(`   ${'on chain now'.padEnd(48)} token ${(await account(TOKEN)) ? 'exists' : 'not yet'}, liquidity account ${(await account(LP)) ? 'exists' : 'not yet'}, vault ${(await account(VAULT)) ? 'exists' : 'not yet'}, pool ${p ? `exists at point ${p.current_point}` : 'not yet'}`);
}

async function ensurePool() {
  let p = await view(DEX, 'get_pool', { pool_id: POOL_ID });
  if (!p) {
    try {
      call(DEX, 'create_pool', { token_a: TOKEN, token_b: WRAP, fee: FEE, init_point: INIT }, { as: LP, gas: '180', deposit: '0.1 NEAR' }, `create the pool at point ${INIT}`);
    } catch (e) {
      if (await account(TOKEN)) throw e;
      note(`the pool cannot be created before the token exists here (${String(e.message).split('\n')[1]?.trim() ?? 'refused'}); the token step creates it right after the deploy`);
      return false;
    }
    p = await until('pool created', () => view(DEX, 'get_pool', { pool_id: POOL_ID }));
  }
  if (p.point_delta !== DELTA) die(`the pool's point_delta is ${p.point_delta}, expected ${DELTA}`);
  // an empty pool's price is nobody's: a stop-point swap moves it for free (tested on testnet), so a point that is
  // not ours is no harm; the liquidity step moves it back under the position right before the tokens go in
  if (BigInt(p.total_liquidity ?? '0') === 0n && p.current_point !== INIT) note(`the empty pool sits at point ${p.current_point}, not ${INIT}; the liquidity step moves it first`);
  ok(`pool ${POOL_ID} at point ${p.current_point}`);
  return true;
}

/**
 * The empty pool back under the position. Anyone can push an empty pool's point with a SwapByStopPoint (it costs
 * nothing: no liquidity, nothing is swapped); the same call from the token side brings it down to INIT again.
 */
async function pointUnderPosition() {
  let p = await view(DEX, 'get_pool', { pool_id: POOL_ID });
  if (p.current_point < LEFT) return p;
  if (BigInt(p.total_liquidity ?? '0') !== 0n) die(`the pool is at point ${p.current_point} and somebody else has liquidity in it: a token-only position from ${LEFT} is not possible as it stands. Look at get_pool and list the positions before going on.`);
  if ((await balanceOf(LP)) < 10n ** 18n) die(`the empty pool is at point ${p.current_point}; moving it needs one token in ${LP}'s wallet, and it holds none (withdraw_asset one from the pool contract, then run again)`);
  await ensureGasMoney(LP, 250);
  call(TOKEN, 'ft_transfer_call', { receiver_id: DEX, amount: (10n ** 18n).toString(), msg: JSON.stringify({ SwapByStopPoint: { pool_id: POOL_ID, stop_point: INIT, skip_unwrap_near: true } }) }, { as: LP, gas: '250', deposit: '1 yoctoNEAR' }, `move the empty pool from point ${p.current_point} back to ${INIT}`);
  for (let i = 0; i < 10; i++) {
    await sleep(1500);
    p = await view(DEX, 'get_pool', { pool_id: POOL_ID });
    if (p.current_point < LEFT) return p;
  }
  die(`the pool is still at point ${p.current_point}`);
}

async function stepPool() {
  say('liquidity account and pool');
  await createAccount(LP, LP_NEAR);
  await ensurePool();
}

async function stepToken() {
  say('token');
  if (!existsSync(FT_WASM) || !existsSync(ICON)) die('token wasm or icon missing');
  await createAccount(LP, LP_NEAR);
  await createAccount(TOKEN, TOKEN_NEAR);
  if (!hasCode(await account(TOKEN))) {
    const icon = `data:image/png;base64,${readFileSync(ICON).toString('base64')}`;
    near(
      ['contract', 'deploy', TOKEN, 'use-file', FT_WASM, 'with-init-call', 'new', 'json-args', JSON.stringify({ owner_id: LP, total_supply: SUPPLY.toString(), metadata: { ...META, icon } }), 'prepaid-gas', '100 Tgas', 'attached-deposit', '0 NEAR', 'network-config', CONN, ...SIGN_KEYCHAIN],
      `deploy ${TOKEN} and mint ${tokens(SUPPLY)} to ${LP}`,
    );
    await until('token deployed', async () => hasCode(await account(TOKEN)));
  }
  await ensurePool();
  const m = await until('token metadata', () => view(TOKEN, 'ft_metadata'));
  const total = BigInt(await view(TOKEN, 'ft_total_supply'));
  if (m.symbol !== META.symbol || m.decimals !== DECIMALS || total !== SUPPLY) die(`token reads back wrong: ${m.symbol}, ${m.decimals} decimals, supply ${total}`);
  ok(`${TOKEN}: ${m.name}, ${m.symbol}, supply ${tokens(total)}, icon ${m.icon ? `${m.icon.length} chars` : 'none'}`);
}

async function position() {
  return ((await view(DEX, 'list_liquidities', { account_id: LP })) ?? []).find((l) => l.pool_id === POOL_ID);
}

async function stepLiquidity() {
  say('liquidity');
  if (!hasCode(await account(TOKEN))) die('run the token step first');
  if (!(await ensurePool())) die('no pool');
  const have = await position();
  if (have) {
    ok(`position ${have.lpt_id} exists: points ${have.left_point} to ${have.right_point}`);
    return;
  }
  await storageFor(DEX, LP);
  if (!(await view(DEX, 'storage_balance_of', { account_id: LP }))) {
    const min = (await view(DEX, 'storage_balance_bounds'))?.min ?? '500000000000000000000000';
    call(DEX, 'storage_deposit', { account_id: LP, registration_only: true }, { as: LP, deposit: `${min} yoctoNEAR` }, `pool-contract storage for ${LP} (${nearOf(min)} NEAR, held)`);
    await until('pool-contract storage', () => view(DEX, 'storage_balance_of', { account_id: LP }));
  } else ok(`${LP} has pool-contract storage`);
  if (MAIN) {
    // launchpads call this before the first deposit of a new token; the testnet contract does not have it
    try {
      call(DEX, 'register_tokens', { token_ids: [TOKEN] }, { as: LP, deposit: '0.02 NEAR' }, 'register the token on the pool contract');
    } catch (e) {
      note(`register_tokens: ${String(e.message).split('\n')[1]?.trim() ?? e.message} (going on; the deposit below shows whether it mattered)`);
    }
  }
  const inDex = async () => BigInt(((await view(DEX, 'list_user_assets', { account_id: LP })) ?? {})[TOKEN] ?? '0');
  // while the tokens are still in the wallet: the pool's point must be under the position
  await pointUnderPosition();
  let held = await inDex();
  if (held < POOL_AMT) {
    const lpBal = await balanceOf(LP);
    if (lpBal < POOL_AMT - held) die(`${LP} holds ${tokens(lpBal)}, needs ${tokens(POOL_AMT - held)} for the pool`);
    await ensureGasMoney(LP, Number(GAS_DEPOSIT));
    call(TOKEN, 'ft_transfer_call', { receiver_id: DEX, amount: (POOL_AMT - held).toString(), msg: '"Deposit"' }, { as: LP, gas: GAS_DEPOSIT, deposit: '1 yoctoNEAR' }, `deposit ${tokens(POOL_AMT - held)} into the pool contract`);
    for (let i = 0; i < 10 && held < POOL_AMT; i++) {
      await sleep(1500);
      held = await inDex();
    }
    // a refused deposit still shows "success" at the top level and the tokens come back: only this balance tells
    if (held < POOL_AMT) die(`the deposit did not arrive (the pool contract holds ${tokens(held)} for ${LP}). Run again with GAS_DEPOSIT=1000.`);
  }
  ok(`the pool contract holds ${tokens(held)} for ${LP}`);
  const p = await view(DEX, 'get_pool', { pool_id: POOL_ID });
  if (p.current_point >= LEFT) die(`the pool moved to point ${p.current_point} while the tokens were being deposited: a token-only position is not possible there. The tokens are safe in the pool contract for ${LP}; take one out with withdraw_asset and run this step again.`);
  const args ={ pool_id: POOL_ID, left_point: LEFT, right_point: RIGHT, amount_x: POOL_AMT.toString(), amount_y: '0' };
  const pre = await view(DEX, 'predict_add_liquidity', args);
  if (!pre) die(`the preview failed: ${await viewError(DEX, 'predict_add_liquidity', args)}`);
  if (pre.need_y !== '0') die(`the preview wants ${pre.need_y} wNEAR: the position would not be token-only`);
  if (BigInt(pre.need_x) > POOL_AMT) die(`the preview needs ${pre.need_x}, more than the ${POOL_AMT} offered: the add would panic. Try RIGHT=400000.`);
  ok(`preview: needs ${tokens(pre.need_x)} tokens and 0 wNEAR`);
  await ensureGasMoney(LP, 300);
  call(DEX, 'add_liquidity', { ...args, min_amount_x: '0', min_amount_y: '0' }, { as: LP, gas: '300' }, 'add the position');
  const pos = await until('position', position);
  const after = await view(DEX, 'get_pool', { pool_id: POOL_ID });
  ok(`position ${pos.lpt_id}: points ${pos.left_point} to ${pos.right_point}; pool holds ${tokens(after.total_x)} tokens and ${nearOf(after.total_y)} wNEAR`);
  const dust = await inDex();
  if (dust > 0n) note(`${tokens(dust)} tokens of rounding dust stay in the pool contract for ${LP}`);
}

async function stepVault() {
  say('vault');
  if (!existsSync(VAULT_WASM)) die('vault wasm missing');
  if (!hasCode(await account(TOKEN))) die('run the token step first');
  await createAccount(VAULT, VAULT_NEAR);
  await storageFor(VAULT, LP);
  await storageFor(TEAM, LP);
  if (!hasCode(await account(VAULT))) {
    near(
      ['contract', 'deploy', VAULT, 'use-file', VAULT_WASM, 'with-init-call', 'new', 'json-args', JSON.stringify({ token: TOKEN, beneficiary: TEAM, cliff_ms: CLIFF_MS.toString(), vesting_ms: VEST_MS.toString() }), 'prepaid-gas', '30 Tgas', 'attached-deposit', '0 NEAR', 'network-config', CONN, ...SIGN_KEYCHAIN],
      `deploy ${VAULT}`,
    );
    await until('vault deployed', () => view(VAULT, 'get_info'));
  }
  const a = await account(VAULT);
  if (a.code_hash !== codeHashOf(VAULT_WASM)) die(`${VAULT} runs code ${a.code_hash}, not this build (${codeHashOf(VAULT_WASM)})`);
  let info = await view(VAULT, 'get_info');
  if (info.token !== TOKEN || info.beneficiary !== TEAM) die(`vault reads back wrong: token ${info.token}, beneficiary ${info.beneficiary}`);
  if (BigInt(info.total) < TEAM_AMT) {
    // ft_transfer_call, never plain ft_transfer: the vault counts only what arrives through ft_on_transfer
    call(TOKEN, 'ft_transfer_call', { receiver_id: VAULT, amount: (TEAM_AMT - BigInt(info.total)).toString(), msg: '' }, { as: LP, gas: '100', deposit: '1 yoctoNEAR' }, `fund the vault with ${tokens(TEAM_AMT - BigInt(info.total))}`);
    info = await until('vault funded', async () => {
      const i = await view(VAULT, 'get_info');
      return BigInt(i.total) >= TEAM_AMT ? i : undefined;
    });
  }
  ok(`vault holds ${tokens(info.total)} for ${info.beneficiary}: nothing before ${new Date(info.start_ms + info.cliff_ms).toISOString()}, everything by ${new Date(info.fully_released_at_ms).toISOString()}`);
}

async function stepRegister() {
  say('registrations on the token');
  if (!REGISTER.length) return note('REGISTER is empty');
  for (const id of REGISTER) {
    if (!(await account(id))) die(`${id} does not exist`);
    await storageFor(id, LP);
  }
}

async function check() {
  say(`check (${NET})`);
  const problems = [];
  const bad = (s) => {
    problems.push(s);
    console.log(`   !!  ${s}`);
  };
  const m = await view(TOKEN, 'ft_metadata');
  if (!m) return bad(`${TOKEN} is not a token yet`), problems;
  const total = BigInt(await view(TOKEN, 'ft_total_supply'));
  console.log(`   token      ${TOKEN}: ${m.name}, ${m.symbol}, ${m.decimals} decimals, supply ${tokens(total)}`);
  if (total !== SUPPLY) bad(`supply is ${total}, expected ${SUPPLY}`);
  const [lpBal, vaultBal, dexBal, teamBal] = await Promise.all([balanceOf(LP), balanceOf(VAULT), balanceOf(DEX), balanceOf(TEAM)]);
  console.log(`   balances   pool contract ${tokens(dexBal)}, vault ${tokens(vaultBal)}, liquidity account ${tokens(lpBal)}, team ${tokens(teamBal)}`);
  // adding the position hands back a few smallest units of rounding dust; anything more is a mistake
  if (lpBal > 10n ** 12n) bad(`${LP} still holds ${tokens(lpBal)} tokens`);
  else if (lpBal > 0n) console.log(`   dust       ${LP} keeps ${lpBal} smallest units (${Number(lpBal) / 1e18} ${m.symbol}) of rounding dust, locked with it`);
  const left = ((await view(DEX, 'list_user_assets', { account_id: LP })) ?? {})[TOKEN];
  if (left && BigInt(left) > 10n ** 12n) bad(`${tokens(left)} tokens sit in the pool contract outside the position`);
  const p = await view(DEX, 'get_pool', { pool_id: POOL_ID });
  const pos = await position();
  if (!p || !pos) bad('no pool or no position');
  else {
    console.log(`   pool       ${POOL_ID}: point ${p.current_point} (${priceAt(p.current_point).toExponential(4)} NEAR per token), holds ${tokens(p.total_x)} tokens and ${nearOf(p.total_y)} wNEAR`);
    console.log(`   position   ${pos.lpt_id}, owner ${pos.owner_id}, points ${pos.left_point} to ${pos.right_point}`);
    if (pos.owner_id !== LP || pos.left_point !== LEFT || pos.right_point !== RIGHT) bad('the position is not the planned one');
    for (const n of ['1', '10']) {
      const q = await view(DEX, 'quote', { pool_ids: [POOL_ID], input_token: WRAP, output_token: TOKEN, input_amount: (BigInt(n) * 10n ** 24n).toString(), tag: 'check' });
      console.log(`   quote      ${n} NEAR buys ${q ? tokens(q.amount) : '?'} ${m.symbol}`);
    }
  }
  const info = await view(VAULT, 'get_info');
  if (!info) bad('no vault');
  else {
    console.log(`   vault      ${VAULT}: ${tokens(info.total)} for ${info.beneficiary}, claimed ${tokens(info.claimed)}; cliff ends ${new Date(info.start_ms + info.cliff_ms).toISOString()}, all released ${new Date(info.fully_released_at_ms).toISOString()}`);
    if (BigInt(info.total) !== TEAM_AMT) bad(`the vault counts ${info.total}, expected ${TEAM_AMT}`);
    if (vaultBal < BigInt(info.total) - BigInt(info.claimed)) bad('the vault holds fewer tokens than it owes');
    if (info.token !== TOKEN || info.beneficiary !== TEAM) bad('the vault has another token or beneficiary');
    if ((await account(VAULT)).code_hash !== codeHashOf(VAULT_WASM)) bad('the vault runs other code than this build');
  }
  for (const id of [TEAM, ...REGISTER]) if (!(await registered(id))) bad(`${id} is not registered on the token`);
  for (const id of [TOKEN, VAULT, LP]) {
    const k = await keysOf(id);
    console.log(`   keys       ${id}: ${k.length ? `${k.length} (not locked yet)` : 'none: locked'}`);
  }
  console.log(problems.length ? `\n   ${problems.length} problem(s)` : '\n   all as planned');
  return problems;
}

async function lock() {
  say('lock');
  if (env.LOCK !== 'yes') die('lock deletes every key of the token, the vault and the liquidity account. It cannot be undone. Set LOCK=yes to do it.');
  const problems = await check();
  if (problems.length) die('the check found problems: nothing was locked');
  say('locking');
  const a = await account(LP);
  if ((await keysOf(LP)).length) {
    // what the account must keep: its storage (1e19 yocto per byte) and a little for the last transaction
    const spare = BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n - 5n * 10n ** 22n;
    if (spare > 5n * 10n ** 22n) {
      near(['tokens', LP, 'send-near', OWNER, `${spare} yoctoNEAR`, 'network-config', CONN, ...SIGN_KEYCHAIN], `send ${nearOf(spare)} spare NEAR from ${LP} to ${OWNER}`);
      await sleep(2500);
    }
  }
  for (const id of [LP, VAULT, TOKEN]) {
    const k = await keysOf(id);
    if (!k.length) {
      ok(`${id} has no keys`);
      continue;
    }
    near(['account', 'delete-keys', id, 'public-keys', k.join(','), 'network-config', CONN, ...SIGN_KEYCHAIN], `delete ${k.length} key(s) of ${id}`);
    await until(`${id} without keys`, async () => (await keysOf(id)).length === 0);
    ok(`${id} has no keys`);
  }
  await check();
  say('next');
  console.log(`   game contract (set once, the owner confirms the values first):  set_token ${TOKEN}   set_coin_unit <token units per coin>`);
  console.log(`   relay:  SWAP_DEX=${DEX}  SWAP_POOL=${POOL_ID}`);
}

const STEPS = { plan, pool: stepPool, token: stepToken, liquidity: stepLiquidity, vault: stepVault, register: stepRegister, check, lock };
const wanted = process.argv.slice(2);
if (!wanted.length) wanted.push('plan');
for (const s of wanted) if (!STEPS[s]) die(`unknown step "${s}". Steps: ${Object.keys(STEPS).join(', ')}`);
try {
  for (const s of wanted) await STEPS[s]();
} catch (e) {
  die(e.message);
}
