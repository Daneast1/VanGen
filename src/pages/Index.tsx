import { useState, useEffect, useCallback, useRef } from 'react';
import { useVanityGenerator } from '@/hooks/useVanityGenerator';
import PulseBackground from '@/components/PulseBackground';
import DiscoveryVault from '@/components/DiscoveryVault';

const BTC_TYPES = [
  { value: 'p2pkh', label: 'Legacy (P2PKH)', prefix: '1', charset: 'Base58', charsetSize: 58 },
  { value: 'p2sh', label: 'SegWit (P2SH)', prefix: '3', charset: 'Base58', charsetSize: 58 },
  { value: 'bech32', label: 'Native SegWit', prefix: 'bc1q', charset: 'Bech32', charsetSize: 32 },
];

function getDifficulty(prefix: string, charsetSize: number) {
  const n = prefix.length;
  if (n === 0) return { space: 1, display: '1' };
  const space = Math.pow(charsetSize, n);
  return {
    space,
    display: space > 1e12 ? space.toExponential(2) : space.toLocaleString(),
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

  // Entropy collection
  const handleMouseMove = useCallback((e: MouseEvent) => {
    entropyBuffer.current.push(e.clientX ^ e.clientY ^ Date.now());
    if (entropyBuffer.current.length >= 64) {
      const data = new Uint8Array(entropyBuffer.current.map(v => v & 0xff));
      gen.injectEntropy(data.buffer);
      setEntropyCount(prev => prev + entropyBuffer.current.length);
      entropyBuffer.current = [];
    }
  }, [gen]);

  const handleKeyPress = useCallback((e: KeyboardEvent) => {
    entropyBuffer.current.push(e.keyCode ^ Date.now());
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [handleMouseMove, handleKeyPress]);

  // Console security log
  useEffect(() => {
    console.log(
      '%c🔒 SECURITY NOTICE: This application makes ZERO external API calls. All cryptographic operations are performed locally in your browser.',
      'color: #00ff88; font-size: 14px; font-weight: bold;'
    );
  }, []);

  const currentType = BTC_TYPES.find(t => t.value === btcType) || BTC_TYPES[0];
  const charsetSize = network === 'eth' ? 16 : currentType.charsetSize;
  const totalPatternLen = prefix.length + suffix.length;
  const diff = getDifficulty(totalPatternLen > 0 ? 'x'.repeat(totalPatternLen) : '', charsetSize);
  const eta = gen.hashrate > 0 ? diff.space / gen.hashrate : Infinity;

  const validateChars = (val: string) => {
    if (!val) return true;
    if (network === 'eth') return /^[0-9a-fA-F]+$/.test(val);
    if (btcType === 'bech32') return /^[02-9ac-hj-np-z]+$/.test(val);
    return /^[1-9A-HJ-NP-Za-km-z]+$/.test(val);
  };

  const prefixValid = validateChars(prefix);
  const suffixValid = validateChars(suffix);
  const hasPattern = prefix.length > 0 || suffix.length > 0 || targetAddress.length > 0;

  const handleStart = () => {
    if (!hasPattern || (!targetAddress && (!prefixValid || !suffixValid))) return;
    gen.start({
      network,
      prefix: targetAddress ? '' : prefix,
      suffix: targetAddress ? '' : suffix,
      addressType: network === 'btc' ? btcType : 'eth',
      targetAddress: targetAddress || undefined,
    });
  };

  const showDifficultyWarning = totalPatternLen >= 6;

  return (
    <div className="relative min-h-screen bg-background">
      <PulseBackground hashrate={gen.hashrate} network={network} />

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 space-y-6 animate-fade-in">
        {/* Header */}
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

        {/* Network Toggle */}
        <div className="flex justify-center">
          <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
            <button
              onClick={() => { setNetwork('btc'); setPrefix(''); setSuffix(''); setTargetAddress(''); }}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                network === 'btc'
                  ? 'bg-primary text-primary-foreground glow-mint'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              ₿ Bitcoin
            </button>
            <button
              onClick={() => { setNetwork('eth'); setPrefix(''); setSuffix(''); setTargetAddress(''); }}
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

        {/* Generator Controls */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          {/* BTC Address Type */}
          {network === 'btc' && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Address Type</label>
              <div className="flex gap-2 flex-wrap">
                {BTC_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => { setBtcType(t.value); setPrefix(''); setSuffix(''); setTargetAddress(''); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono transition-all ${
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

          {/* Prefix & Suffix Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Prefix */}
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
                  Invalid characters for {network === 'eth' ? 'hex' : currentType.charset}
                </p>
              )}
            </div>

            {/* Suffix */}
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
                  Invalid characters for {network === 'eth' ? 'hex' : currentType.charset}
                </p>
              )}
            </div>
          </div>

          {/* Target Address */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Target Address <span className="normal-case font-normal">(optional — overrides prefix/suffix)</span>
            </label>
            <input
              type="text"
              value={targetAddress}
              onChange={e => setTargetAddress(e.target.value.trim())}
              placeholder={network === 'eth' ? '0x742d35Cc6634C0532925a3b844Bc9e7595f...' : currentType.prefix + '...'}
              disabled={gen.isRunning}
              className={`w-full bg-background border rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 transition-all ${
                isMint
                  ? 'border-border focus:ring-primary/50'
                  : 'border-border focus:ring-secondary/50'
              }`}
            />
            {targetAddress && (
              <p className="text-muted-foreground text-xs">
                🎯 Target mode: only this exact address will appear in results when found.
              </p>
            )}
          </div>

          {network === 'eth' && (prefix || suffix) && !targetAddress && (
            <p className="text-muted-foreground text-xs">
              Note: Hex matching is case-insensitive. EIP-55 checksum applied after match.
            </p>
          )}

          {/* Difficulty Display */}
          {hasPattern && prefixValid && suffixValid && !targetAddress && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Search Space" value={diff.display} />
              <Stat label="Charset" value={`${charsetSize} chars`} />
              <Stat label="Est. Time" value={gen.hashrate > 0 ? formatTime(eta) : '—'} />
              <Stat label="Difficulty" value={`${charsetSize}^${totalPatternLen}`} />
            </div>
          )}

          {showDifficultyWarning && !targetAddress && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-2 text-xs text-destructive">
              ⚠️ Combined pattern of {totalPatternLen}+ characters may take extremely long. Consider shorter values.
            </div>
          )}

          {/* Start/Stop */}
          <div className="flex gap-3">
            {!gen.isRunning ? (
              <button
                onClick={handleStart}
                disabled={!hasPattern || (!targetAddress && (!prefixValid || !suffixValid))}
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

        {/* Live Stats */}
        {gen.isRunning && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in">
            <StatCard
              label="Hashrate"
              value={`${gen.hashrate.toLocaleString()}/s`}
              accent={isMint}
            />
            <StatCard label="Workers" value={`${gen.workerCount}`} accent={isMint} />
            <StatCard label="Found" value={`${gen.results.length}`} accent={isMint} />
            <StatCard
              label="Entropy Events"
              value={`${entropyCount}`}
              accent={isMint}
            />
          </div>
        )}

        {/* Entropy Info */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm">🌧️ Entropy Rain</span>
            <span className="text-xs text-muted-foreground">
              Move your mouse or type to inject additional entropy
            </span>
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${isMint ? 'bg-primary' : 'bg-secondary'}`}
              style={{ width: `${Math.min(100, entropyCount / 5)}%` }}
            />
          </div>
        </div>

        {/* Discovery Vault */}
        <DiscoveryVault results={gen.results} onClear={gen.clearResults} />

        {/* Footer */}
        <footer className="text-center text-xs text-muted-foreground space-y-1 pb-8">
          <p>All keys generated locally using secp256k1 via @noble/curves</p>
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
    <div className={`rounded-lg border p-3 ${accent ? 'border-primary/20 bg-primary/5' : 'border-secondary/20 bg-secondary/5'}`}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`font-mono text-lg font-bold ${accent ? 'text-primary' : 'text-secondary'}`}>{value}</div>
    </div>
  );
}
