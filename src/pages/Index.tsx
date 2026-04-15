import { useState, useEffect, useCallback, useRef } from 'react';
import { useVanityGenerator } from '@/hooks/useVanityGenerator';
import PulseBackground from '@/components/PulseBackground';
import DiscoveryVault from '@/components/DiscoveryVault';

const BTC_TYPES = [
  { value: 'p2pkh', label: 'Legacy (P2PKH)', prefix: '1', charset: 'Base58', charsetSize: 58 },
  { value: 'p2sh', label: 'SegWit (P2SH)', prefix: '3', charset: 'Base58', charsetSize: 58 },
  { value: 'bech32', label: 'Native SegWit', prefix: 'bc1q', charset: 'Bech32', charsetSize: 32 },
];

function getDifficulty(patternLength: number, charsetSize: number) {
  if (patternLength === 0) return { space: 1, display: '1' };
  const space = Math.pow(charsetSize, patternLength);
  return {
    space,
    display: space >= 1e15
      ? space.toExponential(2)
      : space >= 1e9
        ? `${(space / 1e9).toFixed(1)}B`
        : space >= 1e6
          ? `${(space / 1e6).toFixed(1)}M`
          : space.toLocaleString(),
  };
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '∞';
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `~${(seconds / 3600).toFixed(1)}h`;
  if (seconds < 86400 * 365) return `~${(seconds / 86400).toFixed(1)}d`;
  return `~${(seconds / (86400 * 365)).toFixed(1)}y`;
}

function formatHashrate(h: number): string {
  if (h >= 1_000_000) return `${(h / 1_000_000).toFixed(2)}M/s`;
  if (h >= 1_000) return `${(h / 1_000).toFixed(1)}k/s`;
  return `${h}/s`;
}

export default function Index() {
  const [network, setNetwork] = useState<'btc' | 'eth'>('btc');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [btcType, setBtcType] = useState('p2pkh');
  const [targetAddress, setTargetAddress] = useState('');
  const [entropyCount, setEntropyCount] = useState(0);
  const entropyBuffer = useRef<number[]>([]);

  const gen = useVanityGenerator();
  const isMint = network === 'btc';

  // ── Entropy Collection ────────────────────────────────────────────────────
  // Mouse and keyboard events are collected in a buffer and flushed to workers
  // every 64 events. This genuinely adds entropy to the key generation pool.
  const flushEntropy = useCallback(() => {
    if (entropyBuffer.current.length === 0) return;
    const data = new Uint8Array(entropyBuffer.current.map(v => v & 0xff));
    gen.injectEntropy(data.buffer);
    setEntropyCount(prev => prev + entropyBuffer.current.length);
    entropyBuffer.current = [];
  }, [gen]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    // Mix position + timing for unpredictability
    entropyBuffer.current.push(
      (e.clientX ^ e.clientY ^ (Date.now() & 0xff)) & 0xff
    );
    if (entropyBuffer.current.length >= 64) flushEntropy();
  }, [flushEntropy]);

  const handleKeyPress = useCallback((e: KeyboardEvent) => {
    entropyBuffer.current.push(
      (e.keyCode ^ (Date.now() & 0xff)) & 0xff
    );
    if (entropyBuffer.current.length >= 16) flushEntropy();
  }, [flushEntropy]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [handleMouseMove, handleKeyPress]);

  // ── Security Console Certification ───────────────────────────────────────
  useEffect(() => {
    console.log(
      '%c🔒 SECURITY NOTICE\n' +
      'This application makes ZERO external API calls during address generation.\n' +
      'All cryptographic operations (secp256k1 key derivation, SHA-256, RIPEMD-160,\n' +
      'Keccak-256, Base58Check, Bech32, EIP-55) are performed 100% locally in your browser.\n' +
      'No private keys ever leave your device.',
      'color: #00ff88; font-size: 13px; font-weight: bold; background: #0a0a0a; padding: 8px;'
    );
    console.log(
      '%c✅ AIR-GAP READY: This SPA functions fully offline once loaded.',
      'color: #00ff88; font-size: 12px;'
    );
  }, []);

  // ── Derived State ─────────────────────────────────────────────────────────
  const currentType = BTC_TYPES.find(t => t.value === btcType) || BTC_TYPES[0];
  const charsetSize = network === 'eth' ? 16 : currentType.charsetSize;
  const totalPatternLen = prefix.length + suffix.length;
  const diff = getDifficulty(totalPatternLen, charsetSize);
  // ETA uses the TOTAL hashrate across all workers
  const eta = gen.hashrate > 0 ? diff.space / gen.hashrate : Infinity;

  // ── Input Validation ──────────────────────────────────────────────────────
  const validateChars = (val: string): boolean => {
    if (!val) return true;
    if (network === 'eth') return /^[0-9a-fA-F]+$/.test(val);
    if (btcType === 'bech32') return /^[02-9ac-hj-np-z]+$/.test(val); // Bech32 charset
    return /^[1-9A-HJ-NP-Za-km-z]+$/.test(val); // Base58 charset
  };

  const prefixValid = validateChars(prefix);
  const suffixValid = validateChars(suffix);
  const hasPattern = prefix.length > 0 || suffix.length > 0 || targetAddress.length > 0;
  const canStart = hasPattern && (targetAddress.length > 0 || (prefixValid && suffixValid));

  const handleStart = () => {
    if (!canStart) return;
    gen.start({
      network,
      prefix: targetAddress ? '' : prefix,
      suffix: targetAddress ? '' : suffix,
      addressType: network === 'btc' ? btcType : 'eth',
      targetAddress: targetAddress || undefined,
    });
  };

  const handleNetworkSwitch = (net: 'btc' | 'eth') => {
    if (gen.isRunning) gen.stop();
    setNetwork(net);
    setPrefix('');
    setSuffix('');
    setTargetAddress('');
  };

  // Difficulty warning: 6+ chars is manageable but warn; 10+ is extreme
  const showModerateWarning = totalPatternLen >= 6 && totalPatternLen < 10 && !targetAddress;
  const showExtremeWarning = totalPatternLen >= 10 && !targetAddress;

  return (
    <div className="relative min-h-screen bg-background">
      <PulseBackground hashrate={gen.hashrate} network={network} />

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 space-y-6 animate-fade-in">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className={isMint ? 'text-primary text-glow-mint' : 'text-secondary text-glow-blue'}>
              Vanity Address Generator
            </span>
          </h1>
          <p className="text-muted-foreground text-sm">
            Security-first, client-side cryptographic address generation
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            ZERO EXTERNAL CALLS · AIR-GAP READY
          </div>
        </header>

        {/* ── Network Toggle ──────────────────────────────────────────────── */}
        <div className="flex justify-center">
          <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
            <button
              onClick={() => handleNetworkSwitch('btc')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                network === 'btc'
                  ? 'bg-primary text-primary-foreground glow-mint'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              ₿ Bitcoin
            </button>
            <button
              onClick={() => handleNetworkSwitch('eth')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                network === 'eth'
                  ? 'bg-secondary text-secondary-foreground glow-blue'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Ξ Ethereum
            </button>
          </div>
        </div>

        {/* ── Generator Controls ──────────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">

          {/* BTC Address Type */}
          {network === 'btc' && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Address Type
              </label>
              <div className="flex gap-2 flex-wrap">
                {BTC_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => {
                      setBtcType(t.value);
                      setPrefix('');
                      setSuffix('');
                      setTargetAddress('');
                    }}
                    disabled={gen.isRunning}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono transition-all disabled:opacity-50 ${
                      btcType === t.value
                        ? 'bg-primary/20 text-primary border border-primary/30'
                        : 'bg-accent text-muted-foreground hover:text-foreground border border-transparent'
                    }`}
                  >
                    {t.label} ({t.prefix}...)
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Prefix & Suffix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Desired Prefix
              </label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-mono text-sm shrink-0">
                  {network === 'eth' ? '0x' : currentType.prefix}
                </span>
                <input
                  type="text"
                  value={prefix}
                  onChange={e => setPrefix(e.target.value)}
                  placeholder={network === 'eth' ? 'dead, cafe...' : 'abc...'}
                  disabled={gen.isRunning}
                  className={`flex-1 min-w-0 bg-background border rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 transition-all ${
                    !prefixValid
                      ? 'border-destructive focus:ring-destructive'
                      : isMint
                        ? 'border-border focus:ring-primary/50'
                        : 'border-border focus:ring-secondary/50'
                  }`}
                />
              </div>
              {!prefixValid && (
                <p className="text-destructive text-xs">
                  Invalid chars for {network === 'eth' ? 'hex (0-9, a-f)' : currentType.charset}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Desired Suffix
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={suffix}
                  onChange={e => setSuffix(e.target.value)}
                  placeholder={network === 'eth' ? 'beef, face...' : 'xyz...'}
                  disabled={gen.isRunning}
                  className={`flex-1 min-w-0 bg-background border rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 transition-all ${
                    !suffixValid
                      ? 'border-destructive focus:ring-destructive'
                      : isMint
                        ? 'border-border focus:ring-primary/50'
                        : 'border-border focus:ring-secondary/50'
                  }`}
                />
                <span className="text-muted-foreground font-mono text-xs shrink-0">...end</span>
              </div>
              {!suffixValid && (
                <p className="text-destructive text-xs">
                  Invalid chars for {network === 'eth' ? 'hex (0-9, a-f)' : currentType.charset}
                </p>
              )}
            </div>
          </div>

          {/* Ethereum case-insensitive note */}
          {network === 'eth' && (prefix || suffix) && !targetAddress && (
            <p className="text-muted-foreground text-xs">
              ℹ️ Hex matching is case-insensitive. EIP-55 checksum is applied after the match is found.
            </p>
          )}

          {/* Target Address */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Target Address{' '}
              <span className="normal-case font-normal text-muted-foreground">
                (optional — overrides prefix/suffix)
              </span>
            </label>
            <input
              type="text"
              value={targetAddress}
              onChange={e => setTargetAddress(e.target.value.trim())}
              placeholder={
                network === 'eth'
                  ? '0x742d35Cc6634C0532925a3b844Bc9e7595f...'
                  : currentType.prefix + '...'
              }
              disabled={gen.isRunning}
              className={`w-full bg-background border rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 transition-all ${
                isMint
                  ? 'border-border focus:ring-primary/50'
                  : 'border-border focus:ring-secondary/50'
              }`}
            />
            {targetAddress && (
              <p className="text-muted-foreground text-xs">
                🎯 Target mode: searching for this exact address only.
              </p>
            )}
          </div>

          {/* Real-Time Difficulty Engine */}
          {hasPattern && prefixValid && suffixValid && !targetAddress && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Search Space" value={diff.display} />
              <Stat label="Charset" value={`${charsetSize} chars`} />
              <Stat
                label="Est. Time"
                value={gen.hashrate > 0 ? formatTime(eta) : '—'}
              />
              <Stat label="Difficulty" value={`${charsetSize}^${totalPatternLen}`} />
            </div>
          )}

          {/* Difficulty Warnings */}
          {showModerateWarning && (
            <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 px-4 py-2 text-xs text-yellow-400">
              ⚠️ {totalPatternLen}-character pattern: search space is {diff.display}. This may take a while depending on your device.
            </div>
          )}
          {showExtremeWarning && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-2 text-xs text-destructive font-medium">
              🚨 {totalPatternLen}+ character pattern: search space is {diff.display}. This could take years on consumer hardware. Are you sure?
            </div>
          )}

          {/* Start / Stop */}
          <div className="flex gap-3">
            {!gen.isRunning ? (
              <button
                onClick={handleStart}
                disabled={!canStart}
                className={`flex-1 py-3 rounded-lg font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                  isMint
                    ? 'bg-primary text-primary-foreground hover:opacity-90 glow-mint'
                    : 'bg-secondary text-secondary-foreground hover:opacity-90 glow-blue'
                }`}
              >
                ⚡ Start Generating ({gen.workerCount} threads)
              </button>
            ) : (
              <button
                onClick={gen.stop}
                className="flex-1 py-3 rounded-lg font-semibold text-sm bg-destructive text-destructive-foreground hover:opacity-90 transition-all"
              >
                ■ Stop
              </button>
            )}
          </div>
        </div>

        {/* ── Live Stats ──────────────────────────────────────────────────── */}
        {gen.isRunning && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in">
            <StatCard
              label="Hashrate"
              value={formatHashrate(gen.hashrate)}
              accent={isMint}
            />
            <StatCard
              label="Workers"
              value={`${gen.workerCount}`}
              accent={isMint}
            />
            <StatCard
              label="Found"
              value={`${gen.results.length}`}
              accent={isMint}
            />
            <StatCard
              label="Entropy Events"
              value={`${entropyCount}`}
              accent={isMint}
            />
          </div>
        )}

        {/* ── Entropy Rain ────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">🌧️ Entropy Rain</span>
            <span className="text-xs text-muted-foreground">
              Move your mouse, type below, or use both to inject entropy
            </span>
          </div>
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            rows={2}
            placeholder="Type anything here to add entropy… mash your keyboard, paste random text, etc."
            onChange={(e) => {
              const text = e.target.value;
              if (!text) return;
              const encoder = new TextEncoder();
              const bytes = encoder.encode(text);
              // Mix each byte with timestamp for extra unpredictability
              const mixed: number[] = [];
              for (let i = 0; i < bytes.length; i++) {
                mixed.push((bytes[i] ^ (Date.now() & 0xff) ^ (i * 37)) & 0xff);
              }
              const data = new Uint8Array(mixed);
              gen.injectEntropy(data.buffer);
              setEntropyCount(prev => prev + mixed.length);
            }}
          />
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isMint ? 'bg-primary' : 'bg-secondary'}`}
              style={{ width: `${Math.min(100, (entropyCount / 500) * 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">
            {entropyCount} entropy events collected
          </p>
        </div>

        {/* ── Discovery Vault ─────────────────────────────────────────────── */}
        <DiscoveryVault results={gen.results} onClear={gen.clearResults} />

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="text-center text-xs text-muted-foreground space-y-1 pb-8">
          <p className="font-mono">
            All keys generated locally · secp256k1 via @noble/curves · SHA-256/RIPEMD-160/Keccak-256 via @noble/hashes
          </p>
          <p>This app works fully offline once loaded · No data leaves your device</p>
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-accent/50 px-3 py-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${
      accent
        ? 'border-primary/20 bg-primary/5'
        : 'border-secondary/20 bg-secondary/5'
    }`}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`font-mono text-lg font-bold ${accent ? 'text-primary' : 'text-secondary'}`}>
        {value}
      </div>
    </div>
  );
}
