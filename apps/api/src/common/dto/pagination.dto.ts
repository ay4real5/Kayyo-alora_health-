import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { PaginationMeta } from '@alora/shared';

/** Query params for list endpoints: `?page=2&limit=50`. */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/** Return this from a controller to get `{ success, data, meta }` instead of `{ success, data }`. */
export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: PaginationMeta,
  ) {}

  static of<T>(items: T[], total: number, query: PaginationQueryDto): Paginated<T> {
    return new Paginated(items, { page: query.page, limit: query.limit, total });
  }
}
