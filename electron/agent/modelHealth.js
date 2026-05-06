import http from "node:http";
import https from "node:https";
import { AGENTS } from "../constants.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.TRIFIX_REQUEST_TIMEOUT_MS || 5000);

export async function getModelHealth() {
  const entries = await Promise.all(
    Object.entries({
      junior: AGENTS.junior,
      supervisor: AGENTS.supervisor,
      architect: AGENTS.architect
    }).map(async ([key, agent]) => [key, await checkEndpoint(agent)])
  );

  return Object.fromEntries(entries);
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
    await probeEndpoint(endpoint, DEFAULT_TIMEOUT_MS);
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

function probeEndpoint(endpoint, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      endpoint,
      {
        method: "GET",
        timeout: timeoutMs
      },
      (response) => {
        response.resume();
        resolve({
          statusCode: response.statusCode || 0
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms.`));
    });
    request.on("error", reject);
    request.end();
  });
}
