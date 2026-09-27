import {
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { catchError, concatMap, from, type Observable } from 'rxjs';
import { AUDIT_KEY, SKIP_AUDIT_KEY, type AuditOptions } from '../../common/decorators/audit.decorator.js';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { AuditService } from './audit.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERB: Record<string, string> = { GET: 'VIEW', POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };

/**
 * HIPAA audit trail for agency data (DECISIONS D-023). Global. Records one audit_logs row per request to
 * any authenticated route that has @Permissions or @Audit, on success AND on failure.
 *
 * Never logged: request bodies, query-string values, response bodies — they may contain PHI.
 * Logged: who, action, resource type/id, route pattern, method, outcome, status, duration, query-param
 * NAMES, result count for lists, correlation id, IP, user agent.
 *
 * The audit write is awaited before the response is sent, so a response is never delivered without its
 * audit record being attempted. A failed audit write is logged loudly but doesn't fail the request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<Request>();
    const options = this.reflector.getAllAndOverride<AuditOptions | undefined>(AUDIT_KEY, targets);
    const permissions = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets);
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_AUDIT_KEY, targets);

    if (skip || !request.user || (!options && !permissions?.length)) return next.handle();

    const user = request.user;
    const startedAt = Date.now();
    const resourceType = options?.resourceType ?? permissions?.[0]?.split(':')[0];
    const action =
      options?.action ?? `${VERB[request.method] ?? request.method}_${(resourceType ?? 'RESOURCE').toUpperCase()}`;
    const paramId = request.params[options?.idParam ?? 'id'];

    const write = (outcome: 'success' | 'error', extra: { status?: number; resultCount?: number; createdId?: string }) =>
      this.audit.record({
        agencyId: user.agencyId,
        userId: user.userId,
        action,
        resourceType,
        resourceId: validUuid(extra.createdId ?? paramId),
        details: {
          outcome,
          method: request.method,
          route: routePattern(request),
          durationMs: Date.now() - startedAt,
          correlationId: request.correlationId,
          ...(extra.status !== undefined ? { status: extra.status } : {}),
          ...(extra.resultCount !== undefined ? { resultCount: extra.resultCount } : {}),
          ...(Object.keys(request.query).length ? { queryKeys: Object.keys(request.query).sort() } : {}),
        },
        ipAddress: request.ip,
        userAgent: request.header('user-agent'),
      });

    return next.handle().pipe(
      concatMap((body: unknown) =>
        from(
          write('success', {
            resultCount: countOf(body),
            createdId: request.method === 'POST' && !paramId ? idOf(body) : undefined,
          }).then(() => body),
        ),
      ),
      catchError((error: unknown) =>
        from(
          write('error', { status: error instanceof HttpException ? error.getStatus() : 500 }).then(() => {
            throw error;
          }),
        ),
      ),
    );
  }
}

function validUuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value) ? value : undefined;
}

/** '/api/v1/patients/:id' rather than the concrete URL. */
function routePattern(request: Request): string {
  const route = (request.route as { path?: string } | undefined)?.path;
  return route ? `${request.baseUrl}${route}` : request.path;
}

/**
 * This interceptor runs outside ResponseEnvelopeInterceptor, so it usually sees `{ success, data, meta }`;
 * accept the raw handler result too, in case interceptor order ever changes.
 */
function payloadOf(body: unknown): unknown {
  if (body instanceof Paginated) return body.items;
  if (body && typeof body === 'object' && (body as { success?: unknown }).success === true && 'data' in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

function countOf(body: unknown): number | undefined {
  const payload = payloadOf(body);
  return Array.isArray(payload) ? payload.length : undefined;
}

function idOf(body: unknown): string | undefined {
  const payload = payloadOf(body);
  if (payload && typeof payload === 'object' && 'id' in payload) {
    return validUuid((payload as { id: unknown }).id);
  }
  return undefined;
}
