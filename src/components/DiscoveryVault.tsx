import { useState, useEffect, useRef } from 'react';
import type { FoundAddress } from '@/hooks/useVanityGenerator';
import { useBalanceChecker } from '@/hooks/useBalanceChecker';

interface Props {
  results: FoundAddress[];
  onClear: () => void;
}

export default function DiscoveryVault({ results, onClear }: Props) {
  const [revealedKeys, setRevealedKeys] = useState<Set<number>>(new Set());
  const { checkBalance, getBalance } = useBalanceChecker();
  const checkedRef = useRef<Set<string>>(new Set());

  // Auto-check balance for new results
  useEffect(() => {
    for (const r of results) {
      if (!checkedRef.current.has(r.address)) {
        checkedRef.current.add(r.address);
        checkBalance(r.address, r.network);
      }
    }
  }, [results, checkBalance]);

  // All hooks are above — no early returns before this point

  const toggleReveal = (idx: number) => {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const exportTxt = () => {
    const lines = results.map(
      r => `Address: ${r.address}\nPrivate Key: ${r.privateKey}\nNetwork: ${r.network.toUpperCase()} (${r.addressType})\nVerified: ${r.verified}\n`
    );
    download('vanity-addresses.txt', lines.join('\n---\n'), 'text/plain');
  };

  const exportJson = async () => {
    const password = prompt('Enter encryption password:');
    if (!password) return;

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = enc.encode(JSON.stringify(results));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

    const payload = JSON.stringify({
      salt: Array.from(salt),
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted)),
      algorithm: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256-100k',
    });
    download('vanity-addresses-encrypted.json', payload, 'application/json');
  };

  const download = (name: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (results.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <div className="text-muted-foreground text-sm">
          No addresses found yet. Start generating to fill the vault.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">
          🔐 Discovery Vault ({results.length})
        </h3>
        <div className="flex gap-2">
          <button onClick={exportTxt} className="px-3 py-1 text-xs rounded-md bg-accent text-accent-foreground hover:bg-muted transition-colors">
            Export .txt
          </button>
          <button onClick={exportJson} className="px-3 py-1 text-xs rounded-md bg-accent text-accent-foreground hover:bg-muted transition-colors">
            Export Encrypted .json
          </button>
          <button onClick={onClear} className="px-3 py-1 text-xs rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors">
            Clear
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-4 py-2 text-left">#</th>
              <th className="px-4 py-2 text-left">Address</th>
              <th className="px-4 py-2 text-left">Private Key</th>
              <th className="px-4 py-2 text-left">Balance</th>
              <th className="px-4 py-2 text-left">TX</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">✓</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => {
              const bal = getBalance(r.address);
              return (
                <tr key={i} className={`border-b border-border/50 transition-colors ${
                  bal.value && !bal.value.startsWith('0.0000') && !bal.value.startsWith('0.00000000')
                    ? 'bg-destructive/20 hover:bg-destructive/30'
                    : 'hover:bg-accent/50'
                }`}>
                  <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                  <td className={`px-4 py-2 font-mono break-all ${
                    bal.value && !bal.value.startsWith('0.0000') && !bal.value.startsWith('0.00000000')
                      ? 'text-destructive font-bold'
                      : 'text-primary'
                  }`}>{r.address}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => toggleReveal(i)} className="font-mono text-left break-all">
                      {revealedKeys.has(i) ? (
                        <span className="text-destructive">{r.privateKey}</span>
                      ) : (
                        <span className="text-muted-foreground">●●●●●●●● click to reveal</span>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-2 font-mono text-sm">
                    {bal.loading ? (
                      <span className="text-muted-foreground animate-pulse">Checking…</span>
                    ) : bal.error ? (
                      <button
                        onClick={() => checkBalance(r.address, r.network)}
                        className="text-destructive font-semibold hover:underline cursor-pointer"
                      >
                        Error ↻
                      </button>
                    ) : bal.value ? (
                      <span className={
                        !bal.value.startsWith('0.0000') && !bal.value.startsWith('0.00000000')
                          ? 'text-destructive font-bold text-base'
                          : 'text-foreground'
                      }>{bal.value}</span>
                    ) : (
                      <span className="text-muted-foreground animate-pulse">Queued…</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-sm">
                    {bal.txLoading ? (
                      <span className="text-muted-foreground animate-pulse">…</span>
                    ) : bal.txError ? (
                      <span className="text-destructive">Err</span>
                    ) : bal.txCount !== null ? (
                      <span className={bal.txCount > 0 ? 'text-foreground font-semibold' : 'text-muted-foreground'}>
                        {bal.txCount.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground uppercase">{r.network} {r.addressType}</td>
                  <td className="px-4 py-2">{r.verified ? '✅' : '❌'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
