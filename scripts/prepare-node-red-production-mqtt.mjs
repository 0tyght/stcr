import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const mqttHost = "27.254.134.55";
const mqttPort = "8883";
const targets = [
  {
    company: "gr",
    file: path.join(root, "output", "node-red", "gr-production-complete-v9.json"),
    ackTopic: "stcr/ack/gr",
    clientId: "stcr-gr-factory-01",
  },
  {
    company: "ttn",
    file: path.join(root, "output", "node-red", "ttn-production-complete-v10.json"),
    ackTopic: "stcr/ack/ttn",
    clientId: "stcr-ttn-factory-01",
  },
];

for (const target of targets) {
  const nodes = JSON.parse(fs.readFileSync(target.file, "utf8"));
  if (!Array.isArray(nodes)) throw new Error(`${target.file}: flow must be an array`);

  const ackNode = nodes.find(
    (node) => node.type === "mqtt in" && node.topic === target.ackTopic,
  );
  if (!ackNode?.broker) throw new Error(`${target.file}: database ACK subscriber is missing`);

  const previousBrokerId = ackNode.broker;
  const brokerId = `stcr_${target.company}_mqtt_broker_tls`;
  const tlsId = `stcr_${target.company}_mqtt_tls`;
  const mqttNodes = nodes.filter(
    (node) =>
      (node.type === "mqtt in" || node.type === "mqtt out") &&
      (node.broker === previousBrokerId || node.broker === brokerId),
  );
  if (!mqttNodes.length) throw new Error(`${target.file}: no STCR MQTT nodes found`);
  for (const node of mqttNodes) node.broker = brokerId;

  const filtered = nodes.filter(
    (node) =>
      !(
        (node.type === "mqtt-broker" && [previousBrokerId, brokerId].includes(node.id)) ||
        (node.type === "tls-config" && node.id === tlsId)
      ),
  );
  filtered.push(
    {
      id: tlsId,
      type: "tls-config",
      name: `STCR ${target.company.toUpperCase()} MQTT TLS`,
      cert: "",
      key: "",
      ca: "",
      certname: "",
      keyname: "",
      caname: "",
      servername: "",
      verifyservercert: true,
      alpnprotocol: "",
    },
    {
      id: brokerId,
      type: "mqtt-broker",
      name: `STCR ${target.company.toUpperCase()} Production`,
      broker: mqttHost,
      port: mqttPort,
      clientid: target.clientId,
      autoConnect: true,
      usetls: true,
      protocolVersion: "4",
      keepalive: "30",
      cleansession: false,
      autoUnsubscribe: false,
      birthTopic: "",
      birthQos: "0",
      birthPayload: "",
      birthMsg: {},
      closeTopic: "",
      closeQos: "0",
      closePayload: "",
      closeMsg: {},
      willTopic: "",
      willQos: "0",
      willPayload: "",
      willMsg: {},
      userProps: "",
      sessionExpiry: "",
      tls: tlsId,
    },
  );

  fs.writeFileSync(target.file, `${JSON.stringify(filtered, null, 2)}\n`, "utf8");
  console.log(
    `${target.file}: ${mqttHost}:${mqttPort}, clientId=${target.clientId}, credentials=enter at factory`,
  );
}
