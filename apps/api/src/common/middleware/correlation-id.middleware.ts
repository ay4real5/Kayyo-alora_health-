import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'x-request-id';
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

declare module 'express-serve-static-core' {
  interface Request {
    /** Set on every request by correlationIdMiddleware; echoed back as X-Request-Id and used in logs. */
    correlationId: string;
  }
}

/** Reuses a well-formed incoming X-Request-Id (e.g. from the load balancer) or generates one. */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(CORRELATION_ID_HEADER);
  req.correlationId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(CORRELATION_ID_HEADER, req.correlationId);
  next();
}
