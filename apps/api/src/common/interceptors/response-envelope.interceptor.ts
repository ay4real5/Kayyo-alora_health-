import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { ApiSuccess } from '@alora/shared';
import { map, type Observable } from 'rxjs';
import { Paginated } from '../dto/pagination.dto.js';

/** Wraps every successful response as `{ success: true, data, meta? }`. Files are passed through. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown): unknown => {
        if (body instanceof StreamableFile) return body;
        if (body instanceof Paginated) {
          return { success: true, data: body.items, meta: body.meta } satisfies ApiSuccess<unknown>;
        }
        return { success: true, data: body ?? null } satisfies ApiSuccess<unknown>;
      }),
    );
  }
}
