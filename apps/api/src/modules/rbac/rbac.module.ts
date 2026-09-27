import { Global, Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';
import { RbacGuard } from './rbac.guard.js';
import { RbacSyncService } from './rbac-sync.service.js';

/** RbacGuard is registered as a global guard in AuthModule, right after JwtAuthGuard (order matters). */
@Global()
@Module({
  providers: [PermissionsService, RbacGuard, RbacSyncService],
  exports: [PermissionsService, RbacGuard, RbacSyncService],
})
export class RbacModule {}
