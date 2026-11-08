export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (!env.ALLOWED_ORIGIN || !env.DISCORD_WEBHOOK_URL || !env.VISITOR_LIMIT || !env.GLOBAL_LIMIT) {
      console.error("Visitor relay is not configured.");
      return new Response("Relay not configured", { status: 503 });
    }
    if (origin !== env.ALLOWED_ORIGIN) return new Response("Forbidden", { status: 403 });

    const cors = { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) return new Response("Missing client address", { status: 400, headers: cors });
    const individual = await env.VISITOR_LIMIT.limit({ key: ip });
    const total = await env.GLOBAL_LIMIT.limit({ key: "all" });
    if (!individual.success || !total.success) return new Response("Rate limited", { status: 429, headers: cors });

    let response;
    try {
      response = await fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Un visiteur vient d'arriver sur le portfolio.", allowed_mentions: { parse: [] } }),
      });
    } catch {
      console.error("Discord webhook request failed.");
      return new Response("Notification failed", { status: 502, headers: cors });
    }
    if (!response.ok) {
      console.error(`Discord webhook returned ${response.status}.`);
      return new Response("Notification failed", { status: 502, headers: cors });
    }
    return new Response(null, { status: 204, headers: cors });
  },
};
