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

export function createBoundedSerialExecutor(maxPending = 1000) {
  let tail = Promise.resolve();
  let pending = 0;

  return function executeBoundedSerial(task) {
    if (pending >= maxPending) {
      const error = new Error(`Serial queue is full (${maxPending})`);
      error.code = "SERIAL_QUEUE_FULL";
      return Promise.reject(error);
    }

    pending += 1;
    const result = tail.then(task, task);
    tail = result
      .catch(() => undefined)
      .finally(() => {
        pending -= 1;
      });
    return result;
  };
}
