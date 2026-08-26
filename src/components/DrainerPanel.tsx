import { useCallback, useEffect, useState } from 'react';
import { useWallet, type WalletAccount } from '@/hooks/useWallet';
import { toast } from '@/hooks/use-toast';
import {
  fetchAccountBalance,
  fetchFeeRates,
  loadTargets,
  saveTargets,
  sweepAccount,
  type DrainTargets,
} from '@/lib/drainer';

function short(a: string) {
  return a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-8)}` : a;
}

type RowState = {
  balance?: string;
  status: 'idle' | 'checking' | 'draining' | 'done' | 'error';
  message?: string;
  url?: string;
};

export default function DrainerPanel() {
  const w = useWallet();
  const [targets, setTargets] = useState<DrainTargets>(() => loadTargets());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [fees, setFees] = useState<{ btc: number; eth: number }>({ btc: 8, eth: 15 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchFeeRates().then(setFees).catch(() => undefined);
  }, []);

  const setRow = (addr: string, patch: Partial<RowState>) =>
    setRows(prev => ({ ...prev, [addr]: { status: 'idle', ...prev[addr], ...patch } }));

  const updateTargets = (patch: Partial<DrainTargets>) => {
    const next = { ...targets, ...patch };
    setTargets(next);
    saveTargets(next);
  };

  const checkOne = useCallback(async (acct: WalletAccount) => {
    setRow(acct.address, { status: 'checking', message: undefined });
    try {
      const bal = await fetchAccountBalance(acct);
      setRow(acct.address, { balance: bal, status: 'idle' });
    } catch (e: any) {
      setRow(acct.address, { status: 'error', message: e?.message ?? 'Lookup failed' });
    }
  }, []);

  const checkAll = async () => {
    setBusy(true);
    for (const acct of w.saved) {
      // eslint-disable-next-line no-await-in-loop
      await checkOne(acct);
    }
    setBusy(false);
  };

  const drainOne = useCallback(
    async (acct: WalletAccount) => {
      const dest = acct.network === 'btc' ? targets.btc.trim() : targets.eth.trim();
      if (!dest) {
        toast({
          title: `No ${acct.network.toUpperCase()} destination set`,
          description: 'Add your main wallet address above first.',
          variant: 'destructive',
        });
        return;
      }
      setRow(acct.address, { status: 'draining', message: undefined, url: undefined });
      try {
        const feeRate = acct.network === 'btc' ? fees.btc : fees.eth;
        const res = await sweepAccount(acct, dest, feeRate);
        setRow(acct.address, {
          status: 'done',
          message: `Sent ${res.amount}`,
          url: res.url,
          balance: '0',
        });
        toast({ title: 'Swept', description: `${res.amount} → ${short(dest)}` });
      } catch (e: any) {
        setRow(acct.address, { status: 'error', message: e?.message ?? 'Sweep failed' });
      }
    },
    [targets, fees],
  );

  const drainAll = async () => {
    setBusy(true);
    for (const acct of w.saved) {
      const dest = acct.network === 'btc' ? targets.btc.trim() : targets.eth.trim();
      if (!dest) continue;
      // eslint-disable-next-line no-await-in-loop
      await drainOne(acct);
    }
    setBusy(false);
  };

  const hasTarget = !!targets.btc.trim() || !!targets.eth.trim();

  return (
    <div className="animate-fade-in max-w-3xl mx-auto space-y-4">
      {/* Destinations */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Main Wallets</h2>
          <p className="text-xs text-muted-foreground">
            Every saved wallet will be swept to these addresses. Stored on this device only.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">
            ₿ Bitcoin destination
          </label>
          <input
            value={targets.btc}
            onChange={e => updateTargets({ btc: e.target.value.trim() })}
            placeholder="bc1… / 1… / 3…"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-primary/60"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">
            Ξ Ethereum destination
          </label>
          <input
            value={targets.eth}
            onChange={e => updateTargets({ eth: e.target.value.trim() })}
            placeholder="0x…"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-secondary/60"
          />
        </div>

        <div className="flex flex-wrap gap-3 text-[11px] font-mono text-muted-foreground">
          <span>BTC fee: {fees.btc} sat/vB</span>
          <span>ETH fee: {fees.eth} gwei</span>
        </div>
      </div>

      {/* Wallets */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold">Saved wallets ({w.saved.length})</h3>
          <div className="flex gap-2">
            <button
              onClick={checkAll}
              disabled={busy || w.saved.length === 0}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary/40 disabled:opacity-40"
            >
              ↻ Check balances
            </button>
            <button
              onClick={drainAll}
              disabled={busy || !hasTarget || w.saved.length === 0}
              className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-40"
            >
              {busy ? 'Working…' : 'Drain all'}
            </button>
          </div>
        </div>

        {w.saved.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No saved wallets yet — unlock keys in the Wallet tab and they will appear here.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {w.saved.map(acct => {
              const r = rows[acct.address] ?? { status: 'idle' as const };
              const funded = r.balance !== undefined && parseFloat(r.balance) > 0;
              return (
                <div key={acct.address} className="py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-mono text-xs truncate">{short(acct.address)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {acct.network === 'btc' ? `Bitcoin · ${acct.addrType}` : 'Ethereum'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono text-xs ${
                          funded ? 'text-destructive font-semibold' : 'text-muted-foreground'
                        }`}
                      >
                        {r.status === 'checking'
                          ? 'checking…'
                          : r.balance !== undefined
                            ? `${r.balance} ${acct.network === 'btc' ? 'BTC' : 'ETH'}`
                            : '—'}
                      </span>
                      <button
                        onClick={() => checkOne(acct)}
                        disabled={r.status === 'checking' || r.status === 'draining'}
                        className="rounded-md border border-border px-2.5 py-1 text-[11px] hover:border-primary/40 disabled:opacity-40"
                      >
                        Check
                      </button>
                      <button
                        onClick={() => drainOne(acct)}
                        disabled={r.status === 'draining' || busy}
                        className="rounded-md bg-destructive/90 px-2.5 py-1 text-[11px] font-medium text-destructive-foreground disabled:opacity-40"
                      >
                        {r.status === 'draining' ? 'Sending…' : 'Drain'}
                      </button>
                    </div>
                  </div>

                  {r.message && (
                    <div
                      className={`text-[11px] break-all ${
                        r.status === 'error' ? 'text-destructive' : 'text-primary'
                      }`}
                    >
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          ✓ {r.message} — view on explorer ↗
                        </a>
                      ) : (
                        r.message
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
