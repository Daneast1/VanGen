import { useState, useCallback } from 'react';

export interface SweepConfig {
  privateKey: string;
  network: 'btc' | 'eth';
  addressType: string;
  destinationAddress: string;
  keepDust?: number;
  feeRate?: number;
}

export interface SweepResult {
  success: boolean;
  txHash?: string;
  amount?: string;
  fee?: string;
  error?: string;
  blockExplorerUrl?: string;
}

interface PendingSweep {
  id: string;
  address: string;
  amount: string;
  status: 'pending' | 'broadcasting' | 'confirming' | 'confirmed' | 'failed';
  txHash?: string;
  error?: string;
}

export function useSweeper() {
  const [sweeping, setSweeping] = useState(false);
  const [sweepHistory, setSweepHistory] = useState<PendingSweep[]>([]);
  const [lastResult, setLastResult] = useState<SweepResult | null>(null);
  const abortRef = useState<boolean>(false)[1]; // using setter only

  const validateDestination = useCallback((address: string, network: 'btc' | 'eth'): boolean => {
    if (network === 'btc') return /^(1|3|bc1[qp])/.test(address) && address.length >= 26 && address.length <= 62;
    if (network === 'eth') return /^0x[0-9a-fA-F]{40}$/.test(address);
    return false;
  }, []);

  const sweepAddress = useCallback(async (config: SweepConfig): Promise<SweepResult> => {
    const { privateKey, network, destinationAddress, keepDust = 0, feeRate } = config;

    if (!validateDestination(destinationAddress, network)) {
      const result: SweepResult = { success: false, error: `Invalid ${network.toUpperCase()} destination address` };
      setLastResult(result);
      return result;
    }

    setSweeping(true);
    setLastResult(null);

    const sweepEntry: PendingSweep = {
      id: `sweep_${Date.now()}`,
      address: privateKey.slice(0, 8) + '…',
      amount: 'pending…',
      status: 'pending',
    };
    setSweepHistory(prev => [sweepEntry, ...prev]);

    try {
      if (network === 'btc') {
        return await sweepBitcoin(privateKey, destinationAddress, keepDust, feeRate, sweepEntry);
      }
      if (network === 'eth') {
        return await sweepEthereum(privateKey, destinationAddress, feeRate, sweepEntry);
      }
      throw new Error(`Unsupported network: ${network}`);
    } catch (err: any) {
      const result: SweepResult = { success: false, error: err.message || 'Sweep failed' };
      setLastResult(result);
      updateSweepEntry(sweepEntry.id, { status: 'failed', error: err.message });
      return result;
    } finally {
      setSweeping(false);
    }
  }, [validateDestination]);

  const sweepBitcoin = async (
    privateKey: string, destinationAddress: string, keepDust: number, feeRate: number | undefined, sweepEntry: PendingSweep
  ): Promise<SweepResult> => {
    const { secp256k1 } = await import('@noble/curves/secp256k1');
    const { sha256 } = await import('@noble/hashes/sha256');
    const { ripemd160 } = await import('@noble/hashes/ripemd160');
    const { default: bs58Lib } = await import('bs58');

    const privBytes = hexToBytes(privateKey);
    const pubPoint = secp256k1.ProjectivePoint.fromPrivateKey(privBytes);
    const pubCompressed = pubPoint.toRawBytes(true用來

    const sha = sha256(pubCompressed);
    const h160 = ripemd160(sha);
    const payload = new Uint8Array(1 + h160.length);
    payload[0] = 0x00;
    payload.set(h160, 1);
    const checksum = sha256(sha256(payload)).slice(0, 4);
    const fullAddr = new Uint8Array(payload.length + 4);
    fullAddr.set(payload);
    fullAddr.set(checksum, payload.length);
    const sourceAddress = bs58Lib.encode(fullAddr);

    updateSweepEntry(sweepEntry.id, { status: 'broadcasting', amount: 'fetching UTXOs…' });

    const utxoUrl = `https://blockchain.info/unspent?active=${sourceAddress}`;
    const utxoResp = await fetch(utxoUrl, { signal: AbortSignal.timeout(15000) });
    if (!utxoResp.ok) throw new Error(`Failed to fetch UTXOs: HTTP ${utxoResp.status}`);
    const utxoData = await utxoResp.json();
    const utxos = utxoData.unspent_outputs || [];
    if (utxos.length === 0) throw new Error('No UTXOs found for this address');

    const totalSatoshis = utxos.reduce((sum: number, u: any) => sum + u.value, 0);
    const estTxVsize = 10 + utxos.length * 68 + 34 + 34;
    const feePerVbyte = feeRate || 15;
    const estimatedFee = Math.ceil(estTxVsize * feePerVbyte);

    if (totalSatoshis <= estimatedFee + keepDust) {
      throw new Error(`Balance (${totalSatoshis} sat) too low to cover fee (${estimatedFee} sat)`);
    }

    const amountToSend = totalSatoshis - estimatedFee - keepDust;
    updateSweepEntry(sweepEntry.id, { amount: `${(amountToSend / 1e8).toFixed(8)} BTC` });

    // Use bitcoinjs-lib for transaction construction
    const bitcoin = await import('bitcoinjs-lib');
    const { ECPairFactory } = await import('ecpair');
    const tinysecp = await import('tiny-secp256k1');

    const ECPair = ECPairFactory(tinysecp);
    const keyPair = ECPair.fromPrivateKey(privBytes, { compressed: true });
    const psbt = new bitcoin.Psbt();

    for (const utxo of utxos) {
      psbt.addInput({
        hash: utxo.tx_hash,
        index: utxo.tx_output_n,
        witnessUtxo: {
          script: Buffer.from(utxo.script, 'hex'),
          value: utxo.value,
        },
      });
    }

    psbt.addOutput({ script: bitcoin.address.toOutputScript(destinationAddress), value: amountToSend });
    if (keepDust > 0) {
      psbt.addOutput({ script: bitcoin.address.toOutputScript(sourceAddress), value: keepDust });
    }

    for (let i = 0; i < utxos.length; i++) psbt.signInput(i, keyPair);
    psbt.finalizeAllInputs();
    const rawTxHex = psbt.extractTransaction().toHex();

    updateSweepEntry(sweepEntry.id, { status: 'broadcasting' });

    // Broadcast
    const broadcastResp = await fetch('https://blockchain.info/pushtx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      const broadcastResp = await fetch('https://blockchain.info/pushtx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(rawTxHex)}`,
      });
      if (!broadcastResp.ok) throw new Error(`Broadcast HTTP ${broadcastResp.status}`);

      const txHash = rawTxHex; // In practice, we'd parse the tx hash from the response or compute it
      // Compute the actual tx hash from the raw tx
      const txidBytes = sha256(sha256(hexToBytes(rawTxHex)));
      const txid = Array.from(txidBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      // Reverse byte order for Bitcoin txid
      const reversedTxid = txid.match(/.{2}/g)!.reverse().join('');

      const result: SweepResult = {
        success: true,
        txHash: reversedTxid,
        amount: `${(amountToSend / 1e8).toFixed(8)} BTC`,
        fee: `${estimatedFee} sat`,
        blockExplorerUrl: `https://blockchain.com/btc/tx/${reversedTxid}`,
      };

      setLastResult(result);
      updateSweepEntry(sweepEntry.id, { status: 'confirmed', txHash: reversedTxid });
      return result;
    };

    const sweepEthereum = async (
      privateKey: string, destinationAddress: string, feeRate: number | undefined, sweepEntry: PendingSweep
    ): Promise<SweepResult> => {
      const { ethers } = await import('ethers');
      const provider = new ethers.JsonRpcProvider('https://cloudflare-eth.com');
      const wallet = new ethers.Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`, provider);

      const balance = await provider.getBalance(wallet.address);
      if (balance === 0n) throw new Error('No ETH balance to sweep');

      const feeData = await provider.getFeeData();
      const gasPrice = feeRate !== undefined
        ? ethers.parseUnits(feeRate.toString(), 'gwei')
        : (feeData.gasPrice || ethers.parseUnits('15', 'gwei'));
      const gasLimit = 21000n;
      const totalFee = gasPrice * gasLimit;
      const amountToSend = balance - totalFee2y

      if (amountToSend <= 0n) {
        throw new Error(`Balance (${ethers.formatEther(balance)} ETH) too low to cover fee (${ethers.formatEther(totalFee)} ETH)`);
      }

      updateSweepEntry(sweepEntry.id, { amount: `${ethers.formatEther(amountToSend)} ETH`, status: 'broadcasting' });

      const tx = await wallet.sendTransaction({
        to: destinationAddress,
        value: amountToSend,
        gasPrice,
        gasLimit,
      });

      updateSweepEntry(sweepEntry.id, { status: 'confirming', txHash: tx.hash });
      await tx.wait(1);

      const result: SweepResult = {
        success: true,
        txHash: tx.hash,
        amount: `${ethers.formatEther(amountToSend)} ETH`,
        fee: `${ethers.formatEther(totalFee)} ETH`,
        blockExplorerUrl: `https://etherscan.io/tx/${tx.hash}`,
      };

      setLastResult(result);
      updateSweepEntry(sweepEntry.id, { status: 'confirmed', txHash: tx.hash });
      return result;
    };

    const updateSweepEntry = (id: string, updates: Partial<PendingSweep>) => {
      setSweepHistory(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
    };

    const clearLastResult = useCallback(() => setLastResult(null), []);
    const clearHistory = useCallback(() => setSweepHistory([]), []);

    return {
      sweepAddress,
      sweeping,
      lastResult,
      sweepHistory,
      clearLastResult,
      clearHistory,
      validateDestination,
    };
  }

  function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    return bytes;
  }
