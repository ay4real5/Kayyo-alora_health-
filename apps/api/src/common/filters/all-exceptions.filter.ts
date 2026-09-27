import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiError } from '@alora/shared';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

interface ErrorShape {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Turns every thrown error into `{ success: false, error: { code, message, details? } }`.
 * Unexpected errors are logged with the request's correlation id and returned as a generic 500 —
 * internal messages, SQL and stack traces never reach the client (they may contain PHI).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const shape = this.toShape(exception);
    if (shape.status >= 500) {
      this.logger.error(
        `${req.method} ${req.path} failed [request ${req.correlationId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiError = {
      success: false,
      error: { code: shape.code, message: shape.message, ...(shape.details ? { details: shape.details } : {}) },
    };
    res.status(shape.status).json(body);
  }

  private toShape(exception: unknown): ErrorShape {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'object' && response !== null && 'message' in response
          ? (response as { message: unknown }).message
          : response;

      // ValidationPipe reports all field problems as an array of messages.
      if (status === HttpStatus.BAD_REQUEST && Array.isArray(message)) {
        return { status, code: 'VALIDATION_ERROR', message: 'Validation failed', details: message };
      }
      return {
        status,
        code: CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
        message: status >= 500 ? 'Internal server error' : String(message),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return { status: 409, code: 'CONFLICT', message: 'A record with these values already exists' };
      }
      if (exception.code === 'P2025') {
        return { status: 404, code: 'NOT_FOUND', message: 'Record not found' };
      }
      if (exception.code === 'P2003') {
        return { status: 409, code: 'CONFLICT', message: 'Related record does not exist or is still in use' };
      }
    }

    return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
  }
}
