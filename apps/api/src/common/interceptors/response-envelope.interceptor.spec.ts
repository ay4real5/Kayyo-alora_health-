import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Paginated, PaginationQueryDto } from '../dto/pagination.dto.js';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor.js';

const run = (body: unknown) =>
  lastValueFrom(
    new ResponseEnvelopeInterceptor().intercept({} as ExecutionContext, {
      handle: () => of(body),
    } as CallHandler),
  );

describe('ResponseEnvelopeInterceptor', () => {
  it('wraps plain bodies', async () => {
    expect(await run({ a: 1 })).toEqual({ success: true, data: { a: 1 } });
    expect(await run(undefined)).toEqual({ success: true, data: null });
  });

  it('moves pagination into meta', async () => {
    const query = Object.assign(new PaginationQueryDto(), { page: 2, limit: 10 });
    expect(query.skip).toBe(10);
    expect(await run(Paginated.of(['x'], 11, query))).toEqual({
      success: true,
      data: ['x'],
      meta: { page: 2, limit: 10, total: 11 },
    });
  });
});
