import type { AppApi } from "./api/contracts";
import { nodeRedApi } from "./api/nodeRedApi";

export const apiClient: AppApi = nodeRedApi;
