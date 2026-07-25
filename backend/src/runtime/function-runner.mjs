import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import mysql from "mysql2/promise";

import { createNodeLogger } from "./logger.mjs";
import { flowStore } from "./store.mjs";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export async function createLegacyFunctionRunner({
  filename,
  scope,
  globalStore,
  contextStore,
  onSend,
}) {
  const source = await readFile(filename, "utf8");
  const execute = new AsyncFunction(
    "msg",
    "env",
    "global",
    "context",
    "flow",
    "node",
    "mysql",
    "crypto",
    `"use strict";\n${source}\n`,
  );

  const env = {
    get(name) {
      return process.env[name];
    },
  };
  const node = createNodeLogger(scope, onSend);

  return async function runLegacyFunction(message) {
    return execute(
      message,
      env,
      globalStore,
      contextStore,
      flowStore,
      node,
      mysql,
      crypto,
    );
  };
}

export function createSerialExecutor() {
  let tail = Promise.resolve();
  return function executeSerial(task) {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}
