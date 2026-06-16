import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface TxSummary {
  time: number;            // unix seconds
  counterparty: string | null;
  direction: "in" | "out";
  value: number;           // BTC or ETH
  gasPrice?: number;       // gwei (ETH only)
  isContract?: boolean;    // ETH only — interacted with contract
  methodId?: string | null;// ETH only — first 4 bytes of input
  fee?: number;            // BTC fee in BTC / ETH fee in ETH
}

// ── BTC fetch (Blockstream, up to 200 txs via pagination) ──────────────────
async function fetchBtcTxs(address: string): Promise<TxSummary[]> {
  const all: TxSummary[] = [];
  let lastSeenTxid: string | null = null;
  for (let page = 0; page < 4 && all.length < 200; page++) {
    const url = lastSeenTxid
      ? `https://blockstream.info/api/address/${address}/txs/chain/${lastSeenTxid}`
      : `https://blockstream.info/api/address/${address}/txs`;
    const r = await fetch(url);
    if (!r.ok) break;
    const txs = await r.json() as Array<{
      txid: string;
      fee?: number;
      status?: { block_time?: number };
      vin: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } }>;
      vout: Array<{ scriptpubkey_address?: string; value?: number }>;
    }>;
    if (!txs.length) break;
    for (const tx of txs) {
      const time = tx.status?.block_time ?? 0;
      const inputAddrs = tx.vin.map(i => i.prevout?.scriptpubkey_address).filter(Boolean) as string[];
      const isSender = inputAddrs.includes(address);
      let counterparty: string | null = null;
      let value = 0;
      if (isSender) {
        const o = tx.vout.find(v => v.scriptpubkey_address && v.scriptpubkey_address !== address);
        counterparty = o?.scriptpubkey_address ?? null;
        value = (o?.value ?? 0) / 1e8;
      } else {
        counterparty = inputAddrs.find(a => a !== address) ?? inputAddrs[0] ?? null;
        const received = tx.vout.filter(v => v.scriptpubkey_address === address)
          .reduce((s, v) => s + (v.value ?? 0), 0);
        value = received / 1e8;
      }
      all.push({
        time, counterparty,
        direction: isSender ? "out" : "in",
        value,
        fee: (tx.fee ?? 0) / 1e8,
      });
    }
    lastSeenTxid = txs[txs.length - 1].txid;
    if (txs.length < 25) break;
  }
  return all;
}

// ── ETH fetch (Blockscout, up to 200 txs) ──────────────────────────────────
async function fetchEthTxs(address: string): Promise<TxSummary[]> {
  const url = `https://eth.blockscout.com/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=200`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Blockscout HTTP ${r.status}`);
  const data = await r.json();
  const txs = Array.isArray(data?.result) ? data.result : [];
  const lower = address.toLowerCase();
  return txs.map((tx: any) => {
    const isSender = tx.from?.toLowerCase() === lower;
    const input = (tx.input as string | undefined) ?? "0x";
    const isContract = input.length > 2 || tx.contractAddress;
    const methodId = input.length >= 10 ? input.slice(0, 10) : null;
    const gasPrice = Number(tx.gasPrice || 0) / 1e9;
    const gasUsed = Number(tx.gasUsed || 0);
    const fee = (Number(tx.gasPrice || 0) * gasUsed) / 1e18;
    return {
      time: Number(tx.timeStamp) || 0,
      counterparty: (isSender ? tx.to : tx.from) ?? null,
      direction: isSender ? "out" : "in" as "in" | "out",
      value: Number(tx.value || 0) / 1e18,
      gasPrice,
      isContract,
      methodId,
      fee,
    };
  });
}

// ── Feature Engineering ────────────────────────────────────────────────────
function analyzePattern(txs: TxSummary[], chain: "btc" | "eth") {
  if (txs.length < 3) return null;
  const sorted = [...txs].sort((a, b) => a.time - b.time);

  // 1) Inter-tx gap statistics
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].time - sorted[i - 1].time);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0;
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];

  // 2) Cron / fixed-interval signature (within ±2% of mode)
  const gapBuckets = new Map<number, number>();
  for (const g of gaps) {
    const bucket = Math.round(g / 60) * 60; // round to minute
    gapBuckets.set(bucket, (gapBuckets.get(bucket) ?? 0) + 1);
  }
  const topGapBucket = [...gapBuckets.entries()].sort((a, b) => b[1] - a[1])[0];
  const cronLikeRatio = topGapBucket ? topGapBucket[1] / gaps.length : 0;

  // 3) Burst detection (≥3 txs within 60s)
  let burstCount = 0;
  let maxBurst = 0;
  for (let i = 0; i < sorted.length; i++) {
    let n = 1;
    while (i + n < sorted.length && sorted[i + n].time - sorted[i].time <= 60) n++;
    if (n >= 3) { burstCount++; maxBurst = Math.max(maxBurst, n); i += n - 1; }
  }

  // 4) Sub-minute gaps (humans rarely do this manually & repeatedly)
  const subMinuteGaps = gaps.filter(g => g > 0 && g < 60).length;
  const subMinuteRatio = subMinuteGaps / gaps.length;

  // 5) Hour-of-day & sleep window (UTC). Humans typically have a 6-9hr quiet stretch.
  const hourBuckets = new Array(24).fill(0);
  for (const tx of sorted) hourBuckets[new Date(tx.time * 1000).getUTCHours()]++;
  const totalHourCount = hourBuckets.reduce((s, n) => s + n, 0) || 1;
  const hourEntropy = -hourBuckets
    .map(n => n / totalHourCount)
    .filter(p => p > 0)
    .reduce((s, p) => s + p * Math.log2(p), 0); // 0 (one hour) → 4.58 (uniform)
  let longestQuietHrs = 0;
  for (let start = 0; start < 24; start++) {
    let run = 0;
    for (let k = 0; k < 24; k++) {
      if (hourBuckets[(start + k) % 24] === 0) run++;
      else { longestQuietHrs = Math.max(longestQuietHrs, run); run = 0; }
    }
    longestQuietHrs = Math.max(longestQuietHrs, run);
  }

  // 6) Weekday vs weekend (humans skew weekdays for work-related on-chain ops)
  const dowBuckets = new Array(7).fill(0);
  for (const tx of sorted) dowBuckets[new Date(tx.time * 1000).getUTCDay()]++;
  const weekendShare = (dowBuckets[0] + dowBuckets[6]) / totalHourCount;

  // 7) Round-value behavior (humans prefer round amounts)
  const roundCount = sorted.filter(t => {
    if (t.value === 0) return false;
    const s = t.value.toString();
    return /^\d+(\.0+)?$/.test(s) || /\.\d?[1-9]?0{3,}$/.test(s.padEnd(8, "0"));
  }).length;
  const roundValueRatio = roundCount / sorted.length;

  // 8) Identical / near-identical repeated values (bots resend the same amount)
  const valueBuckets = new Map<string, number>();
  for (const t of sorted) {
    if (t.value === 0) continue;
    const k = t.value.toFixed(6);
    valueBuckets.set(k, (valueBuckets.get(k) ?? 0) + 1);
  }
  const topValueRepeat = [...valueBuckets.values()].sort((a, b) => b - a)[0] ?? 0;
  const repeatedValueRatio = topValueRepeat / sorted.length;

  // 9) Counterparty concentration (Herfindahl-style)
  const cpCount = new Map<string, number>();
  const cpVolume = new Map<string, number>();
  for (const t of sorted) {
    if (!t.counterparty) continue;
    cpCount.set(t.counterparty, (cpCount.get(t.counterparty) ?? 0) + 1);
    cpVolume.set(t.counterparty, (cpVolume.get(t.counterparty) ?? 0) + t.value);
  }
  const topCp = [...cpCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const hhi = [...cpCount.values()]
    .map(c => (c / sorted.length) ** 2)
    .reduce((s, x) => s + x, 0); // 1 = all to one cp, ~0 = highly diverse

  // 10) ETH-specific: contract interaction ratio, method diversity, gas-price stability
  let contractRatio = 0;
  let uniqueMethods = 0;
  let topMethodId: string | null = null;
  let topMethodShare = 0;
  let gasStdDev = 0;
  let gasMean = 0;
  if (chain === "eth") {
    const contractTxs = sorted.filter(t => t.isContract).length;
    contractRatio = contractTxs / sorted.length;
    const methods = new Map<string, number>();
    for (const t of sorted) if (t.methodId) methods.set(t.methodId, (methods.get(t.methodId) ?? 0) + 1);
    uniqueMethods = methods.size;
    const tm = [...methods.entries()].sort((a, b) => b[1] - a[1])[0];
    if (tm) { topMethodId = tm[0]; topMethodShare = tm[1] / sorted.length; }
    const gasPrices = sorted.map(t => t.gasPrice ?? 0).filter(g => g > 0);
    if (gasPrices.length > 1) {
      gasMean = gasPrices.reduce((s, g) => s + g, 0) / gasPrices.length;
      const v = gasPrices.reduce((s, g) => s + (g - gasMean) ** 2, 0) / gasPrices.length;
      gasStdDev = Math.sqrt(v);
    }
  }

  // 11) Lifespan & velocity
  const lifespanSec = sorted[sorted.length - 1].time - sorted[0].time;
  const lifespanDays = Math.max(1, lifespanSec / 86400);
  const txPerDay = sorted.length / lifespanDays;

  return {
    chain,
    txCount: sorted.length,
    lifespanDays: Number(lifespanDays.toFixed(2)),
    txPerDay: Number(txPerDay.toFixed(3)),
    firstTx: new Date(sorted[0].time * 1000).toISOString(),
    lastTx: new Date(sorted[sorted.length - 1].time * 1000).toISOString(),

    timing: {
      meanGapSec: Math.round(mean),
      medianGapSec: Math.round(medianGap),
      stddevGapSec: Math.round(stddev),
      coefficientOfVariation: Number(cv.toFixed(3)),
      cronLikeRatio: Number(cronLikeRatio.toFixed(3)),
      cronLikeIntervalSec: topGapBucket ? topGapBucket[0] : null,
      burstCount,
      maxBurstSize: maxBurst,
      subMinuteGapRatio: Number(subMinuteRatio.toFixed(3)),
    },

    schedule: {
      hourEntropyBits: Number(hourEntropy.toFixed(2)),   // 0–4.58
      longestQuietHoursUtc: longestQuietHrs,
      weekendShare: Number(weekendShare.toFixed(3)),
      hourHistogramUtc: hourBuckets,
    },

    values: {
      roundValueRatio: Number(roundValueRatio.toFixed(3)),
      repeatedValueRatio: Number(repeatedValueRatio.toFixed(3)),
    },

    counterparties: {
      unique: cpCount.size,
      herfindahlIndex: Number(hhi.toFixed(3)),
      top: topCp ? {
        address: topCp[0],
        txCount: topCp[1],
        totalVolume: Number((cpVolume.get(topCp[0]) ?? 0).toFixed(8)),
      } : null,
    },

    ...(chain === "eth" ? {
      ethereum: {
        contractInteractionRatio: Number(contractRatio.toFixed(3)),
        uniqueMethodIds: uniqueMethods,
        topMethodId,
        topMethodShare: Number(topMethodShare.toFixed(3)),
        gasPriceMeanGwei: Number(gasMean.toFixed(2)),
        gasPriceStdDevGwei: Number(gasStdDev.toFixed(2)),
        gasPriceCv: gasMean > 0 ? Number((gasStdDev / gasMean).toFixed(3)) : 0,
      },
    } : {}),
  };
}

// ── AI classification ──────────────────────────────────────────────────────
async function classifyWithAi(stats: ReturnType<typeof analyzePattern>, chain: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const systemPrompt = `You are an expert blockchain forensics analyst specialising in distinguishing automated wallet behaviour (bots, MEV searchers, exchange hot wallets, market makers, scheduled scripts, drainers) from human-controlled wallets (retail traders, treasuries operated by humans, NFT collectors, casual DeFi users).

You will receive a rigorously computed feature set extracted from on-chain transaction history. Reason through ALL of these signals before answering — do not anchor on a single metric:

STRONG AUTOMATION SIGNALS (each ≈ +15-25%):
• coefficientOfVariation in inter-tx gaps < 0.25  (highly regular cadence)
• cronLikeRatio > 0.4 with cronLikeIntervalSec a round number (60, 300, 600, 3600) — classic scheduler
• subMinuteGapRatio > 0.3 sustained across many txs — humans can't manually click that fast repeatedly
• burstCount > 5 with maxBurstSize ≥ 5 and tight gas/value reuse — bot batch
• longestQuietHoursUtc < 3 AND hourEntropyBits > 3.8 — 24/7 uniform activity (no sleep)
• herfindahlIndex > 0.6 with topCounterparty.txCount very high — narrow ops loop (MM/CEX router/drainer)
• repeatedValueRatio > 0.4 — same amount over and over (faucet, drainer, MEV)
• ETH: gasPriceCv < 0.05 AND topMethodShare > 0.7 — same contract method at near-constant gas
• ETH: contractInteractionRatio > 0.95 with uniqueMethodIds ≤ 2 — single-purpose bot
• txPerDay > 50 sustained — almost certainly automated

STRONG HUMAN SIGNALS (each ≈ +15-25%):
• coefficientOfVariation > 1.5 — irregular, bursty in a "human" way
• roundValueRatio > 0.35 — humans like 0.1, 0.5, 1, 10 ETH/BTC
• longestQuietHoursUtc ≥ 6 — a sleep window
• weekendShare clearly < 2/7 (≈0.28) OR clearly > 2/7 with low overall volume — human schedule
• ETH: uniqueMethodIds ≥ 6 with contractInteractionRatio between 0.2–0.8 — exploring DeFi like a person
• counterparties.unique > 20 with herfindahlIndex < 0.15 — diverse social/DeFi graph
• Low txPerDay (<2) with mixed values & varied counterparties

MIXED / AMBIGUOUS:
• Human using a trading frontend can produce moderate regularity → look at sleep window & method diversity to break the tie
• Exchange deposit wallets look automated on the OUT side but receive from humans on the IN side
• Treasury multisigs can have low cadence but very regular round amounts — call those "Human-Operated"

Output JSON ONLY with this exact schema:
{
  "automationPercent": <integer 0-100, your best calibrated estimate>,
  "verdict": "<one of: 'Pure Bot', 'Likely Bot', 'Mixed', 'Likely Human', 'Pure Human', 'Exchange/CEX', 'MEV Searcher', 'Market Maker', 'Drainer/Scam', 'Treasury/Multisig'>",
  "confidence": "<'low' | 'medium' | 'high'>",
  "topSignals": [<3-5 short strings naming the specific features that drove the verdict, e.g. "cronLikeRatio=0.82 @ 300s", "no sleep window", "gasPriceCv=0.02">],
  "reasoning": "<3-5 sentences explaining the verdict, citing actual numeric values from the stats, not generic theory>"
}

Be decisive. Avoid "Mixed" unless signals genuinely contradict. If txCount < 10, drop confidence to "low" and say so.`;

  const userPrompt = `Chain: ${chain.toUpperCase()}

Features:
${JSON.stringify(stats, null, 2)}

Classify this wallet now.`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });
  if (!r.ok) {
    if (r.status === 429) throw new Error("AI rate limit exceeded — try again shortly");
    if (r.status === 402) throw new Error("AI credits exhausted — add credits in Workspace settings");
    throw new Error(`AI gateway HTTP ${r.status}: ${await r.text()}`);
  }
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  try { return JSON.parse(content); }
  catch { return { automationPercent: null, verdict: "Unknown", confidence: "low", topSignals: [], reasoning: content }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { address, chain } = await req.json();
    if (!address || !["btc", "eth"].includes(chain)) {
      throw new Error("address + chain ('btc'|'eth') required");
    }
    const txs = chain === "btc" ? await fetchBtcTxs(address) : await fetchEthTxs(address);
    const stats = analyzePattern(txs, chain);
    if (!stats) {
      return new Response(JSON.stringify({
        stats: null,
        ai: { automationPercent: null, verdict: "Insufficient data", confidence: "low", topSignals: [], reasoning: "Need at least 3 transactions to analyse." },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const ai = await classifyWithAi(stats, chain);
    return new Response(JSON.stringify({ stats, ai }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("analyze-wallet-automation error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
