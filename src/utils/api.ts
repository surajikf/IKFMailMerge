import axios from 'axios';

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
