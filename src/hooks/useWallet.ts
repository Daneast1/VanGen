import { useCallback, useState } from 'react';

export type WalletNetwork = 'btc' | 'eth';
export type BtcAddrType = 'p2pkh' | 'p2sh' | 'bech32';

export interface WalletAccount {
  network: WalletNetwork;
  addrType?: BtcAddrType;
  address: string;
  privHex: string;
  wif?: string;
}

export interface WalletTx {
  hash: string;
  time?: number;
  direction: 'in' | 'out' | 'self';
  amount: string;
  confirmed: boolean;
  url: string;
}

const BLOCKSTREAM = 'https://blockstream.info/api';
const ETH_RPCS = ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth', 'https://cloudflare-eth.com'];

function stripHex(s: string) {
  return s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = stripHex(hex);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Decode a WIF private key → 32-byte hex (throws on bad checksum). */
export async function wifToHex(wif: string): Promise<{ hex: string; compressed: boolean }> {
  const { default: bs58 } = await import('bs58');
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const decoded = bs58.decode(wif.trim());
  if (decoded.length < 37) throw new Error('WIF too short');
  const payload = decoded.slice(0, decoded.length - 4);
  const checksum = decoded.slice(decoded.length - 4);
  const calc = sha256(sha256(payload)).slice(0, 4);
  for (let i = 0; i < 4; i++) if (calc[i] !== checksum[i]) throw new Error('Invalid WIF checksum');
  const compressed = payload.length === 34 && payload[33] === 0x01;
  const key = payload.slice(1, 33);
  return { hex: bytesToHex(key), compressed };
}

export async function hexToWif(hex: string, compressed = true): Promise<string> {
  const { default: bs58 } = await import('bs58');
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const key = hexToBytes(hex);
  const payload = new Uint8Array(1 + 32 + (compressed ? 1 : 0));
  payload[0] = 0x80;
  payload.set(key, 1);
  if (compressed) payload[33] = 0x01;
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(checksum, payload.length);
  return bs58.encode(full);
}

/** Normalize any accepted key input (WIF or hex) into 32-byte hex. */
export async function normalizeKey(input: string): Promise<string> {
  const raw = input.trim();
  if (!raw) throw new Error('Enter a private key');
  const maybeHex = stripHex(raw);
  if (/^[0-9a-fA-F]{64}$/.test(maybeHex)) return maybeHex.toLowerCase();
  const { hex } = await wifToHex(raw);
  return hex;
}

async function btcPayment(privHex: string, addrType: BtcAddrType) {
  const bitcoin = await import('bitcoinjs-lib');
  const { ECPairFactory } = await import('ecpair');
  const tinysecp = await import('tiny-secp256k1');
  const ECPair = ECPairFactory(tinysecp as any);
  const keyPair = ECPair.fromPrivateKey(hexToBytes(privHex), { compressed: true });
  const pubkey = Buffer.from(keyPair.publicKey);
  const network = bitcoin.networks.bitcoin;
  if (addrType === 'p2pkh') return { bitcoin, keyPair, payment: bitcoin.payments.p2pkh({ pubkey, network }) };
  if (addrType === 'bech32') return { bitcoin, keyPair, payment: bitcoin.payments.p2wpkh({ pubkey, network }) };
  return {
    bitcoin,
    keyPair,
    payment: bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey, network }), network }),
  };
}

export async function deriveAddress(privHex: string, network: WalletNetwork, addrType: BtcAddrType = 'p2pkh') {
  if (network === 'eth') {
    const { ethers } = await import('ethers');
    return new ethers.Wallet('0x' + privHex).address;
  }
  const { payment } = await btcPayment(privHex, addrType);
  if (!payment.address) throw new Error('Could not derive address');
  return payment.address;
}

export function useWallet() {
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [txs, setTxs] = useState<WalletTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeRates, setFeeRates] = useState<{ slow: number; normal: number; fast: number } | null>(null);

  const disconnect = useCallback(() => {
    setAccount(null);
    setBalance(null);
    setUnconfirmed(null);
    setTxs([]);
    setError(null);
    setFeeRates(null);
  }, []);

  const connect = useCallback(
    async (keyInput: string, network: WalletNetwork, addrType: BtcAddrType = 'p2pkh') => {
      setError(null);
      setLoading(true);
      try {
        const privHex = await normalizeKey(keyInput);
        const address = await deriveAddress(privHex, network, addrType);
        const acct: WalletAccount = {
          network,
          addrType: network === 'btc' ? addrType : undefined,
          address,
          privHex,
          wif: network === 'btc' ? await hexToWif(privHex, true) : undefined,
        };
        setAccount(acct);
        setBalance(null);
        setTxs([]);
        return acct;
      } catch (e: any) {
        setError(e?.message || 'Failed to unlock wallet');
        setAccount(null);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const refresh = useCallback(async (acct: WalletAccount | null) => {
    const a = acct ?? account;
    if (!a) return;
    setLoading(true);
    setError(null);
    try {
      if (a.network === 'btc') {
        const [statsRes, txRes, feeRes] = await Promise.all([
          fetch(`${BLOCKSTREAM}/address/${a.address}`),
          fetch(`${BLOCKSTREAM}/address/${a.address}/txs`),
          fetch(`${BLOCKSTREAM}/fee-estimates`),
        ]);
        if (!statsRes.ok) throw new Error(`Balance lookup failed (${statsRes.status})`);
        const stats = await statsRes.json();
        const confirmedSat =
          stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;
        const pendingSat =
          stats.mempool_stats.funded_txo_sum - stats.mempool_stats.spent_txo_sum;
        setBalance((confirmedSat / 1e8).toFixed(8));
        setUnconfirmed(pendingSat !== 0 ? (pendingSat / 1e8).toFixed(8) : null);

        if (feeRes.ok) {
          const f = await feeRes.json();
          setFeeRates({
            slow: Math.max(1, Math.ceil(f['6'] ?? 3)),
            normal: Math.max(1, Math.ceil(f['3'] ?? 8)),
            fast: Math.max(1, Math.ceil(f['1'] ?? 20)),
          });
        }

        if (txRes.ok) {
          const list = await txRes.json();
          setTxs(
            list.slice(0, 15).map((tx: any) => {
              const inMine = tx.vin.some((v: any) => v.prevout?.scriptpubkey_address === a.address);
              const outMine = tx.vout
                .filter((v: any) => v.scriptpubkey_address === a.address)
                .reduce((s: number, v: any) => s + v.value, 0);
              const outOther = tx.vout
                .filter((v: any) => v.scriptpubkey_address !== a.address)
                .reduce((s: number, v: any) => s + v.value, 0);
              const direction: WalletTx['direction'] = inMine ? (outOther > 0 ? 'out' : 'self') : 'in';
              const amount = inMine ? outOther : outMine;
              return {
                hash: tx.txid,
                time: tx.status?.block_time ? tx.status.block_time * 1000 : undefined,
                direction,
                amount: `${(amount / 1e8).toFixed(8)} BTC`,
                confirmed: !!tx.status?.confirmed,
                url: `https://mempool.space/tx/${tx.txid}`,
              } as WalletTx;
            }),
          );
        }
      } else {
        const { ethers } = await import('ethers');
        let provider: any = null;
        for (const url of ETH_RPCS) {
          try {
            const p = new ethers.JsonRpcProvider(url);
            await p.getBlockNumber();
            provider = p;
            break;
          } catch { /* next */ }
        }
        if (!provider) throw new Error('No Ethereum RPC reachable');
        const [bal, fee] = await Promise.all([provider.getBalance(a.address), provider.getFeeData()]);
        setBalance(ethers.formatEther(bal));
        setUnconfirmed(null);
        const gwei = Number(ethers.formatUnits(fee.gasPrice ?? 0n, 'gwei'));
        setFeeRates({
          slow: Math.max(1, +(gwei * 0.85).toFixed(2)),
          normal: Math.max(1, +gwei.toFixed(2)),
          fast: Math.max(1, +(gwei * 1.3).toFixed(2)),
        });
        try {
          const res = await fetch(
            `https://eth.blockscout.com/api?module=account&action=txlist&address=${a.address}&sort=desc&page=1&offset=15`,
          );
          const data = await res.json();
          if (Array.isArray(data.result)) {
            setTxs(
              data.result.slice(0, 15).map((t: any) => ({
                hash: t.hash,
                time: Number(t.timeStamp) * 1000,
                direction:
                  t.from?.toLowerCase() === a.address.toLowerCase()
                    ? t.to?.toLowerCase() === a.address.toLowerCase()
                      ? 'self'
                      : 'out'
                    : 'in',
                amount: `${ethers.formatEther(t.value || '0')} ETH`,
                confirmed: true,
                url: `https://etherscan.io/tx/${t.hash}`,
              })),
            );
          } else setTxs([]);
        } catch {
          setTxs([]);
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load wallet data');
    } finally {
      setLoading(false);
    }
  }, [account]);

  /** Estimate the max sendable amount (whole balance minus fee). */
  const estimateMax = useCallback(
    async (feeRate: number): Promise<string> => {
      if (!account || balance === null) return '0';
      if (account.network === 'eth') {
        const { ethers } = await import('ethers');
        const wei = ethers.parseEther(balance);
        const fee = ethers.parseUnits(String(feeRate), 'gwei') * 21000n;
        return wei > fee ? ethers.formatEther(wei - fee) : '0';
      }
      const res = await fetch(`${BLOCKSTREAM}/address/${account.address}/utxo`);
      const utxos = await res.json();
      const total = utxos.reduce((s: number, u: any) => s + u.value, 0);
      const vsize = 10 + utxos.length * (account.addrType === 'p2pkh' ? 148 : 68) + 31;
      const fee = Math.ceil(vsize * feeRate);
      return total > fee ? ((total - fee) / 1e8).toFixed(8) : '0';
    },
    [account, balance],
  );

  const send = useCallback(
    async (to: string, amount: string, feeRate: number): Promise<{ hash: string; url: string }> => {
      if (!account) throw new Error('No wallet connected');
      setSending(true);
      setError(null);
      try {
        if (account.network === 'eth') {
          const { ethers } = await import('ethers');
          if (!ethers.isAddress(to)) throw new Error('Invalid Ethereum address');
          let provider: any = null;
          for (const url of ETH_RPCS) {
            try {
              const p = new ethers.JsonRpcProvider(url);
              await p.getBlockNumber();
              provider = p;
              break;
            } catch { /* next */ }
          }
          if (!provider) throw new Error('No Ethereum RPC reachable');
          const wallet = new ethers.Wallet('0x' + account.privHex, provider);
          const tx = await wallet.sendTransaction({
            to,
            value: ethers.parseEther(amount),
            gasLimit: 21000n,
            gasPrice: ethers.parseUnits(String(feeRate), 'gwei'),
          });
          return { hash: tx.hash, url: `https://etherscan.io/tx/${tx.hash}` };
        }

        const { bitcoin, keyPair, payment } = await btcPayment(account.privHex, account.addrType || 'p2pkh');
        let outputScript: Uint8Array;
        try {
          outputScript = bitcoin.address.toOutputScript(to, bitcoin.networks.bitcoin);
        } catch {
          throw new Error('Invalid Bitcoin address');
        }

        const utxoRes = await fetch(`${BLOCKSTREAM}/address/${account.address}/utxo`);
        if (!utxoRes.ok) throw new Error('Failed to fetch UTXOs');
        const utxos: any[] = (await utxoRes.json()).filter((u: any) => u.status?.confirmed);
        if (!utxos.length) throw new Error('No confirmed UTXOs available');

        const sendSat = Math.round(parseFloat(amount) * 1e8);
        if (!isFinite(sendSat) || sendSat <= 546) throw new Error('Amount too small (dust)');

        const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
        let total = 0;
        for (const u of utxos) {
          const input: any = { hash: u.txid, index: u.vout };
          if (account.addrType === 'p2pkh') {
            const rawRes = await fetch(`${BLOCKSTREAM}/tx/${u.txid}/hex`);
            input.nonWitnessUtxo = Buffer.from(await rawRes.text(), 'hex');
          } else {
            input.witnessUtxo = { script: payment.output!, value: BigInt(u.value) };
            if (account.addrType === 'p2sh') input.redeemScript = (payment as any).redeem.output;
          }
          psbt.addInput(input);
          total += u.value;
        }

        const inSize = account.addrType === 'p2pkh' ? 148 : account.addrType === 'p2sh' ? 91 : 68;
        const fee = Math.ceil((10 + utxos.length * inSize + 31 * 2) * feeRate);
        const change = total - sendSat - fee;
        if (change < 0) throw new Error(`Insufficient funds: need ${(sendSat + fee) / 1e8} BTC, have ${total / 1e8} BTC`);

        psbt.addOutput({ script: outputScript, value: BigInt(sendSat) });
        if (change > 546) psbt.addOutput({ address: account.address, value: BigInt(change) });

        for (let i = 0; i < utxos.length; i++) psbt.signInput(i, keyPair as any);
        psbt.finalizeAllInputs();
        const hex = psbt.extractTransaction().toHex();

        const bc = await fetch(`${BLOCKSTREAM}/tx`, { method: 'POST', body: hex });
        const text = await bc.text();
        if (!bc.ok) throw new Error(text || 'Broadcast failed');
        return { hash: text.trim(), url: `https://mempool.space/tx/${text.trim()}` };
      } catch (e: any) {
        setError(e?.message || 'Transaction failed');
        throw e;
      } finally {
        setSending(false);
      }
    },
    [account],
  );

  return {
    account, balance, unconfirmed, txs, loading, sending, error, feeRates,
    connect, disconnect, refresh, send, estimateMax, setError,
  };
}
