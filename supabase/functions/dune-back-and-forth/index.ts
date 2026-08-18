import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const DUNE_API = "https://api.dune.com/api/v1";

const QUERY_IDS = {
  btc: 7465872,
  eth: 7465880,
};

async function executeQuery(queryId: number, apiKey: string) {
  const exec = await fetch(`${DUNE_API}/query/${queryId}/execute`, {
    method: "POST",
    headers: {
      "X-Dune-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      performance: "medium",
      query_parameters: { days: "7" },
    }),
  });
  if (!exec.ok) {
    throw new Error(`Dune execute failed [${exec.status}]: ${await exec.text()}`);
  }
  const { execution_id } = await exec.json();

  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await fetch(`${DUNE_API}/execution/${execution_id}/status`, {
      headers: { "X-Dune-API-Key": apiKey },
    });
    const sj = await status.json();
    if (sj.state === "QUERY_STATE_COMPLETED") break;
    if (sj.state === "QUERY_STATE_FAILED" || sj.state === "QUERY_STATE_CANCELLED") {
      throw new Error(`Dune query ${sj.state}: ${JSON.stringify(sj)}`);
    }
  }

  const results = await fetch(`${DUNE_API}/execution/${execution_id}/results?limit=100`, {
    headers: { "X-Dune-API-Key": apiKey },
  });
  if (!results.ok) {
    throw new Error(`Dune results failed [${results.status}]: ${await results.text()}`);
  }
  const rj = await results.json();
  return rj.result?.rows ?? [];
}

type Row = Record<string, unknown>;

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Keeps only pairs that behave like a closed loop:
 *  - both addresses' ONLY counterparty (within the result set) is each other
 *  - the relationship is genuinely bidirectional (both directions present when
 *    directional counts are available)
 *  - sustained activity (>= minInteractions) and reasonably balanced flow
 */
function filterExclusiveLoops(rows: Row[], minInteractions = 4): Row[] {
  const counterparties = new Map<string, Set<string>>();
  for (const r of rows) {
    const a = String(r.address_a ?? "");
    const b = String(r.address_b ?? "");
    if (!a || !b) continue;
    if (!counterparties.has(a)) counterparties.set(a, new Set());
    if (!counterparties.has(b)) counterparties.set(b, new Set());
    counterparties.get(a)!.add(b);
    counterparties.get(b)!.add(a);
  }

  const scored = rows.filter((r) => {
    const a = String(r.address_a ?? "");
    const b = String(r.address_b ?? "");
    if (!a || !b) return false;

    // exclusivity: neither side talks to anyone else in the set
    if ((counterparties.get(a)?.size ?? 0) !== 1) return false;
    if ((counterparties.get(b)?.size ?? 0) !== 1) return false;

    const total = num(r.total_interactions);
    if (total < minInteractions) return false;

    // directional balance when the query exposes per-direction counts
    const ab = num(r.a_to_b_txs ?? r.a_to_b ?? r.txs_a_to_b);
    const ba = num(r.b_to_a_txs ?? r.b_to_a ?? r.txs_b_to_a);
    if (ab > 0 || ba > 0) {
      if (ab === 0 || ba === 0) return false;
      const ratio = Math.min(ab, ba) / Math.max(ab, ba);
      if (ratio < 0.2) return false; // one-sided drain, not a real loop
    }
    return true;
  });

  return scored.sort((x, y) => num(y.total_interactions) - num(x.total_interactions));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("DUNE_API_KEY");
    if (!apiKey) throw new Error("DUNE_API_KEY not configured");

    const { chain, exclusiveLoops } = await req.json();
    if (!["btc", "eth"].includes(chain)) throw new Error("chain must be 'btc' or 'eth'");

    const allRows = await executeQuery(QUERY_IDS[chain as "btc" | "eth"], apiKey);
    const rows = exclusiveLoops ? filterExclusiveLoops(allRows) : allRows;

    return new Response(
      JSON.stringify({ rows, totalRows: allRows.length, filtered: !!exclusiveLoops }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("dune-back-and-forth error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
