/** Errors raised by the domain layer; the HTTP layer maps `status` to a response code. */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429 = 400,
    readonly code = 'domain_error',
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string) => new DomainError(`${what} not found`, 404, 'not_found');
export const conflict = (message: string) => new DomainError(message, 409, 'conflict');
