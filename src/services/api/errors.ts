export class ApiError extends Error {
  readonly status?: number;
  readonly code: string;

  constructor(message: string, options?: { status?: number; code?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ApiError";
    this.status = options?.status;
    this.code = options?.code ?? "API_ERROR";
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "ไม่สามารถเชื่อมต่อระบบข้อมูลได้";
}
