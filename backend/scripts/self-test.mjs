import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../src/http/app.mjs";
import { createLegacyFunctionRunner } from "../src/runtime/function-runner.mjs";
import { RuntimeStore } from "../src/runtime/store.mjs";

const temporary = await mkdtemp(join(tmpdir(), "stcr-express-test-"));
let server;
try {
  const filename = join(temporary, "sample.js");
  await writeFile(
    filename,
    `global.set("count", Number(global.get("count") || 0) + 1);\n` +
      `msg.statusCode = 200;\n` +
      `msg.payload = { ok: true, count: global.get("count"), path: msg.req.path };\n` +
      `return msg;\n`,
    "utf8",
  );

  const globalStore = new RuntimeStore();
  const runner = await createLegacyFunctionRunner({
    filename,
    scope: "self-test",
    globalStore,
    contextStore: new RuntimeStore(),
  });
  const result = await runner({ req: { path: "/stcr/api/test" } });
  if (result?.payload?.ok !== true || result.payload.count !== 1) {
    throw new Error("Compatibility runtime returned an unexpected result");
  }

  server = createServer(createApp());
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  const health = await response.json();
  if (!response.ok || health?.service !== "stcr-express") {
    throw new Error("Express health endpoint failed");
  }

  console.log("Express runtime self-test passed");
} finally {
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temporary, { recursive: true, force: true });
}
