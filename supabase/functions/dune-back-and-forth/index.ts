import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const DUNE_API = "https://api.dune.com/api/v1";

const QUERY_IDS = {
  btc: 7465872,
  eth: 7465880,
};

async function executeQuery(queryId: number, days: number, apiKey: string) {
  const exec = await fetch(`${DUNE_API}/query/${queryId}/execute`, {
    method: "POST",
    headers: {
      "X-Dune-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_parameters: { days: String(days) },
      performance: "medium",
    }),
  });
  if (!exec.ok) {
    throw new Error(`Dune execute failed [${exec.status}]: ${await exec.text()}`);
  }
  const { execution_id } = await exec.json();

  // Poll up to ~3 minutes (heavy chain scans)
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

  const results = await fetch(`${DUNE_API}/execution/${execution_id}/results`, {
    headers: { "X-Dune-API-Key": apiKey },
  });
  if (!results.ok) {
    throw new Error(`Dune results failed [${results.status}]: ${await results.text()}`);
  }
  const rj = await results.json();
  return rj.result?.rows ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("DUNE_API_KEY");
    if (!apiKey) throw new Error("DUNE_API_KEY not configured");

    const { chain, days } = await req.json();
    if (!["btc", "eth"].includes(chain)) throw new Error("chain must be 'btc' or 'eth'");
    const d = Number(days);
    if (!Number.isFinite(d) || d < 1 || d > 90) {
      throw new Error("days must be a number between 1 and 90");
    }

    const rows = await executeQuery(QUERY_IDS[chain as "btc" | "eth"], Math.floor(d), apiKey);

    return new Response(JSON.stringify({ rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("dune-back-and-forth error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
