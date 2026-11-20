// Supabase Edge Function "scan": reads one scanned page with Claude and returns JSON.
// Secrets needed: ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL).
// Deploy with --no-verify-jwt: this function checks the user's sign-in itself.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("No JSON in model reply");
  return JSON.parse(t.slice(a, b + 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  // 1. Only signed-in users may spend the API key
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u, error: ue } = await sb.auth.getUser();
  if (ue || !u?.user) return json(401, { error: "Not signed in" });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json(503, { error: "ANTHROPIC_API_KEY is not set" });

  // 2. Read and limit the request
  let body: { prompt?: string; images?: { media_type: string; data: string }[] };
  try { body = await req.json(); } catch { return json(400, { error: "Bad JSON" }); }
  const prompt = String(body.prompt ?? "");
  const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
  if (!prompt || images.length === 0) return json(400, { error: "prompt and images are required" });
  for (const im of images) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(im.media_type) || typeof im.data !== "string" || im.data.length > 9_000_000) {
      return json(400, { error: "Bad image" });
    }
  }

  // 3. Ask Claude
  const model = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";
  const content = [
    ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
    { type: "text", text: prompt },
  ];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: "You read scanned supplier documents. Reply with one JSON object only, no explanation, no markdown.",
      messages: [{ role: "user", content }],
    }),
  });
  if (r.status === 429) return json(429, { error: "Rate limited" });
  if (!r.ok) return json(502, { error: "Claude API error " + r.status + ": " + (await r.text()).slice(0, 300) });
  const out = await r.json();
  const text = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n");
  try { return json(200, { result: extractJson(text) }); }
  catch { return json(200, { result: { docType: "ERROR" } }); }
});
