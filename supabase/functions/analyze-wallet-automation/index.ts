import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface TxSummary {
  time: number; // unix seconds
  counterparty: string | null;
  direction: "in" | "out";
  value: number; // BTC or ETH
}

async function fetchBtcTxs(address: string): Promise<TxSummary[]> {
  const r = await fetch(`https://blockstream.info/api/address/${address}/txs`);
  if (!r.ok) throw new Error(`Blockstream HTTP ${r.status}`);
  const txs = await r.json() as Array<{
    status?: { block_time?: number };
    vin: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } }>;
    vout: Array<{ scriptpubkey_address?: string; value?: number }>;
  }>;
  const out: TxSummary[] = [];
  for (const tx of txs.slice(0, 50)) {
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
    out.push({ time, counterparty, direction: isSender ? "out" : "in", value });
  }
  return out;
}

async function fetchEthTxs(address: string): Promise<TxSummary[]> {
  const url = `https://eth.blockscout.com/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=50`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Blockscout HTTP ${r.status}`);
  const data = await r.json();
  const txs = Array.isArray(data?.result) ? data.result : [];
  const lower = address.toLowerCase();
  return txs.map((tx: { timeStamp: string; from: string; to: string; value: string }) => {
    const isSender = tx.from?.toLowerCase() === lower;
    return {
      time: Number(tx.timeStamp) || 0,
      counterparty: (isSender ? tx.to : tx.from) ?? null,
      direction: isSender ? "out" : "in" as "in" | "out",
      value: Number(tx.value || 0) / 1e18,
    };
  });
}

function computeShannon(values: number[]): number {
  if (values.length === 0) return 0;
  const buckets = 10; // 10 equal-size buckets
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const hist = new Array(buckets).fill(0);
  for (const v of values) {
    const bucket = Math.min(Math.floor(((v - min) / range) * buckets), buckets - 1);
    hist[bucket]++;
  }
  let entropy = 0;
  for (const count of hist) {
    if (count === 0) continue;
    const p = count / values.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function analyzePattern(txs: TxSummary[], chain: 'btc' | 'eth') {
  if (txs.length < 2) return null;
  
  const sorted = [...txs].sort((a, b) => a.time - b.time);
  
  // ── Timing analysis ──────────────────────────────────────────────────
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i].time - sorted[i - 1].time);
  }
  
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0;
  
  // Extended timing stats
  const sorted_gaps = [...gaps].sort((a, b) => a - b);
  const median = sorted_gaps.length % 2 === 0
    ? (sorted_gaps[sorted_gaps.length / 2 - 1] + sorted_gaps[sorted_gaps.length / 2]) / 2
    : sorted_gaps[Math.floor(sorted_gaps.length / 2)];
  const min_gap = Math.min(...gaps);
  const max_gap = Math.max(...gaps);
  
  // ── Burst score: how often do txs come in tight clusters? ──────────
  let burst_count = 0;
  let in_burst = false;
  for (const g of gaps) {
    if (g < 60) { // sub-60s gap = burst candidate
      if (!in_burst) burst_count++;
      in_burst = true;
    } else {
      in_burst = false;
    }
  }
  const burst_score = gaps.length > 0 ? burst_count / gaps.length : 0;
  
  // ── Off-hours ratio (00:00–06:00 UTC) ────────────────────────────
  let off_hours_count = 0;
  for (const tx of sorted) {
    const hour = new Date(tx.time * 1000).getUTCHours();
    if (hour >= 0 && hour < 6) off_hours_count++;
  }
  const off_hours_ratio = sorted.length > 0 ? off_hours_count / sorted.length : 0;
  
  // ── Counterparty analysis ────────────────────────────────────────────
  const cpCount = new Map<string, number>();
  const cpVolume = new Map<string, number>();
  for (const t of txs) {
    if (!t.counterparty) continue;
    cpCount.set(t.counterparty, (cpCount.get(t.counterparty) ?? 0) + 1);
    cpVolume.set(t.counterparty, (cpVolume.get(t.counterparty) ?? 0) + t.value);
  }
  
  const topCounterparty = [...cpCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const self_loop_count = txs.filter(t => t.counterparty === txs[0].counterparty).length; // simplified
  const self_loop_ratio = txs.length > 0 ? self_loop_count / txs.length : 0;
  
  // ── Round-number ratio ───────────────────────────────────────────────
  const roundCount = txs.filter(t => {
    const v = t.value;
    if (v === 0) return false;
    const fixed = v.toFixed(4);
    return /\.0+$/.test(fixed) || /[1-9]0+$/.test(fixed.replace('.', ''));
  }).length;
  
  // ── Volume entropy ───────────────────────────────────────────────────
  const volumes = txs.map(t => t.value);
  const volumeEntropy = computeShannon(volumes);
  
  return {
    txCount: txs.length,
    meanGapSec: Math.round(mean),
    stddevGapSec: Math.round(stddev),
    medianGapSec: Math.round(median),
    minGapSec: Math.round(min_gap),
    maxGapSec: Math.round(max_gap),
    coefficientOfVariation: Number(cv.toFixed(3)),
    uniqueCounterparties: cpCount.size,
    topCounterparty: topCounterparty ? {
      address: topCounterparty[0],
      txCount: topCounterparty[1],
      totalVolume: Number((cpVolume.get(topCounterparty[0]) ?? 0).toFixed(chain === 'btc' ? 8 : 6)),
    } : null,
    roundValueRatio: Number((roundCount / txs.length).toFixed(3)),
    burstScore: Number(burst_score.toFixed(3)),
    offHoursRatio: Number(off_hours_ratio.toFixed(3)),
    volumeEntropyScore: Number(volumeEntropy.toFixed(3)),
    selfLoopRatio: Number(self_loop_ratio.toFixed(3)),
    firstTx: new Date(sorted[0].time * 1000).toISOString(),
    lastTx: new Date(sorted[sorted.length - 1].time * 1000).toISOString(),
  };
}

async function classifyWithAiExpert(stats: ReturnType<typeof analyzePattern>, chain: string, address: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    // Fallback to basic heuristic if no API key
    const cv = stats?.coefficientOfVariation ?? 1;
    const isAuto = cv < 0.3;
    return {
      automationPercent: isAuto ? 75 : 25,
      verdict: isAuto ? "LIKELY_AUTOMATED" : "LIKELY_MANUAL",
      confidence: "LOW",
      botType: null,
      reasoning: "Heuristic classification (API key not configured). CV analysis only.",
      signals: []
    };
  }

  const systemPrompt = `You are an elite blockchain forensics expert with 10+ years of experience analyzing on-chain wallet behavior to identify automated vs. manually-controlled addresses.

## Expert Classification Framework

### Automation Red Flags (High Confidence):
1. **CV < 0.25**: Mechanical timing with <25% variation = scheduler/bot
2. **Min gap < 60s**: Faster than human manual signing possible
3. **Off-hours ratio > 0.35**: Bot runs 24/7, no sleep pattern
4. **Round values > 0.7**: Programmatic amount selection
5. **Top counterparty > 80% of txs**: Automated relay/mixer pattern
6. **Burst score > 0.5**: Tight clusters separated by fixed pauses = scheduler
7. **Volume entropy < 1.0**: All txs near-identical size = fixed bot parameters
8. **txCount > 50 + unique partners < 3**: High volume, low diversity = auto

### Manual Indicators (High Confidence):
1. **CV > 1.5**: Chaotic human timing
2. **txCount < 10**: Too few for automation
3. **diverse partners**: ratio counterparties/txs > 0.4
4. **Long gaps (days)**: Human forgetfulness, vacations
5. **Varied volumes**: Irregular amounts
6. **Business hours clustering** (if detectable)

### Bot Type Classification:
- **MEV_BOT**: CV < 0.15, burst_score > 0.6, min_gap < 3s
- **DCA_BOT**: Weekly/monthly regular txs, single exchange, round amounts, high CV OK
- **RELAY_BOT**: >90% to one address, high volume, varied amounts
- **MIXING_BOT**: Many counterparties, uniform volumes, frequent
- **DRAIN_BOT**: Single destination, escalating volume, 24/7 activity
- **SCHEDULER_BOT**: Regular intervals, burst patterns, fixed amounts
- **ARBITRAGE_BOT**: Multiple counterparties, high txCount, sub-second gaps
- **MARKET_MAKER**: Balanced in/out, many partners, steady rhythm

## Output Format (JSON ONLY):
{
  "automationPercent": <0-100>,
  "verdict": "<HIGHLY_AUTOMATED|LIKELY_AUTOMATED|BORDERLINE|LIKELY_MANUAL|HIGHLY_MANUAL>",
  "confidence": "<HIGH|MEDIUM|LOW>",
  "botType": "<null or bot type>",
  "reasoning": "<2-3 technical sentences citing specific stats>",
  "signals": [
    {"name": "...", "weight": "<HIGH|MEDIUM|LOW>", "direction": "<AUTO|MANUAL|NEUTRAL>", "detail": "..."}
  ]
}

Be decisive: >85 for strong automation, <15 for strong manual, 40-60 only for genuinely ambiguous cases.`;

  const userPrompt = `Chain: ${chain.toUpperCase()}
Address: ${address}

Transaction Statistics:
- Total txs: ${stats.txCount}
- Mean gap: ${stats.meanGapSec}s
- Median gap: ${stats.medianGapSec}s  
- Min gap: ${stats.minGapSec}s
- Max gap: ${stats.maxGapSec}s
- Std dev: ${stats.stddevGapSec}s
- Coefficient of Variation: ${stats.coefficientOfVariation}
- Unique counterparties: ${stats.uniqueCounterparties}
- Counterparty diversity (partners/txs): ${(stats.uniqueCounterparties / stats.txCount).toFixed(3)}
- Round value ratio: ${stats.roundValueRatio}
- Burst score: ${stats.burstScore}
- Off-hours ratio (00-06 UTC): ${stats.offHoursRatio}
- Volume entropy (Shannon): ${stats.volumeEntropyScore}
- Self-loop ratio: ${stats.selfLoopRatio}
- Top counterparty: ${stats.topCounterparty ? `${stats.topCounterparty.txCount} txs (${((stats.topCounterparty.txCount / stats.txCount) * 100).toFixed(1)}%)` : 'none'}
- Period: ${stats.firstTx} to ${stats.lastTx}`;

  try {
    const r = await fetch("https://api.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3, // lower temp for more deterministic classification
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      console.error(`AI gateway error [${r.status}]: ${err}`);
      throw new Error(`AI gateway HTTP ${r.status}`);
    }

    const data = await r.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    
    try {
      const parsed = JSON.parse(content);
      return {
        automationPercent: typeof parsed.automationPercent === 'number' ? parsed.automationPercent : 50,
        verdict: parsed.verdict ?? "BORDERLINE",
        confidence: parsed.confidence ?? "MEDIUM",
        botType: parsed.botType ?? null,
        reasoning: parsed.reasoning ?? "Unable to classify",
        signals: Array.isArray(parsed.signals) ? parsed.signals : []
      };
    } catch (e) {
      console.error("JSON parse error:", e, "content:", content);
      return {
        automationPercent: 50,
        verdict: "BORDERLINE",
        confidence: "LOW",
        botType: null,
        reasoning: "AI response parse failed",
        signals: []
      };
    }
  } catch (err) {
    console.error("classifyWithAiExpert error:", err);
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  
  try {
    const { address, chain } = await req.json();
    
    if (!address || !["btc", "eth"].includes(chain)) {
      throw new Error("address + chain ('btc'|'eth') required");
    }

    // Fetch on-chain txs
    const txs = chain === "btc" 
      ? await fetchBtcTxs(address) 
      : await fetchEthTxs(address);
    
    // Analyze patterns
    const stats = analyzePattern(txs, chain as 'btc' | 'eth');
    
    if (!stats) {
      return new Response(JSON.stringify({
        stats: null,
        ai: {
          automationPercent: null,
          verdict: "Insufficient data",
          confidence: "LOW",
          botType: null,
          reasoning: "Need at least 2 transactions to analyze.",
          signals: []
        },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Classify with expert AI
    const ai = await classifyWithAiExpert(stats, chain, address);

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
