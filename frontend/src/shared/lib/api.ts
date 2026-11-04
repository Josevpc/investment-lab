export const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

export class ApiError extends Error {
  status: number;
  /** Campos de máquina que o back-end manda ao lado de `detail` (ex.: `shortfall_cents`). */
  extra: Record<string, unknown>;

  constructor(message: string, status: number, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

type FastApiDetail = string | { msg: string; loc?: (string | number)[] }[] | undefined;

function messageFrom(detail: FastApiDetail, status: number): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    // O Pydantic prefixa as mensagens das nossas validações com "Value error, ".
    return detail.map((d) => d.msg.replace(/^Value error, /, "")).join("; ");
  }
  return `Erro ${status} ao falar com a API.`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        // A API só aceita gravação que traga este cabeçalho: um site de fora não consegue mandá-lo.
        "X-Investment-Lab": "1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Não foi possível conectar à API. Ela está rodando?", 0);
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const { detail, ...extra } = (payload ?? {}) as { detail?: FastApiDetail } & Record<string, unknown>;
    throw new ApiError(messageFrom(detail, response.status), response.status, extra);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: (path: string) => request<void>("DELETE", path),
};
