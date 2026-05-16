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

function analyzePattern(txs: TxSummary[]) {
  if (txs.length < 2) return null;
  const sorted = [...txs].sort((a, b) => a.time - b.time);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].time - sorted[i - 1].time);
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0; // coefficient of variation
  // count counterparties
  const cpCount = new Map<string, number>();
  const cpVolume = new Map<string, number>();
  for (const t of txs) {
    if (!t.counterparty) continue;
    cpCount.set(t.counterparty, (cpCount.get(t.counterparty) ?? 0) + 1);
    cpVolume.set(t.counterparty, (cpVolume.get(t.counterparty) ?? 0) + t.value);
  }
  const topCounterparty = [...cpCount.entries()].sort((a, b) => b[1] - a[1])[0];
  // round-number ratio (humans use round amounts more often)
  const roundCount = txs.filter(t => {
    const v = t.value;
    if (v === 0) return false;
    const fixed = v.toFixed(4);
    return /\.0+$/.test(fixed) || /[1-9]0+$/.test(fixed.replace('.', ''));
  }).length;

  return {
    txCount: txs.length,
    meanGapSec: Math.round(mean),
    stddevGapSec: Math.round(stddev),
    coefficientOfVariation: Number(cv.toFixed(3)),
    uniqueCounterparties: cpCount.size,
    topCounterparty: topCounterparty ? {
      address: topCounterparty[0],
      txCount: topCounterparty[1],
      totalVolume: Number((cpVolume.get(topCounterparty[0]) ?? 0).toFixed(8)),
    } : null,
    roundValueRatio: Number((roundCount / txs.length).toFixed(3)),
    firstTx: new Date(sorted[0].time * 1000).toISOString(),
    lastTx: new Date(sorted[sorted.length - 1].time * 1000).toISOString(),
  };
}

async function classifyWithAi(stats: ReturnType<typeof analyzePattern>, chain: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const prompt = `Analyze this ${chain.toUpperCase()} wallet's transaction pattern and judge whether activity is automated (bot/script/exchange) or human-driven.

Stats:
${JSON.stringify(stats, null, 2)}

Heuristics:
- Low coefficient of variation in inter-tx gaps (<0.3) suggests automation
- Very high tx count concentrated to few counterparties suggests automation
- High round-value ratio suggests human behavior
- Highly random gaps + diverse counterparties + irregular values suggests human

Respond ONLY with valid JSON in this exact shape:
{"automationPercent": <0-100 integer>, "verdict": "<short label like 'Likely Bot' / 'Mostly Human' / 'Mixed'>", "reasoning": "<2-3 sentence explanation>"}`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
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
  catch { return { automationPercent: null, verdict: "Unknown", reasoning: content }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { address, chain } = await req.json();
    if (!address || !["btc", "eth"].includes(chain)) {
      throw new Error("address + chain ('btc'|'eth') required");
    }
    const txs = chain === "btc" ? await fetchBtcTxs(address) : await fetchEthTxs(address);
    const stats = analyzePattern(txs);
    if (!stats) {
      return new Response(JSON.stringify({
        stats: null,
        ai: { automationPercent: null, verdict: "Insufficient data", reasoning: "Need at least 2 transactions to analyze." },
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
