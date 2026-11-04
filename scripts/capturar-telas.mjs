// Capturas de tela do app com o Edge em modo headless (sem instalar nada além do Node e do Edge).
//
//   node scripts/capturar-telas.mjs <pasta de saída> '<json com as capturas>'
//
// Cada captura: { "name": "visao-escuro", "url": "http://localhost:8011/", "theme": "dark"|"light",
//   "width": 1440, "height": 900, "hidden": false, "full": true, "wait": 1800, "steps": ["js..."] }
//   - theme: tema da tela (padrão "dark"); hidden: liga "ocultar valores"
//   - full: captura a página inteira (padrão true); wait: espera em ms depois de abrir
//   - steps: trechos de JavaScript executados na página antes da captura (clicar, preencher...)
// Largura menor que 600 simula celular. Variáveis: EDGE_PATH (caminho do msedge.exe), PORT_DEBUG.
//
// Use SEMPRE contra o modo demonstração ou um banco temporário (veja CLAUDE.md), nunca o banco real.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [out, jobsJson] = process.argv.slice(2);
if (!out || !jobsJson) {
  console.error("Uso: node scripts/capturar-telas.mjs <pasta de saída> '<json>'");
  process.exit(1);
}
const jobs = JSON.parse(jobsJson);
mkdirSync(out, { recursive: true });

const edge = [
  process.env.EDGE_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
]
  .filter(Boolean)
  .find((path) => existsSync(path));

if (!edge) {
  console.error("Não achei o Microsoft Edge. Informe o caminho em EDGE_PATH.");
  process.exit(1);
}

const port = Number(process.env.PORT_DEBUG || 9333);
const profile = mkdtempSync(join(tmpdir(), "il-captura-"));
const proc = spawn(
  edge,
  ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank"],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageSocket() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* o navegador ainda está subindo */
    }
    await sleep(200);
  }
  throw new Error("O Edge não respondeu.");
}

const ws = new WebSocket(await pageSocket());
await new Promise((resolve) => (ws.onopen = resolve));
let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mine = ++id;
    pending.set(mine, resolve);
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return reply.result?.result?.value;
};

try {
  await send("Page.enable");
  for (const job of jobs) {
    const { name, url, theme = "dark", width = 1440, height = 900, hidden = false, steps = [], full = true, wait = 1800 } = job;
    const mobile = width < 600;
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    // Define o tema e o modo "ocultar valores" no navegador antes de abrir a página.
    await send("Page.navigate", { url: new URL(url).origin + "/" });
    await sleep(800);
    await evaluate(`localStorage.setItem('il-theme','${theme}'); localStorage.setItem('il-privacy','${hidden ? "hidden" : "visible"}')`);
    await send("Page.navigate", { url });
    await sleep(wait);
    for (const step of steps) {
      await evaluate(step);
      await sleep(700);
    }
    if (full) {
      const total = await evaluate("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)");
      await send("Emulation.setDeviceMetricsOverride", { width, height: Math.min(total, 4000), deviceScaleFactor: 1, mobile });
      await sleep(400);
    }
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(out, `${name}.png`), Buffer.from(shot.result.data, "base64"));
    console.log("ok", join(out, `${name}.png`));
  }
} finally {
  ws.close();
  proc.kill();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* o Edge ainda segurava a pasta; o sistema limpa depois */
  }
}
process.exit(0);
