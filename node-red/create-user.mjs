import { argon2Sync, randomBytes } from "node:crypto";

const [companyId, username, role = "operator", displayName = username] = process.argv.slice(2);
const allowedCompanies = new Set(["gr", "ttn"]);
const allowedRoles = new Set(["admin", "operator", "viewer"]);

if (!allowedCompanies.has(companyId) || !/^[a-zA-Z0-9_.-]{3,80}$/.test(username || "")) {
  console.error("Usage: node node-red/create-user.mjs <gr|ttn> <username> [admin|operator|viewer] [display name]");
  process.exit(1);
}
if (!allowedRoles.has(role)) {
  console.error(`Unknown role: ${role}`);
  process.exit(1);
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
const password = Array.from(randomBytes(20), (byte) => alphabet[byte % alphabet.length]).join("");
const salt = randomBytes(16);
const hash = argon2Sync("argon2id", {
  message: password,
  nonce: salt,
  parallelism: 1,
  tagLength: 32,
  memory: 65536,
  passes: 3,
});
const encoded = `argon2id$v=19$m=65536,t=3,p=1$${salt.toString("hex")}$${hash.toString("hex")}`;
const displayNameHex = Buffer.from(displayName, "utf8").toString("hex");

console.log("Generated password (store securely; shown only now):");
console.log(password);
console.log("\nRun this SQL as a database administrator:");
console.log(`INSERT INTO users (company_id, username, display_name, password_hash, password_algorithm, status)
VALUES ('${companyId}', '${username}', CONVERT(0x${displayNameHex} USING utf8mb4), '${encoded}', 'argon2id', 'active')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), password_hash=VALUES(password_hash),
  password_algorithm='argon2id', status='active', failed_login_count=0, locked_until=NULL;
INSERT IGNORE INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON r.code='${role}' WHERE u.username='${username}';`);
