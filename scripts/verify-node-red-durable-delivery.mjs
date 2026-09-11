import fs from "node:fs";

const files = process.argv.slice(2);
if (!files.length) throw new Error("Pass one or more Node-RED flow JSON files");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const filename of files) {
  const nodes = JSON.parse(fs.readFileSync(filename, "utf8"));
  assert(Array.isArray(nodes), `${filename}: flow must be an array`);
  const ids = new Set(nodes.map((node) => node.id));
  assert(ids.size === nodes.length, `${filename}: duplicate node ids`);

  for (const node of nodes) {
    for (const output of node.wires || []) {
      for (const target of output) {
        assert(ids.has(target), `${filename}: missing wire target ${target}`);
      }
    }
  }

  const text = JSON.stringify(nodes);
  const company = /stcr\/ack\/gr/.test(text) ? "gr" : /stcr\/ack\/ttn/.test(text) ? "ttn" : "";
  assert(company, `${filename}: missing database ACK topic`);
  assert(/_stcr_message_id/.test(text), `${filename}: missing durable message id`);
  assert(/stcr-buffer(?:-[a-z]+)?\.db/i.test(text), `${filename}: missing SQLite local buffer`);
  assert(nodes.some((node) => node.type === "sqlite"), `${filename}: missing SQLite nodes`);
  assert(
    nodes.some(
      (node) =>
        node.type === "mqtt in" &&
        node.topic === `stcr/ack/${company}` &&
        String(node.qos) === "1",
    ),
    `${filename}: missing QoS 1 database ACK subscriber`,
  );
  const ackNode = nodes.find(
    (node) =>
      node.type === "mqtt in" &&
      node.topic === `stcr/ack/${company}` &&
      String(node.qos) === "1",
  );
  const broker = nodes.find(
    (node) => node.type === "mqtt-broker" && node.id === ackNode.broker,
  );
  assert(broker, `${filename}: STCR MQTT broker configuration is missing`);
  assert(
    broker.broker === "27.254.134.55" && String(broker.port) === "8883",
    `${filename}: STCR MQTT broker must use 27.254.134.55:8883`,
  );
  assert(broker.usetls === true && broker.tls, `${filename}: MQTT TLS is not enabled`);
  assert(broker.cleansession === false, `${filename}: MQTT session must be persistent`);
  assert(
    broker.clientid === `stcr-${company}-factory-01`,
    `${filename}: MQTT client ID is not company-specific`,
  );
  const tls = nodes.find((node) => node.type === "tls-config" && node.id === broker.tls);
  assert(tls, `${filename}: MQTT TLS configuration is missing`);
  assert(
    tls.verifyservercert === true && !String(tls.servername || "").trim(),
    `${filename}: MQTT IP certificate verification is not enforced`,
  );
  assert(
    nodes.some(
      (node) =>
        node.type === "sqlite" &&
        /status\s*=\s*['"]sent['"]/i.test(String(node.sql || "")) &&
        /acked_at/i.test(String(node.sql || "")),
    ),
    `${filename}: ACK does not mark the local row as sent`,
  );
  if (company === "gr") {
    const pubackNodes = nodes.filter(
      (node) => node.type === "complete" && /PUBACK/i.test(String(node.name || "")),
    );
    assert(
      pubackNodes.every((node) => node.d === true && (node.wires || []).flat().length === 0),
      `${filename}: GR still marks rows sent from broker PUBACK`,
    );
  }

  console.log(`${filename}: durable delivery verified for ${company.toUpperCase()}`);
}
