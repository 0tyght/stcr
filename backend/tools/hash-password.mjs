import { argon2Sync, randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
const random = randomBytes(20);
const password = Array.from(random, (byte) => alphabet[byte % alphabet.length]).join("");
const salt = randomBytes(16);
const parameters = {
  message: password,
  nonce: salt,
  parallelism: 1,
  tagLength: 32,
  memory: 65536,
  passes: 3,
};
const hash = argon2Sync("argon2id", parameters);

console.log("Generated password (store it securely; shown only now):");
console.log(password);
console.log("\nArgon2id password_hash for the MySQL users table:");
console.log(`argon2id$v=19$m=65536,t=3,p=1$${salt.toString("hex")}$${hash.toString("hex")}`);
