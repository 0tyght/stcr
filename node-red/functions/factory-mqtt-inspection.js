const result = msg.payload || {};
const oven = result.ovenNumber ? ` oven ${result.ovenNumber}` : "";
const fill = result.status === "rejected" ? "red" : result.status === "pending" ? "yellow" : "blue";
node.status({ fill, shape: result.status === "rejected" ? "ring" : "dot", text: `${result.status || "unknown"}${oven}` });
return null;
