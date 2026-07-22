const path = require("node:path");

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const allowedOrigins = requiredEnvironment("STCR_ALLOWED_ORIGINS")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function validateCorsOrigin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  // Let the API router return a controlled 403 response. Passing an error here
  // makes the CORS middleware turn a normal rejection into HTTP 500.
  return callback(null, false);
}

module.exports = {
  flowFile: path.join(__dirname, "flows.json"),
  flowFilePretty: true,
  uiHost: "127.0.0.1",
  uiPort: Number(process.env.PORT || 1880),

  // The public runtime serves HTTP In nodes only. The editor and admin API
  // stay disabled, so the tunnel cannot expose flow editing by accident.
  httpAdminRoot: false,
  httpNodeRoot: "/",
  // Express handles automatic OPTIONS responses before the flow router, so
  // CORS must also be enforced here. The API router repeats the same allowlist
  // for normal responses as a defense-in-depth check.
  httpNodeCors: {
    origin: validateCorsOrigin,
    methods: "GET,POST,PUT,PATCH,OPTIONS",
    allowedHeaders: "Content-Type,Authorization,X-API-Key",
  },

  credentialSecret: requiredEnvironment("STCR_NODE_RED_CREDENTIAL_SECRET"),
  functionExternalModules: true,
  externalModules: {
    autoInstall: false,
  },

  logging: {
    console: {
      level: process.env.STCR_NODE_RED_LOG_LEVEL || "info",
      metrics: false,
      audit: false,
    },
  },
};
