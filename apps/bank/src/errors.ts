import type { ErrorRequestHandler } from 'express';

/** An error with an HTTP status and a stable machine-readable code: `{ error, message }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'validation_error', message, {}, details);
export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);

// Express recognises error handlers by their 4 parameters, so the unused `next` must stay
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res
      .set(err.headers)
      .status(err.status)
      .json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  // Malformed JSON body from express.json()
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: 'Unexpected error' });
};
