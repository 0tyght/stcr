import { pbkdf2Sync, randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
const random = randomBytes(20);
const password = Array.from(random, (byte) => alphabet[byte % alphabet.length]).join("");
const iterations = 310000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256");

console.log("Generated password (store it securely; shown only now):");
console.log(password);
console.log("\npasswordHash for STCR_AUTH_USERS_JSON:");
console.log(`pbkdf2$sha256$${iterations}$${salt.toString("hex")}$${hash.toString("hex")}`);
