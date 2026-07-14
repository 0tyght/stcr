import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const simulationModel = await readFile(join(root, "functions", "simulation-model.js"), "utf8");
const simulatorBody = await readFile(join(root, "functions", "simulator.js"), "utf8");
const simulator = `${simulationModel}\n${simulatorBody}`;
const router = await readFile(join(root, "functions", "api-router.js"), "utf8");
const persistenceBody = await readFile(join(root, "functions", "persist-snapshot.js"), "utf8");
const persistence = `${simulationModel}\n${persistenceBody}`;
const sensorGateway = await readFile(join(root, "functions", "sensor-gateway.js"), "utf8");
const signalProcessing = await readFile(join(root, "functions", "signal-processing.js"), "utf8");
const telemetryAggregator = await readFile(join(root, "functions", "telemetry-aggregator.js"), "utf8");

const fieldTabId = "stcr-field-tab";
const grTabId = "stcr-gr-pipeline-tab";
const ttnTabId = "stcr-ttn-pipeline-tab";
const platformTabId = "stcr-platform-tab";
const routerId = "stcr-api-router";
const responseId = "stcr-http-response";
const sensorLanes = [
  { key: "chamber", label: "อุณหภูมิห้องอบ", y: 100 },
  { key: "humidity", label: "ความชื้น", y: 220 },
  { key: "furnace", label: "อุณหภูมิเตาเผา", y: 340 },
  { key: "blower", label: "อุณหภูมิ Blower", y: 460 },
];

const endpoints = [
  ["get", "/stcr/api/health", "ตรวจสอบสถานะระบบ"],
  ["post", "/stcr/api/auth/login", "เข้าสู่ระบบและออก Session"],
  ["post", "/stcr/api/auth/logout", "ออกจากระบบและยกเลิก Session"],
  ["get", "/stcr/api/ovens", "ข้อมูลเตาทั้งหมด"],
  ["get", "/stcr/api/ovens/:ovenId", "รายละเอียดเตา"],
  ["get", "/stcr/api/ovens/:ovenId/history", "ข้อมูลย้อนหลัง"],
  ["get", "/stcr/api/ovens/:ovenId/export.csv", "ส่งออกไฟล์ CSV"],
  ["get", "/stcr/api/alarms", "รายการแจ้งเตือน"],
  ["get", "/stcr/api/audit-events", "ประวัติการใช้งาน"],
  ["get", "/stcr/api/report-document-meta", "อ่านข้อมูลเอกสารรายงาน"],
  ["put", "/stcr/api/report-document-meta", "บันทึกข้อมูลเอกสารรายงาน"],
  ["put", "/stcr/api/ovens/:ovenId/limits", "บันทึกค่าขอบเขต"],
  ["patch", "/stcr/api/ovens/:ovenId", "แก้ไขข้อมูลเตา"],
  ["post", "/stcr/api/ovens", "เพิ่มเตา"],
  ["post", "/stcr/api/alarms/:alarmId/acknowledge", "รับทราบการแจ้งเตือน"],
  ["options", "/stcr/api/*", "ตรวจสอบสิทธิ์ CORS"],
];

function functionNode({ id, z, name, func, x, y, wires, libs = [] }) {
  return {
    id,
    type: "function",
    z,
    name,
    func,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs,
    x,
    y,
    wires,
  };
}

function companyPipeline(companyId, tabId, sourceLabel) {
  const aggregatorId = `stcr-${companyId}-aggregator`;
  const persistOutId = `stcr-${companyId}-persist-out`;
  const nodes = [
    {
      id: `stcr-${companyId}-note`,
      type: "comment",
      z: tabId,
      name: `${sourceLabel}: แยกช่องรับและประมวลผลเซนเซอร์`,
      info: "แต่ละช่องรองรับเซนเซอร์จริงหลายตัว โดยแยกด้วย companyId, ovenId, deviceId และ sensorId",
      x: 320,
      y: 40,
      wires: [],
    },
  ];

  sensorLanes.forEach((lane) => {
    const fieldOutId = `stcr-field-${companyId}-${lane.key}-out`;
    const inputId = `stcr-${companyId}-${lane.key}-in`;
    const gatewayId = `stcr-${companyId}-${lane.key}-gateway`;
    const processorId = `stcr-${companyId}-${lane.key}-processor`;

    nodes.push(
      {
        id: inputId,
        type: "link in",
        z: tabId,
        name: `รับข้อมูล${lane.label}`,
        links: [fieldOutId],
        x: 95,
        y: lane.y,
        wires: [[gatewayId]],
      },
      functionNode({
        id: gatewayId,
        z: tabId,
        name: `${lane.label}: ตรวจสอบคุณภาพข้อมูล`,
        func: sensorGateway,
        x: 330,
        y: lane.y,
        wires: [[processorId]],
      }),
      functionNode({
        id: processorId,
        z: tabId,
        name: `${lane.label}: ปรับเทียบและกรองค่า`,
        func: signalProcessing,
        x: 660,
        y: lane.y,
        wires: [[aggregatorId]],
      }),
    );
  });

  nodes.push(
    functionNode({
      id: aggregatorId,
      z: tabId,
      name: `${sourceLabel}: รวมข้อมูลเซนเซอร์แต่ละเตา`,
      func: telemetryAggregator,
      x: 1010,
      y: 280,
      wires: [[persistOutId]],
    }),
    {
      id: persistOutId,
      type: "link out",
      z: tabId,
      name: "ส่งข้อมูลที่ประมวลผลแล้วไปยังระบบหลัก",
      mode: "link",
      links: ["stcr-platform-persist-in"],
      x: 1255,
      y: 280,
      wires: [],
    },
  );

  return nodes;
}

const nodes = [
  { id: fieldTabId, type: "tab", label: "01 จำลองข้อมูลอุปกรณ์หน้างาน", disabled: false, info: "จำลองเซนเซอร์ของแต่ละเตาและส่งข้อมูลดิบทุก 5 วินาที" },
  { id: grTabId, type: "tab", label: "02 ประมวลผลข้อมูล GR", disabled: false, info: "ตรวจสอบ ปรับเทียบ กรอง และรวมข้อมูลเซนเซอร์ของ Grand Rubber" },
  { id: ttnTabId, type: "tab", label: "03 ประมวลผลข้อมูล TTN", disabled: false, info: "ตรวจสอบ ปรับเทียบ กรอง และรวมข้อมูลเซนเซอร์ของ TTN Rubber แยกจาก GR" },
  { id: platformTabId, type: "tab", label: "04 ฐานข้อมูลและ API", disabled: false, info: "บันทึกข้อมูลลง MariaDB และให้บริการ HTTP API สำหรับทั้งสองบริษัท" },
  {
    id: "stcr-field-note",
    type: "comment",
    z: fieldTabId,
    name: "ข้อมูลดิบ IoT: เซนเซอร์แต่ละตัวส่งข้อมูลทุก 5 วินาที",
    info: "ตัวจำลองส่ง deviceId, sensorId, ลำดับข้อมูล, เวลาจากต้นทาง และ Topic ในรูปแบบที่รองรับ MQTT",
    x: 360,
    y: 40,
    wires: [],
  },
  {
    id: "stcr-simulator-tick",
    type: "inject",
    z: fieldTabId,
    name: "อ่านค่าจาก PLC / Gateway ทุก 5 วินาที",
    props: [{ p: "payload" }, { p: "topic", vt: "str" }],
    repeat: "5",
    crontab: "",
    once: true,
    onceDelay: "0.2",
    topic: "stcr/tick",
    payload: "",
    payloadType: "date",
    x: 170,
    y: 280,
    wires: [["stcr-simulator-core"]],
  },
  {
    id: "stcr-simulator-core",
    type: "function",
    z: fieldTabId,
    name: "จำลองการทำงานของเตาและเซนเซอร์",
    func: simulator,
    outputs: 4,
    timeout: 0,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 450,
    y: 280,
    wires: sensorLanes.map((lane) => [`stcr-field-${lane.key}-company-router`]),
  },
  ...sensorLanes.flatMap((lane) => {
    const routerIdForLane = `stcr-field-${lane.key}-company-router`;
    return [
      {
        id: routerIdForLane,
        type: "switch",
        z: fieldTabId,
        name: `${lane.label}: แยกตามบริษัท`,
        property: "payload.companyId",
        propertyType: "msg",
        rules: [
          { t: "eq", v: "gr", vt: "str" },
          { t: "eq", v: "ttn", vt: "str" },
        ],
        checkall: "true",
        repair: false,
        outputs: 2,
        x: 760,
        y: lane.y,
        wires: [
          [`stcr-field-gr-${lane.key}-out`],
          [`stcr-field-ttn-${lane.key}-out`],
        ],
      },
      ...["gr", "ttn"].map((companyId, index) => ({
        id: `stcr-field-${companyId}-${lane.key}-out`,
        type: "link out",
        z: fieldTabId,
        name: `${companyId.toUpperCase()}: ส่ง${lane.label}`,
        mode: "link",
        links: [`stcr-${companyId}-${lane.key}-in`],
        x: 1055,
        y: lane.y + index * 34,
        wires: [],
      })),
    ];
  }),
  ...companyPipeline("gr", grTabId, "Grand Rubber"),
  ...companyPipeline("ttn", ttnTabId, "TTN Rubber"),
  {
    id: "stcr-platform-note",
    type: "comment",
    z: platformTabId,
    name: "บันทึกข้อมูลดิบ ข้อมูลที่กรองแล้ว และค่าเฉลี่ยกราฟทุก 10 นาที",
    info: "telemetry_events เก็บค่าดิบ, sensor_readings เก็บค่าที่กรองแล้ว และ API ข้อมูลย้อนหลังส่งค่าเฉลี่ยตามช่วงเวลา",
    x: 400,
    y: 40,
    wires: [],
  },
  {
    id: "stcr-platform-persist-in",
    type: "link in",
    z: platformTabId,
    name: "รับข้อมูลที่ประมวลผลแล้วจาก GR / TTN",
    links: ["stcr-gr-persist-out", "stcr-ttn-persist-out"],
    x: 95,
    y: 100,
    wires: [["stcr-db-persistence"]],
  },
  functionNode({
    id: "stcr-db-persistence",
    z: platformTabId,
    name: "บันทึกข้อมูลดิบและข้อมูลที่กรองแล้วลง MariaDB",
    func: persistence,
    x: 390,
    y: 100,
    wires: [[]],
    libs: [{ var: "mysql", module: "mysql2/promise" }],
  }),
  ...endpoints.map(([method, url, name], index) => ({
    id: `stcr-http-${index + 1}`,
    type: "http in",
    z: platformTabId,
    name,
    url,
    method,
    upload: false,
    swaggerDoc: "",
    x: 170,
    y: 250 + index * 42,
    wires: [[routerId]],
  })),
  functionNode({
    id: routerId,
    z: platformTabId,
    name: "จัดเส้นทาง STCR API และคำนวณค่าเฉลี่ย 10 นาที",
    func: router,
    x: 560,
    y: 480,
    wires: [[responseId]],
    libs: [
      { var: "mysql", module: "mysql2/promise" },
      { var: "crypto", module: "crypto" },
    ],
  }),
  {
    id: responseId,
    type: "http response",
    z: platformTabId,
    name: "ส่งผลลัพธ์ HTTP กลับเว็บไซต์",
    statusCode: "",
    headers: {},
    x: 850,
    y: 480,
    wires: [],
  },
];

await writeFile(join(root, "flows.json"), `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Generated node-red/flows.json with ${nodes.length} nodes across 4 tabs.`);
