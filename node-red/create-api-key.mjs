import { createHmac, randomBytes } from "node:crypto";

const [companyId, name = "Node-RED gateway", allowedOvenId = ""] = process.argv.slice(2);
const pepper = String(process.env.STCR_API_KEY_PEPPER || "");
if (!new Set(["gr", "ttn"]).has(companyId) || pepper.length < 32) {
  console.error("Set STCR_API_KEY_PEPPER (at least 32 characters), then run:");
  console.error("node node-red/create-api-key.mjs <gr|ttn> [name] [ovenId]");
  process.exit(1);
}
if (allowedOvenId && !/^oven-[a-zA-Z0-9_.-]{1,56}$/.test(allowedOvenId)) {
  console.error("Invalid ovenId");
  process.exit(1);
}

const apiKey = `stcr_${companyId}_${randomBytes(32).toString("base64url")}`;
const prefix = apiKey.slice(0, 16);
const keyHash = createHmac("sha256", pepper).update(apiKey).digest("hex");
const nameHex = Buffer.from(name, "utf8").toString("hex");
const ovenSql = allowedOvenId ? `'${allowedOvenId}'` : "NULL";

console.log("Generated API key (store in the Node-RED secret environment; shown only now):");
console.log(apiKey);
console.log("\nRun this SQL as a database administrator:");
console.log(`INSERT INTO api_keys (company_id, name, key_prefix, key_hash, allowed_oven_id, status)
VALUES ('${companyId}', CONVERT(0x${nameHex} USING utf8mb4), '${prefix}', '${keyHash}', ${ovenSql}, 'active');`);
