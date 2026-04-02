import axios from 'axios';

/** When the server sets ADMIN_ACCESS_TOKEN, build with VITE_ADMIN_ACCESS_TOKEN so API calls include X-Admin-Key. */
export function getAdminHeaders(): Record<string, string> {
  const key = (import.meta as any)?.env?.VITE_ADMIN_ACCESS_TOKEN as string | undefined;
  if (key && String(key).trim()) {
    return { 'X-Admin-Key': String(key).trim() };
  }
  return {};
}

type BackendDetail = {
  message?: string;
  code?: string;
  hint?: string;
};

type ApiErrorShape = {
  detail?: string | BackendDetail;
  issues?: string[];
};

export function extractApiError(error: unknown, fallbackMessage: string = 'Unepected error occurred.') {
  if (axios.isAxiosError<ApiErrorShape>(error)) {
    const payload = error.response?.data;
    const detail = payload?.detail;
    const issues = payload?.issues ?? [];

    if (typeof detail === 'string') {
      return {
        message: detail,
        hint: issues.length ? issues.join('\n') : undefined,
      };
    }

    if (detail && typeof detail === 'object') {
      return {
        message: detail.message || fallbackMessage,
        hint: detail.hint || (issues.length ? issues.join('\n') : undefined),
        code: detail.code,
      };
    }

    if (error.message) {
      return { message: error.message };
    }
  }

  if (error instanceof Error && error.message) {
    return { message: error.message };
  }

  return { message: fallbackMessage };
}
