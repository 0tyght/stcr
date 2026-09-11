import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sourceIndex = process.argv.indexOf("--source");
const sourcePath =
  (sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "") ||
  path.join(process.env.USERPROFILE || "", "Downloads", "flows (2).json");
const v7Path = path.join(root, "output", "node-red", "ttn-production-complete-v7.json");
const outputPath = path.join(root, "output", "node-red", "ttn-production-complete-v8.json");

const generated = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "build-ttn-node-red-production-v7.mjs"), "--source", sourcePath],
  { cwd: root, encoding: "utf8" },
);
if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout);

let raw = fs.readFileSync(v7Path, "utf8").replaceAll("stcr_v7_", "stcr_v8_");
raw = raw.replaceAll(" V7", " V8").replaceAll("(V7)", "(V8)");
const nodes = JSON.parse(raw);
const byId = (id) => nodes.find((node) => node.id === id);

for (let oven = 1; oven <= 9; oven += 1) {
  const watchdog = byId(`stcr_v8_o${oven}_watch_check`);
  if (!watchdog) throw new Error(`Missing watchdog for oven ${oven}`);
  watchdog.func = watchdog.func.replace(
    `flow.get("latest_oven_${oven}")`,
    `global.get("latest_oven_${oven}")`,
  );
  if (!watchdog.func.includes(`global.get("latest_oven_${oven}")`)) {
    throw new Error(`Watchdog oven ${oven} was not updated`);
  }
}

const queuePoll = byId("stcr_v8_queue_poll");
if (!queuePoll) throw new Error("Missing SQLite queue sender");
queuePoll.repeat = "0.2";
queuePoll.name = "ส่งคิวเก่าก่อน · สูงสุด 5 ข้อความ/วินาที";

const acquisitionTab = byId("stcr_v8_acquisition");
if (!acquisitionTab) throw new Error("Missing acquisition tab");
acquisitionTab.label = "STCR V8 · ข้อมูลเตา, Local Data และ MQTT";
acquisitionTab.info =
  "อ่านเตาละ 1 ครั้ง/นาที → บันทึก SQLite → ส่ง FIFO สูงสุด 5 ข้อความ/วินาที → รอ ACK";

// Keep V8 disabled on import. Disable V7 first, then enable all three V8
// tabs and perform a Full deploy so both versions never run together.
for (const node of nodes.filter((item) => item.type === "tab")) {
  node.disabled = true;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Created ${outputPath}`);
console.log("Watchdogs=9, queueRate=5 messages/second");
