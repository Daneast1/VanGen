import { useEffect, useMemo, useState } from 'react';
import { useWallet, type BtcAddrType, type WalletNetwork } from '@/hooks/useWallet';
import { toast } from '@/hooks/use-toast';

const BTC_TYPES: { value: BtcAddrType; label: string; hint: string }[] = [
  { value: 'p2pkh', label: 'Legacy', hint: '1…' },
  { value: 'p2sh', label: 'SegWit', hint: '3…' },
  { value: 'bech32', label: 'Native SegWit', hint: 'bc1q…' },
];

function short(a: string) {
  return a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-8)}` : a;
}

export default function WalletPanel() {
  const w = useWallet();
  const [network, setNetwork] = useState<WalletNetwork>('btc');
  const [addrType, setAddrType] = useState<BtcAddrType>('bech32');
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [revealPriv, setRevealPriv] = useState(false);

  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [lastTx, setLastTx] = useState<{ hash: string; url: string } | null>(null);

  const accent = network === 'btc' ? 'primary' : 'secondary';
  const unit = network === 'btc' ? 'BTC' : 'ETH';
  const feeRate = w.feeRates ? w.feeRates[speed] : network === 'btc' ? 8 : 15;

  useEffect(() => {
    if (w.account) {
      w.refresh(w.account);
      const id = setInterval(() => w.refresh(w.account), 60000);
      return () => clearInterval(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.account?.address]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  };

  const unlock = async () => {
    const acct = await w.connect(keyInput, network, addrType);
    if (acct) {
      setKeyInput('');
      toast({ title: 'Wallet unlocked', description: short(acct.address) });
    }
  };

  const fillMax = async () => {
    try {
      const max = await w.estimateMax(feeRate);
      setAmount(max);
    } catch {
      toast({ title: 'Could not estimate max', variant: 'destructive' });
    }
  };

  const submit = async () => {
    try {
      const res = await w.send(to.trim(), amount.trim(), feeRate);
      setLastTx(res);
      setTo('');
      setAmount('');
      toast({ title: 'Transaction broadcast', description: short(res.hash) });
      setTimeout(() => w.refresh(w.account), 3000);
    } catch (e: any) {
      toast({ title: 'Send failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
    }
  };

  const canSend = useMemo(
    () => !!to.trim() && parseFloat(amount) > 0 && !w.sending,
    [to, amount, w.sending],
  );

  // ── LOCKED STATE ────────────────────────────────────────────────────────
  if (!w.account) {
    return (
      <div className="animate-fade-in max-w-xl mx-auto space-y-4">
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Open Wallet</h2>
            <p className="text-xs text-muted-foreground">
              Import any key from the Discovery Vault — WIF or 64-char hex. Signing happens locally in your browser.
            </p>
          </div>

          <div className="inline-flex w-full rounded-lg border border-border bg-background p-1 gap-1">
            {(['btc', 'eth'] as WalletNetwork[]).map(n => (
              <button
                key={n}
                onClick={() => setNetwork(n)}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  network === n
                    ? n === 'btc'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {n === 'btc' ? '₿ Bitcoin' : 'Ξ Ethereum'}
              </button>
            ))}
          </div>

          {network === 'btc' && (
            <div className="grid grid-cols-3 gap-2">
              {BTC_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setAddrType(t.value)}
                  className={`rounded-lg border px-3 py-2 text-left transition-all ${
                    addrType === t.value
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-border hover:border-primary/30'
                  }`}
                >
                  <div className="text-xs font-medium">{t.label}</div>
                  <div className="text-[10px] font-mono text-muted-foreground">{t.hint}</div>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Private key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && unlock()}
                placeholder={network === 'btc' ? 'L… / K… (WIF) or hex' : '0x… hex'}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 pr-16 font-mono text-sm outline-none focus:border-primary/60"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                onClick={() => setShowKey(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {w.error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {w.error}
            </div>
          )}

          <button
            onClick={unlock}
            disabled={!keyInput.trim() || w.loading}
            className={`w-full rounded-lg py-3 text-sm font-semibold transition-all disabled:opacity-40 ${
              network === 'btc'
                ? 'bg-primary text-primary-foreground glow-mint'
                : 'bg-secondary text-secondary-foreground glow-blue'
            }`}
          >
            {w.loading ? 'Unlocking…' : 'Unlock Wallet'}
          </button>

          <p className="text-[10px] text-muted-foreground text-center">
            Keys are held in memory only — never stored, never transmitted.
          </p>
        </div>
      </div>
    );
  }

  // ── UNLOCKED STATE ──────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in max-w-3xl mx-auto space-y-4">
      {/* Balance card */}
      <div className={`rounded-xl border p-6 space-y-4 ${
        network === 'btc' ? 'border-primary/25 bg-primary/[0.04]' : 'border-secondary/25 bg-secondary/[0.04]'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {w.account.network === 'btc' ? `Bitcoin · ${w.account.addrType}` : 'Ethereum'}
            </div>
            <button
              onClick={() => copy(w.account!.address, 'Address')}
              className="font-mono text-sm text-foreground hover:text-primary break-all text-left"
            >
              {w.account.address}
            </button>
          </div>
          <button
            onClick={w.disconnect}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40"
          >
            Lock
          </button>
        </div>

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className={`font-mono text-3xl font-bold ${accent === 'primary' ? 'text-primary text-glow-mint' : 'text-secondary text-glow-blue'}`}>
              {w.balance ?? '—'} <span className="text-base">{unit}</span>
            </div>
            {w.unconfirmed && (
              <div className="text-xs text-muted-foreground font-mono">pending {w.unconfirmed} {unit}</div>
            )}
          </div>
          <button
            onClick={() => w.refresh(w.account)}
            disabled={w.loading}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary/40 disabled:opacity-40"
          >
            {w.loading ? 'Syncing…' : '↻ Refresh'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {w.account.wif && (
            <button
              onClick={() => copy(w.account!.wif!, 'WIF key')}
              className="rounded-md bg-accent/60 px-2.5 py-1 text-[11px] font-mono hover:bg-accent"
            >
              Copy WIF
            </button>
          )}
          <button
            onClick={() => copy(w.account!.privHex, 'Hex key')}
            className="rounded-md bg-accent/60 px-2.5 py-1 text-[11px] font-mono hover:bg-accent"
          >
            Copy Hex
          </button>
          <button
            onClick={() => setRevealPriv(v => !v)}
            className="rounded-md bg-accent/60 px-2.5 py-1 text-[11px] font-mono hover:bg-accent"
          >
            {revealPriv ? 'Hide key' : 'Reveal key'}
          </button>
        </div>
        {revealPriv && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 font-mono text-[11px] break-all text-destructive">
            {w.account.wif ? `WIF: ${w.account.wif}` : ''}
            {w.account.wif && <br />}
            HEX: {w.account.privHex}
          </div>
        )}
      </div>

      {/* Send card */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h3 className="text-sm font-semibold">Send {unit}</h3>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Recipient address</label>
          <input
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder={network === 'btc' ? 'bc1… / 1… / 3…' : '0x…'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-primary/60"
            spellCheck={false}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Amount</label>
            <button onClick={fillMax} className="text-[11px] text-primary hover:underline">Send max</button>
          </div>
          <div className="relative">
            <input
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00000000"
              inputMode="decimal"
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 pr-16 font-mono text-sm outline-none focus:border-primary/60"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">{unit}</span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">
            Network fee · {feeRate} {network === 'btc' ? 'sat/vB' : 'gwei'}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['slow', 'normal', 'fast'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded-lg border px-3 py-2 text-xs capitalize transition-all ${
                  speed === s ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/30'
                }`}
              >
                {s}
                <div className="font-mono text-[10px] text-muted-foreground">
                  {w.feeRates ? w.feeRates[s] : '—'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {w.error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive break-all">
            {w.error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={!canSend}
          className={`w-full rounded-lg py-3 text-sm font-semibold transition-all disabled:opacity-40 ${
            network === 'btc'
              ? 'bg-primary text-primary-foreground glow-mint'
              : 'bg-secondary text-secondary-foreground glow-blue'
          }`}
        >
          {w.sending ? 'Broadcasting…' : `Send ${unit}`}
        </button>

        {lastTx && (
          <a
            href={lastTx.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-mono text-primary break-all hover:bg-primary/10"
          >
            ✓ Broadcast · {short(lastTx.hash)} — view on explorer ↗
          </a>
        )}
      </div>

      {/* Activity */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <h3 className="text-sm font-semibold">Recent activity</h3>
        {w.txs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No transactions found for this address.</p>
        ) : (
          <div className="divide-y divide-border">
            {w.txs.map(tx => (
              <a
                key={tx.hash}
                href={tx.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 py-2.5 hover:bg-accent/30 px-1 rounded"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs truncate">{short(tx.hash)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {tx.time ? new Date(tx.time).toLocaleString() : 'pending'}
                    {!tx.confirmed && ' · unconfirmed'}
                  </div>
                </div>
                <div className={`font-mono text-xs shrink-0 ${
                  tx.direction === 'in' ? 'text-primary' : tx.direction === 'out' ? 'text-destructive' : 'text-muted-foreground'
                }`}>
                  {tx.direction === 'in' ? '+' : tx.direction === 'out' ? '−' : '±'}{tx.amount}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        Live wallet mode uses public block explorers for balances and broadcasting. Generation stays fully offline.
      </p>
    </div>
  );
}
