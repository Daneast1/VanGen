import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { FoundAddress } from '@/hooks/useVanityGenerator';

interface Row {
  address: string;
  tx_count?: number;
  balance?: number | string;
  recent_dates?: string[] | string;
  [k: string]: unknown;
}

interface Props {
  vaultResults: FoundAddress[];
}

export default function DuneQuery({ vaultResults }: Props) {
  const [chain, setChain] = useState<'btc' | 'eth'>('btc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const filtered = vaultResults.filter(r => r.network === chain);

  const run = async () => {
    setError(null);
    setRows([]);
    if (filtered.length === 0) {
      setError(`No ${chain.toUpperCase()} addresses in vault. Generate some first.`);
      return;
    }
    setLoading(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('dune-back-and-forth', {
        body: { chain, addresses: filtered.map(r => r.address) },
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

  const isMint = chain === 'btc';

  const formatDates = (d: Row['recent_dates']) => {
    if (!d) return '—';
    const arr = Array.isArray(d) ? d : String(d).split(',');
    return arr.slice(0, 3).map(x => String(x).split('T')[0]).join(', ');
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">📊 Dune Back-and-Forth Scanner</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Detect addresses exchanging transactions with each other in the last 7 days.
            Uses addresses from your Discovery Vault.
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

        <div className="rounded-md bg-accent/50 px-4 py-2 text-xs text-muted-foreground font-mono">
          {filtered.length} {chain.toUpperCase()} address{filtered.length === 1 ? '' : 'es'} from vault
        </div>

        <button
          onClick={run}
          disabled={loading || filtered.length === 0}
          className={`w-full py-3 rounded-lg font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
            isMint
              ? 'bg-primary text-primary-foreground hover:opacity-90 glow-mint'
              : 'bg-secondary text-secondary-foreground hover:opacity-90 glow-blue'
          }`}
        >
          {loading ? '⏳ Running Dune query (may take ~30s)...' : '▶ Run Back-and-Forth Check'}
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
            Results ({rows.length} address{rows.length === 1 ? '' : 'es'} with back-and-forth activity)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground uppercase">
                  <th className="py-2 pr-3">Address</th>
                  <th className="py-2 pr-3">B&amp;F TX</th>
                  <th className="py-2 pr-3">Balance</th>
                  <th className="py-2">Recent Dates</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="py-2 pr-3 break-all">{r.address}</td>
                    <td className="py-2 pr-3 text-foreground">{r.tx_count ?? '—'}</td>
                    <td className="py-2 pr-3 text-foreground">{r.balance ?? '—'}</td>
                    <td className="py-2 text-muted-foreground">{formatDates(r.recent_dates)}</td>
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
