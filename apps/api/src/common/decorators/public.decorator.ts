import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marker read by the OpenAPI builder to drop the bearer requirement from public operations. */
export const IS_PUBLIC_EXTENSION = 'x-public';

/** Every route requires a valid access token unless marked @Public(). Use sparingly. */
export const Public = () =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiExtension(IS_PUBLIC_EXTENSION, true));
