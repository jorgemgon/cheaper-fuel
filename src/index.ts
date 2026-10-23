import type { Env } from "./env";
import { SERVER_NAME, SERVER_VERSION } from "./env";
import { createDgegContext, pingUpstream } from "./dgeg";
import { createServer } from "./mcp";
import { renderLanding } from "./landing";
import { createMcpHandler } from "agents/mcp/server";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// /health deliberately bypasses the cache so it exercises the live upstream,
// which would otherwise let anyone hammer DGEG through this endpoint.
const HEALTH_PROBE_TTL_MS = 60_000;
let healthMemo: { at: number; reachable: boolean } | null = null;

async function probeUpstream(dgeg: ReturnType<typeof createDgegContext>): Promise<boolean> {
  const now = Date.now();
  if (!healthMemo || now - healthMemo.at > HEALTH_PROBE_TTL_MS) {
    healthMemo = { at: now, reachable: await pingUpstream(dgeg) };
  }
  return healthMemo.reachable;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      return createMcpHandler(() => createServer(env), { route: "/mcp" })(request, env, ctx);
    }

    if (url.pathname === "/health") {
      const dgeg = createDgegContext(env);
      const reachable = await probeUpstream(dgeg);
      return json({
        status: reachable ? "ok" : "degraded",
        service: SERVER_NAME,
        version: SERVER_VERSION,
        upstream: reachable ? "reachable" : "unreachable",
        cache_ttl_seconds: dgeg.ttl,
        checked_at: new Date().toISOString(),
      });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(renderLanding(url.origin), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    return json(
      {
        error: "not_found",
        hint: "The MCP endpoint is /mcp (POST). Open / for documentation.",
      },
      404,
    );
  },
} satisfies ExportedHandler<Env>;
