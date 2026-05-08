import http from "node:http";
import https from "node:https";
import { AGENTS } from "../constants.js";

const DEFAULT_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.TRIFIX_HEALTH_TIMEOUT_MS || 5000) || 5000, 1000),
  10000
);

const HEALTH_AGENTS = {
  junior: AGENTS.junior,
  supervisor: AGENTS.supervisor,
  architect: AGENTS.architect
};

export async function getModelHealth() {
  // Broad diagnostics for the UI. Runtime QA gating should use getAgentHealth("supervisor")
  // so PM/Junior health does not affect optional QA behavior.
  const entries = await Promise.all(
    Object.entries(HEALTH_AGENTS).map(async ([key, agent]) => [key, await checkEndpoint(agent)])
  );

  return Object.fromEntries(entries);
}

export async function getAgentHealth(agentId) {
  const key = String(agentId || "").trim().toLowerCase();
  const agent = HEALTH_AGENTS[key];
  if (!agent) {
    throw new Error(`Unknown agent health target: ${agentId}`);
  }

  return checkEndpoint(agent);
}

async function checkEndpoint(agent) {
  const endpoint = String(agent?.endpoint || "");
  const model = String(agent?.model || "");

  if (!endpoint) {
    return {
      online: false,
      endpoint,
      model,
      error: "Missing endpoint."
    };
  }

  try {
    await probeEndpoint(endpoint, model, DEFAULT_TIMEOUT_MS);
    return {
      online: true,
      endpoint,
      model
    };
  } catch (error) {
    return {
      online: false,
      endpoint,
      model,
      error: error?.message || "Endpoint check failed."
    };
  }
}

function probeEndpoint(endpoint, model, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const client = url.protocol === "https:" ? https : http;
    const payload = JSON.stringify({
      model,
      system_prompt: "Return OK only.",
      input: "OK"
    });
    const request = client.request(
      url,
      {
        method: "POST",
        agent: false,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Connection: "close",
          "Content-Length": Buffer.byteLength(payload)
        },
        timeout: timeoutMs
      },
      (response) => {
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({
              statusCode: response.statusCode || 0
            });
            return;
          }

          reject(new Error(`Health check failed with HTTP ${response.statusCode || 0}.`));
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms.`));
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}
