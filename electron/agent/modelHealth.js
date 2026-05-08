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
  const endpointGroups = new Map();
  for (const [key, agent] of Object.entries(HEALTH_AGENTS)) {
    const endpoint = String(agent?.endpoint || "");
    const group = endpointGroups.get(endpoint) || [];
    group.push([key, agent]);
    endpointGroups.set(endpoint, group);
  }

  const groupResults = await Promise.all(
    Array.from(endpointGroups.values()).map(async (group) => {
      const results = [];
      for (const [key, agent] of group) {
        results.push([key, await checkEndpoint(agent)]);
      }
      return results;
    })
  );
  const entries = groupResults.flat();
  const results = Object.fromEntries(entries);
  const endpointReachability = new Map();

  for (const entry of Object.values(results)) {
    const endpoint = String(entry?.endpoint || "");
    if (!endpoint) {
      continue;
    }
    if (entry.endpointReachable || entry.online) {
      endpointReachability.set(endpoint, true);
    } else if (!endpointReachability.has(endpoint)) {
      endpointReachability.set(endpoint, false);
    }
  }

  for (const entry of Object.values(results)) {
    const endpoint = String(entry?.endpoint || "");
    if (!endpoint) {
      continue;
    }
    if (endpointReachability.get(endpoint)) {
      entry.endpointReachable = true;
      if (!entry.online && entry.classification === "endpoint_offline") {
        entry.classification = entry.modelResponded ? "online" : classifyModelFailure(entry.error);
      }
    }
  }

  return results;
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
      endpointReachable: false,
      modelResponded: false,
      endpoint,
      model,
      error: "Missing endpoint.",
      elapsedMs: 0,
      classification: "endpoint_offline"
    };
  }

  const startedAt = Date.now();
  const perAttemptElapsedMs = [];
  let attempts = 0;
  let lastError = null;
  let lastDetail = {
    endpointReachable: false,
    classification: "unknown_error",
    statusCode: 0
  };

  while (attempts < 2) {
    attempts += 1;
    const attemptStartedAt = Date.now();
    try {
      const response = await probeEndpoint(endpoint, model, DEFAULT_TIMEOUT_MS);
      perAttemptElapsedMs.push(Date.now() - attemptStartedAt);
      return {
        online: true,
        endpointReachable: true,
        modelResponded: true,
        endpoint,
        model,
        attempts,
        elapsedMs: Date.now() - startedAt,
        perAttemptElapsedMs,
        classification: "online",
        statusCode: response.statusCode || 0
      };
    } catch (error) {
      perAttemptElapsedMs.push(Date.now() - attemptStartedAt);
      lastError = error;
      lastDetail = classifyProbeError(error);
      const shouldRetry = attempts < 2 && lastDetail.endpointReachable && lastDetail.classification === "model_timeout";
      if (!shouldRetry) {
        break;
      }
    }
  }

  return {
    online: false,
    endpointReachable: lastDetail.endpointReachable,
    modelResponded: false,
    endpoint,
    model,
    error: lastError?.message || "Endpoint check failed.",
    attempts,
    elapsedMs: Date.now() - startedAt,
    perAttemptElapsedMs,
    classification: lastDetail.classification,
    statusCode: lastDetail.statusCode || 0
  };
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
              statusCode: response.statusCode || 0,
              body: chunks.join("")
            });
            return;
          }

          const error = new Error(`Health check failed with HTTP ${response.statusCode || 0}.`);
          error.statusCode = response.statusCode || 0;
          error.responseBody = chunks.join("");
          reject(error);
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

function classifyProbeError(error) {
  const message = String(error?.message || "").trim();
  const code = String(error?.code || "").trim().toUpperCase();
  const statusCode = Number(error?.statusCode || 0);

  if (/timed out after/i.test(message)) {
    return {
      endpointReachable: true,
      classification: "model_timeout",
      statusCode
    };
  }

  if (statusCode > 0) {
    if ([400, 404, 422].includes(statusCode)) {
      return {
        endpointReachable: true,
        classification: "model_unavailable",
        statusCode
      };
    }

    return {
      endpointReachable: true,
      classification: "invalid_response",
      statusCode
    };
  }

  if (["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET", "EPIPE"].includes(code)) {
    return {
      endpointReachable: false,
      classification: "endpoint_offline",
      statusCode: 0
    };
  }

  return {
    endpointReachable: false,
    classification: "unknown_error",
    statusCode
  };
}

function classifyModelFailure(error) {
  const message = String(error || "");
  if (/timed out after/i.test(message)) {
    return "model_timeout";
  }
  if (/HTTP 400|HTTP 404|HTTP 422/i.test(message)) {
    return "model_unavailable";
  }
  if (/HTTP/i.test(message)) {
    return "invalid_response";
  }
  return "unknown_error";
}
