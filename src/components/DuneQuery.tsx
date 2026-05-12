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

  const run = async () => {
    setError(null);
    setRows([]);
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

  const AddressCell = ({ addr }: { addr: string }) => (
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
    </div>
  );

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">📊 Dune Back-and-Forth Scanner</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Runs the master Dune query to find address pairs exchanging transactions in both
            directions over the past 7 days.
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
