import type { AppApi } from "./api/contracts";
import { expressApi } from "./api/expressApi";

export const apiClient: AppApi = expressApi;
