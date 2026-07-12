import { runtimeConfig } from "../config/runtime";
import type { AppApi } from "./api/contracts";
import { nodeRedApi } from "./api/nodeRedApi";
import { mockApi } from "./mockApi";

export const apiClient: AppApi =
  runtimeConfig.dataSource === "node-red" ? nodeRedApi : mockApi;
