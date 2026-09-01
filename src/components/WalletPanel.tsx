import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, WalletCards, X, Trash2 } from 'lucide-react';
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [lastTx, setLastTx] = useState<{ hash: string; url: string } | null>(null);

  const activeNetwork = w.account?.network ?? network;
  const isBtc = activeNetwork === 'btc';
  const unit = isBtc ? 'BTC' : 'ETH';
  const feeRate = w.feeRates ? w.feeRates[speed] : isBtc ? 8 : 15;

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

  const openWallet = (address: string) => {
    w.switchTo(address);
    setPickerOpen(false);
    setAdding(false);
  };

  const picker = pickerOpen ? (
    <WalletPicker
      wallets={w.saved}
      activeAddress={w.account?.address}
      onPick={openWallet}
      onDelete={addr => w.forget(addr)}
      onClose={() => setPickerOpen(false)}
    />
  ) : null;

  // ── LOCKED STATE ────────────────────────────────────────────────────────
  if (!w.account) {
    const showForm = adding || w.saved.length === 0;
    return (
      <div className="animate-fade-in max-w-xl mx-auto space-y-4">
        {picker}
        <div className="rounded-xl border border-border bg-card p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{showForm ? 'Add Wallet' : 'Open Wallet'}</h2>
              <p className="text-xs text-muted-foreground">
                {showForm
                  ? 'Import a WIF or 64-char hex key. Signing happens locally.'
                  : `${w.saved.length} wallet${w.saved.length === 1 ? '' : 's'} saved on this device.`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {w.saved.length > 0 && (
                <button
                  onClick={() => setPickerOpen(true)}
                  title="Saved wallets"
                  className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground hover:border-primary/40"
                >
                  <WalletCards className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => setAdding(a => !a)}
                title={showForm ? 'Close' : 'Add wallet'}
                className={`rounded-lg border p-2 transition-all ${
                  showForm && w.saved.length > 0
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                }`}
              >
                {showForm && w.saved.length > 0 ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {!showForm && (
            <button
              onClick={() => setPickerOpen(true)}
              className="w-full rounded-lg border border-border px-4 py-6 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              Tap to choose a saved wallet
            </button>
          )}

          {showForm && (
            <>
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
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Private key
            </label>
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
            Keys stay on this device — never transmitted.
          </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── UNLOCKED STATE ──────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in max-w-3xl mx-auto space-y-4">
      {picker}
      {/* Wallet controls */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:border-primary/40"
        >
          <WalletCards className="h-4 w-4" />
          Saved wallets ({w.saved.length})
        </button>
        <button
          onClick={() => { w.disconnect(); setAdding(true); }}
          title="Add wallet"
          className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground hover:border-primary/40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>


      {/* Balance card */}
      <div className={`rounded-xl border p-6 space-y-4 ${
        isBtc ? 'border-primary/25 bg-primary/[0.04]' : 'border-secondary/25 bg-secondary/[0.04]'
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
            <div className={`font-mono text-3xl font-bold ${isBtc ? 'text-primary text-glow-mint' : 'text-secondary text-glow-blue'}`}>
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
            placeholder={isBtc ? 'bc1… / 1… / 3…' : '0x…'}
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
            Network fee · {feeRate} {isBtc ? 'sat/vB' : 'gwei'}
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
            isBtc
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

// ── Press-and-hold delete ─────────────────────────────────────────────────
function HoldToDelete({ onConfirm }: { onConfirm: () => void }) {
  const [pct, setPct] = useState(0);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setPct(0);
  };

  const begin = () => {
    stop();
    const started = Date.now();
    timer.current = window.setInterval(() => {
      const p = Math.min(100, ((Date.now() - started) / 1200) * 100);
      setPct(p);
      if (p >= 100) {
        stop();
        onConfirm();
      }
    }, 40);
  };

  return (
    <button
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      title="Press and hold to delete"
      className="relative shrink-0 overflow-hidden rounded-md border border-border p-2 text-muted-foreground hover:text-destructive hover:border-destructive/40"
    >
      <span
        className="absolute inset-0 bg-destructive/30 transition-none"
        style={{ width: `${pct}%` }}
      />
      <Trash2 className="relative h-3.5 w-3.5" />
    </button>
  );
}

// ── Saved wallets sheet ───────────────────────────────────────────────────
function WalletPicker({
  wallets,
  activeAddress,
  onPick,
  onDelete,
  onClose,
}: {
  wallets: { address: string; network: string; addrType?: string }[];
  activeAddress?: string;
  onPick: (address: string) => void;
  onDelete: (address: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 space-y-3 max-h-[70vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Saved wallets ({wallets.length})</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {wallets.length === 0 ? (
          <p className="text-xs text-muted-foreground">No wallets saved yet.</p>
        ) : (
          <div className="space-y-1.5">
            {wallets.map(s => (
              <div key={s.address} className="flex items-center gap-2">
                <button
                  onClick={() => onPick(s.address)}
                  className={`flex-1 min-w-0 rounded-lg border px-3 py-2.5 text-left transition-all ${
                    s.address === activeAddress
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  <div className="font-mono text-xs truncate">{short(s.address)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.network === 'btc' ? `Bitcoin · ${s.addrType}` : 'Ethereum'}
                  </div>
                </button>
                <HoldToDelete onConfirm={() => onDelete(s.address)} />
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground text-center">
          Tap a wallet to open it · press and hold the bin icon to delete
        </p>
      </div>
    </div>
  );
}
