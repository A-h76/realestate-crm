export class ApiError extends Error {
  status: number;
  headers?: Record<string, string>;
  /** Extra JSON fields returned with the error (e.g. which record a request conflicts with). */
  details?: Record<string, unknown>;

  constructor(status: number, message: string, headers?: Record<string, string>, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.headers = headers;
    this.details = details;
  }
}
