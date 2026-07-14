const path = require("node:path");

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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
  httpNodeCors: {
    origin: "https://0tyght.github.io",
    methods: "GET,POST,PUT,PATCH,OPTIONS",
    allowedHeaders: "Content-Type,Authorization",
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
