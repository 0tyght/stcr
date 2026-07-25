function normalizeError(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createNodeLogger(scope, onSend) {
  return {
    log(value) {
      console.log(`[${scope}] ${normalizeError(value)}`);
    },
    warn(value) {
      console.warn(`[${scope}] ${normalizeError(value)}`);
    },
    error(value) {
      console.error(`[${scope}] ${normalizeError(value)}`);
    },
    debug(value) {
      if (String(process.env.STCR_DEBUG || "false").toLowerCase() === "true") {
        console.debug(`[${scope}] ${normalizeError(value)}`);
      }
    },
    status(value) {
      if (String(process.env.STCR_DEBUG_STATUS || "false").toLowerCase() === "true") {
        console.log(`[${scope}:status] ${normalizeError(value)}`);
      }
    },
    send(message) {
      if (onSend) onSend(message);
    },
  };
}
