/** An error whose status and message are safe to send to the kiosk. */
export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 413,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
