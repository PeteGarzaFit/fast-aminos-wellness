// RENOVO: sends an iPhone notification when a new message is saved.
// Triggered by a Supabase Database Webhook on INSERT into public.messages.
// Secrets (Supabase > Edge Functions > Secrets): APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (the .p8 file contents).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from "npm:@supabase/supabase-js@2";

const BUNDLE_ID = "com.renovocoach.app";
const COACH_NAME = Deno.env.get("COACH_NAME") ?? "Pete";

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let cachedJwt: { token: string; at: number } | null = null;
/** Apple's push service accepts one signed token for up to an hour. */
async function apnsJwt(): Promise<string> {
  if (cachedJwt && Date.now() - cachedJwt.at < 45 * 60 * 1000) return cachedJwt.token;
  const keyId = Deno.env.get("APNS_KEY_ID")!, teamId = Deno.env.get("APNS_TEAM_ID")!;
  const pem = Deno.env.get("APNS_PRIVATE_KEY")!.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const body = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
  cachedJwt = { token: `${head}.${body}.${b64url(sig)}`, at: Date.now() };
  return cachedJwt.token;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const msg = payload?.record;
    if (payload?.type !== "INSERT" || !msg?.client_id) return new Response("ignored");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: client } = await db.from("clients").select("user_id, name").eq("id", msg.client_id).single();
    if (!client) return new Response("no client");
    // Coach wrote → notify the client. Client wrote → notify every trainer.
    let recipients: string[] = [];
    if (msg.from_coach) { if (client.user_id) recipients = [client.user_id]; }
    else { const { data: trainers } = await db.from("trainers").select("user_id"); recipients = (trainers ?? []).map((t) => t.user_id); }
    if (!recipients.length) return new Response("no recipients");

    const { data: tokens } = await db.from("device_tokens").select("token, env").in("user_id", recipients);
    if (!tokens?.length) return new Response("no devices");

    const title = msg.from_coach ? COACH_NAME : String(client.name || "Client");
    const text = String(msg.body || "").slice(0, 180);
    const jwt = await apnsJwt();
    const results = await Promise.all(tokens.map(async ({ token, env }) => {
      const host = env === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
      const res = await fetch(`${host}/3/device/${token}`, {
        method: "POST",
        headers: { authorization: `bearer ${jwt}`, "apns-topic": BUNDLE_ID, "apns-push-type": "alert", "apns-priority": "10" },
        body: JSON.stringify({ aps: { alert: { title, body: text }, sound: "default", badge: 1, "thread-id": msg.client_id }, kind: "message" }),
      });
      // A phone that deleted the app: forget its token.
      if (res.status === 410 || res.status === 400) {
        const reason = await res.json().catch(() => ({}));
        if (res.status === 410 || reason?.reason === "BadDeviceToken") await db.from("device_tokens").delete().eq("token", token);
      }
      return res.status;
    }));
    return new Response(JSON.stringify({ sent: results }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
