import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Row {
  address_a?: string;
  address_b?: string;
  total_interactions?: number | string;
  total_btc_volume?: number | string;
  total_eth_volume?: number | string;
  [k: string]: unknown;
}

interface Analysis {
  stats: {
    txCount: number;
    meanGapSec: number;
    stddevGapSec: number;
    coefficientOfVariation: number;
    uniqueCounterparties: number;
    topCounterparty: { address: string; txCount: number; totalVolume: number } | null;
    roundValueRatio: number;
    firstTx: string;
    lastTx: string;
  } | null;
  ai: {
    automationPercent: number | null;
    verdict: string;
    reasoning: string;
  };
}

const explorerUrl = (chain: 'btc' | 'eth', addr: string) =>
  chain === 'btc'
    ? `https://www.blockchain.com/btc/address/${addr}`
    : `https://etherscan.io/address/${addr}`;

export default function DuneQuery() {
  const [chain, setChain] = useState<'btc' | 'eth'>('btc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});
  const [analyzeError, setAnalyzeError] = useState<Record<string, string>>({});

  const run = async () => {
    setError(null);
    setRows([]);
    setAnalyses({});
    setAnalyzeError({});
    setLoading(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('dune-back-and-forth', {
        body: { chain },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      setRows(data?.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  const analyze = async (addr: string) => {
    setAnalyzing(s => ({ ...s, [addr]: true }));
    setAnalyzeError(s => ({ ...s, [addr]: '' }));
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('analyze-wallet-automation', {
        body: { address: addr, chain },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      setAnalyses(s => ({ ...s, [addr]: data as Analysis }));
    } catch (e) {
      setAnalyzeError(s => ({ ...s, [addr]: e instanceof Error ? e.message : 'Analyze failed' }));
    } finally {
      setAnalyzing(s => ({ ...s, [addr]: false }));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(c => (c === text ? null : c)), 1200);
    } catch {
      /* noop */
    }
  };

  const isMint = chain === 'btc';
  const volumeKey = chain === 'btc' ? 'total_btc_volume' : 'total_eth_volume';
  const volumeLabel = chain === 'btc' ? 'BTC Volume' : 'ETH Volume';

  const AddressCell = ({ addr }: { addr: string }) => {
    const a = analyses[addr];
    const busy = analyzing[addr];
    const err = analyzeError[addr];
    return (
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="break-all">{addr}</span>
          <button
            onClick={() => copy(addr)}
            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-accent hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-all"
            title="Copy address"
          >
            {copied === addr ? '✓' : '📋'}
          </button>
          <a
            href={explorerUrl(chain, addr)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-accent hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-all"
            title="View on explorer"
          >
            ↗
          </a>
          <button
            onClick={() => analyze(addr)}
            disabled={busy}
            className="shrink-0 px-2 py-0.5 rounded text-[10px] bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 transition-all disabled:opacity-40"
            title="AI automation analysis"
          >
            {busy ? '⏳' : a ? '🔄 Re-analyze' : '🤖 Analyze'}
          </button>
        </div>
        {err && <div className="text-[10px] text-destructive">⚠️ {err}</div>}
        {a && <AnalysisCard analysis={a} chain={chain} />}
      </div>
    );
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">📊 Dune Back-and-Forth Scanner</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Runs the master Dune query to find address pairs exchanging transactions in both
            directions over the past 7 days. Tap <span className="text-primary">🤖 Analyze</span> on any address to detect automation level via AI.
          </p>
        </div>

        <div className="flex justify-center">
          <div className="inline-flex rounded-lg border border-border bg-background p-1 gap-1">
            <button
              onClick={() => setChain('btc')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                chain === 'btc'
                  ? 'bg-primary text-primary-foreground glow-mint'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              ₿ Bitcoin
            </button>
            <button
              onClick={() => setChain('eth')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                chain === 'eth'
                  ? 'bg-secondary text-secondary-foreground glow-blue'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Ξ Ethereum
            </button>
          </div>
        </div>

        <button
          onClick={run}
          disabled={loading}
          className={`w-full py-3 rounded-lg font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
            isMint
              ? 'bg-primary text-primary-foreground hover:opacity-90 glow-mint'
              : 'bg-secondary text-secondary-foreground hover:opacity-90 glow-blue'
          }`}
        >
          {loading ? '⏳ Running Dune query (may take 30s–3m)...' : '▶ Run Back-and-Forth Check'}
        </button>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-2 text-xs text-destructive">
            ⚠️ {error}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3 text-foreground">
            Results ({rows.length} pair{rows.length === 1 ? '' : 's'} with back-and-forth activity)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground uppercase">
                  <th className="py-2 pr-3">Address A</th>
                  <th className="py-2 pr-3">Address B</th>
                  <th className="py-2 pr-3">Interactions</th>
                  <th className="py-2">{volumeLabel}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-accent/30 align-top">
                    <td className="py-2 pr-3">
                      {r.address_a ? <AddressCell addr={String(r.address_a)} /> : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {r.address_b ? <AddressCell addr={String(r.address_b)} /> : '—'}
                    </td>
                    <td className="py-2 pr-3 text-foreground">{r.total_interactions ?? '—'}</td>
                    <td className="py-2 text-foreground">{(r[volumeKey] as string | number) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalysisCard({ analysis, chain }: { analysis: Analysis; chain: 'btc' | 'eth' }) {
  const { stats, ai } = analysis;
  const pct = ai.automationPercent ?? 0;
  const barColor = pct >= 70 ? 'bg-destructive' : pct >= 40 ? 'bg-yellow-500' : 'bg-primary';
  const verdictColor = pct >= 70 ? 'text-destructive' : pct >= 40 ? 'text-yellow-500' : 'text-primary';

  return (
    <div className="mt-1 rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2 text-[11px]">
      {/* Automation gauge */}
      <div className="space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground uppercase tracking-wide">Automation Level</span>
          <span className={`font-bold ${verdictColor}`}>
            {ai.automationPercent !== null ? `${pct}%` : 'N/A'} · {ai.verdict}
          </span>
        </div>
        {ai.automationPercent !== null && (
          <div className="h-1.5 w-full bg-accent rounded-full overflow-hidden">
            <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className="text-muted-foreground italic leading-snug">{ai.reasoning}</p>
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2 border-t border-border/50">
          <Stat label="Tx analyzed" value={String(stats.txCount)} />
          <Stat label="Unique counterparties" value={String(stats.uniqueCounterparties)} />
          <Stat label="Mean gap" value={fmtDuration(stats.meanGapSec)} />
          <Stat label="Gap variation (CV)" value={stats.coefficientOfVariation.toFixed(2)} />
          <Stat label="First tx" value={new Date(stats.firstTx).toLocaleDateString()} />
          <Stat label="Last tx" value={new Date(stats.lastTx).toLocaleString()} />
        </div>
      )}

      {/* Top counterparty */}
      {stats?.topCounterparty && (
        <div className="pt-2 border-t border-border/50">
          <div className="text-muted-foreground uppercase tracking-wide mb-1">Most-Transacted-To</div>
          <div className="flex items-center gap-1 flex-wrap">
            <a
              href={explorerUrl(chain, stats.topCounterparty.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline break-all"
            >
              {stats.topCounterparty.address}
            </a>
            <span className="text-muted-foreground">
              · {stats.topCounterparty.txCount} tx · {stats.topCounterparty.totalVolume} {chain.toUpperCase()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground font-semibold truncate" title={value}>{value}</span>
    </div>
  );
}

function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}
