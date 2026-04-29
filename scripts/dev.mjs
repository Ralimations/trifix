import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const viteCommand = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
const viteArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm run dev:vite"] : ["run", "dev:vite"];
const rendererUrl = "http://127.0.0.1:5173";

let electronProcess = null;
let shuttingDown = false;

const viteProcess = spawn(viteCommand, viteArgs, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"]
});

viteProcess.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
});

viteProcess.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

viteProcess.on("exit", (code) => {
  if (!shuttingDown && code !== 0) {
    process.exitCode = code ?? 1;
  }
  shutdown();
});

const probe = setInterval(async () => {
  try {
    const response = await fetch(rendererUrl);
    if (response.ok && !electronProcess) {
      clearInterval(probe);
      startElectron();
    }
  } catch {
    // Vite is still starting.
  }
}, 250);

setTimeout(() => {
  if (!electronProcess) {
    clearInterval(probe);
    startElectron();
  }
}, 8000);

function startElectron() {
  const electronEnv = {
    ...process.env,
    VITE_DEV_SERVER_URL: rendererUrl
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;

  electronProcess = spawn(electronPath, ["."], {
    cwd: process.cwd(),
    env: electronEnv,
    stdio: "inherit"
  });

  electronProcess.on("exit", (code) => {
    if (!shuttingDown) {
      process.exitCode = code ?? 0;
    }
    shutdown();
  });
}

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearInterval(probe);

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }

  if (!viteProcess.killed) {
    viteProcess.kill();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
