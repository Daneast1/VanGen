import { btcPayment, hexToBytes, type WalletAccount } from '@/hooks/useWallet';

const BLOCKSTREAM = 'https://blockstream.info/api';
const ETH_RPCS = ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth', 'https://cloudflare-eth.com'];

const DEST_KEY = 'ckg_drain_targets_v1';

export interface DrainTargets {
  btc: string;
  eth: string;
}

export function loadTargets(): DrainTargets {
  try {
    const raw = localStorage.getItem(DEST_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { btc: parsed?.btc ?? '', eth: parsed?.eth ?? '' };
  } catch {
    return { btc: '', eth: '' };
  }
}

export function saveTargets(t: DrainTargets) {
  try {
    localStorage.setItem(DEST_KEY, JSON.stringify(t));
  } catch { /* storage unavailable */ }
}

async function ethProvider() {
  const { ethers } = await import('ethers');
  for (const url of ETH_RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber();
      return { ethers, provider: p };
    } catch { /* next */ }
  }
  throw new Error('No Ethereum RPC reachable');
}

/** Confirmed spendable balance for any saved wallet (in BTC / ETH units). */
export async function fetchAccountBalance(acct: WalletAccount): Promise<string> {
  if (acct.network === 'eth') {
    const { ethers, provider } = await ethProvider();
    return ethers.formatEther(await provider.getBalance(acct.address));
  }
  const res = await fetch(`${BLOCKSTREAM}/address/${acct.address}`);
  if (!res.ok) throw new Error(`Balance lookup failed (${res.status})`);
  const s = await res.json();
  const sat = s.chain_stats.funded_txo_sum - s.chain_stats.spent_txo_sum;
  return (sat / 1e8).toFixed(8);
}

export async function fetchFeeRates(): Promise<{ btc: number; eth: number }> {
  let btc = 8;
  let eth = 15;
  try {
    const r = await fetch(`${BLOCKSTREAM}/fee-estimates`);
    if (r.ok) {
      const f = await r.json();
      btc = Math.max(1, Math.ceil(f['3'] ?? 8));
    }
  } catch { /* default */ }
  try {
    const { ethers, provider } = await ethProvider();
    const fee = await provider.getFeeData();
    eth = Math.max(1, +Number(ethers.formatUnits(fee.gasPrice ?? 0n, 'gwei')).toFixed(2));
  } catch { /* default */ }
  return { btc, eth };
}

export interface SweepResult {
  hash: string;
  url: string;
  amount: string;
}

/** Send the entire spendable balance of one wallet to the destination address. */
export async function sweepAccount(
  acct: WalletAccount,
  to: string,
  feeRate: number,
): Promise<SweepResult> {
  if (!to.trim()) throw new Error('No destination address set');

  if (acct.network === 'eth') {
    const { ethers, provider } = await ethProvider();
    if (!ethers.isAddress(to)) throw new Error('Invalid Ethereum destination');
    const wallet = new ethers.Wallet('0x' + acct.privHex, provider);
    const bal = await provider.getBalance(acct.address);
    const gasPrice = ethers.parseUnits(String(feeRate), 'gwei');
    const cost = gasPrice * 21000n;
    if (bal <= cost) throw new Error('Balance too low to cover gas');
    const value = bal - cost;
    const tx = await wallet.sendTransaction({ to, value, gasLimit: 21000n, gasPrice });
    return {
      hash: tx.hash,
      url: `https://etherscan.io/tx/${tx.hash}`,
      amount: `${ethers.formatEther(value)} ETH`,
    };
  }

  const addrType = acct.addrType || 'p2pkh';
  const { bitcoin, keyPair, payment } = await btcPayment(acct.privHex, addrType);
  let outputScript: Uint8Array;
  try {
    outputScript = bitcoin.address.toOutputScript(to, bitcoin.networks.bitcoin);
  } catch {
    throw new Error('Invalid Bitcoin destination');
  }

  const utxoRes = await fetch(`${BLOCKSTREAM}/address/${acct.address}/utxo`);
  if (!utxoRes.ok) throw new Error('Failed to fetch UTXOs');
  const utxos: any[] = (await utxoRes.json()).filter((u: any) => u.status?.confirmed);
  if (!utxos.length) throw new Error('No confirmed UTXOs available');

  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  let total = 0;
  for (const u of utxos) {
    const input: any = { hash: u.txid, index: u.vout };
    if (addrType === 'p2pkh') {
      const rawRes = await fetch(`${BLOCKSTREAM}/tx/${u.txid}/hex`);
      input.nonWitnessUtxo = hexToBytes(await rawRes.text());
    } else {
      input.witnessUtxo = { script: payment.output!, value: BigInt(u.value) };
      if (addrType === 'p2sh') input.redeemScript = (payment as any).redeem.output;
    }
    psbt.addInput(input);
    total += u.value;
  }

  const inSize = addrType === 'p2pkh' ? 148 : addrType === 'p2sh' ? 91 : 68;
  const fee = Math.ceil((10 + utxos.length * inSize + 31) * feeRate);
  const value = total - fee;
  if (value <= 546) throw new Error('Balance too low to cover the network fee');

  psbt.addOutput({ script: outputScript, value: BigInt(value) });
  for (let i = 0; i < utxos.length; i++) psbt.signInput(i, keyPair as any);
  psbt.finalizeAllInputs();
  const hex = psbt.extractTransaction().toHex();

  const bc = await fetch(`${BLOCKSTREAM}/tx`, { method: 'POST', body: hex });
  const text = await bc.text();
  if (!bc.ok) throw new Error(text || 'Broadcast failed');
  const txid = text.trim();
  return {
    hash: txid,
    url: `https://mempool.space/tx/${txid}`,
    amount: `${(value / 1e8).toFixed(8)} BTC`,
  };
}
