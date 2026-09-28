import { randomUUID } from 'node:crypto';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, ROLES } from '@alora/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { Permissions } from '../src/common/decorators/permissions.decorator.js';
import { Public } from '../src/common/decorators/public.decorator.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { PermissionsService } from '../src/modules/rbac/permissions.service.js';
import { RbacSyncService } from '../src/modules/rbac/rbac-sync.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

/** Test-only routes guarded by specific permissions. */
@Controller('rbac-probe')
class RbacProbeController {
  @Permissions('billing:read')
  @Get('billing')
  billing() {
    return 'billing ok';
  }

  @Permissions('visit_notes:create', 'visit_notes:sign')
  @Get('sign-notes')
  signNotes() {
    return 'notes ok';
  }

  @Get('any-user')
  anyUser() {
    return 'any user ok';
  }

  /** Misconfiguration: public route with a permission. Must still refuse anonymous callers. */
  @Public()
  @Permissions('patients:read')
  @Get('public-with-permission')
  misconfigured() {
    return 'should never be reached anonymously';
  }
}

describe.skipIf(!hasDb)('RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let otherAgencyId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RbacProbeController],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: false }));
    await app.init(); // runs RbacSyncService
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `RBAC Test ${randomUUID()}` } })).id;
    otherAgencyId = (await prisma.agency.create({ data: { name: `RBAC Other ${randomUUID()}` } })).id;
  });

  afterAll(async () => {
    for (const id of [agencyId, otherAgencyId]) {
      await purgeAuditLogs(prisma, id);
      await prisma.user.deleteMany({ where: { agencyId: id } });
      await prisma.role.deleteMany({ where: { agencyId: id } });
      await prisma.agency.delete({ where: { id } });
    }
    await app.close();
  });

  /** Creates a user holding the given role ids and returns a bearer header for them. */
  async function userWithRoles(roleIds: string[]) {
    const email = `rbac-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Rbac',
        lastName: 'User',
        userRoles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });
    const accessToken = await loginForTests(http(), email, PASSWORD);
    return { id: user.id, auth: { Authorization: `Bearer ${accessToken}` } };
  }

  const systemRoleId = async (name: string) =>
    (await prisma.role.findFirstOrThrow({ where: { agencyId: null, isSystem: true, name } })).id;

  it('syncs the permission catalogue and every built-in role with exactly its defaults', async () => {
    const permissions = await prisma.permission.findMany();
    const keys = new Set(permissions.map((p) => `${p.resource}:${p.action}`));
    for (const p of PERMISSIONS) expect(keys).toContain(p);

    for (const name of ROLES) {
      const role = await prisma.role.findFirstOrThrow({
        where: { agencyId: null, isSystem: true, name },
        include: { rolePermissions: { include: { permission: true } } },
      });
      const granted = role.rolePermissions.map(({ permission }) => `${permission.resource}:${permission.action}`);
      expect(granted.sort(), name).toEqual([...ROLE_DEFAULT_PERMISSIONS[name]].sort());
    }
  });

  it('is idempotent and repairs drift in built-in roles', async () => {
    const aide = await systemRoleId('home_health_aide');
    const billingRead = await prisma.permission.findUniqueOrThrow({
      where: { resource_action: { resource: 'billing', action: 'read' } },
    });
    // Someone grants an aide billing access directly in the database...
    await prisma.rolePermission.create({ data: { roleId: aide, permissionId: billingRead.id } });
    await app.get(RbacSyncService).sync();
    await app.get(RbacSyncService).sync();
    // ...and the next sync takes it away again.
    expect(await prisma.rolePermission.count({ where: { roleId: aide, permissionId: billingRead.id } })).toBe(0);
    expect(await prisma.role.count({ where: { agencyId: null, isSystem: true } })).toBe(ROLES.length);
  });

  it('allows a role with the permission and refuses one without it', async () => {
    const biller = await userWithRoles([await systemRoleId('billing_staff')]);
    const nurse = await userWithRoles([await systemRoleId('registered_nurse')]);

    expect((await http().get('/api/v1/rbac-probe/billing').set(biller.auth).expect(200)).body.data).toBe('billing ok');
    const denied = await http().get('/api/v1/rbac-probe/billing').set(nurse.auth).expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('requires every listed permission', async () => {
    const aide = await userWithRoles([await systemRoleId('home_health_aide')]); // can create notes, not sign
    const rn = await userWithRoles([await systemRoleId('registered_nurse')]);
    await http().get('/api/v1/rbac-probe/sign-notes').set(aide.auth).expect(403);
    await http().get('/api/v1/rbac-probe/sign-notes').set(rn.auth).expect(200);
  });

  it('combines permissions across several roles', async () => {
    const both = await userWithRoles([await systemRoleId('home_health_aide'), await systemRoleId('billing_staff')]);
    await http().get('/api/v1/rbac-probe/billing').set(both.auth).expect(200);
  });

  it('lets any logged-in user through routes without @Permissions, but not anonymous callers', async () => {
    const nobody = await userWithRoles([]);
    await http().get('/api/v1/rbac-probe/any-user').set(nobody.auth).expect(200);
    await http().get('/api/v1/rbac-probe/any-user').expect(401);
    await http().get('/api/v1/rbac-probe/billing').expect(401);
  });

  it('never lets a @Public() route with @Permissions through anonymously', async () => {
    await http().get('/api/v1/rbac-probe/public-with-permission').expect(401);
  });

  it("ignores another agency's custom role even if linked to the user", async () => {
    const foreignRole = await prisma.role.create({ data: { agencyId: otherAgencyId, name: `billing-${randomUUID()}` } });
    const billingRead = await prisma.permission.findUniqueOrThrow({
      where: { resource_action: { resource: 'billing', action: 'read' } },
    });
    await prisma.rolePermission.create({ data: { roleId: foreignRole.id, permissionId: billingRead.id } });

    const user = await userWithRoles([foreignRole.id]);
    await http().get('/api/v1/rbac-probe/billing').set(user.auth).expect(403);
  });

  it("honours the user's own agency's custom roles, and /auth/me reports what is enforced", async () => {
    const custom = await prisma.role.create({ data: { agencyId, name: `billing-lite-${randomUUID()}` } });
    const billingRead = await prisma.permission.findUniqueOrThrow({
      where: { resource_action: { resource: 'billing', action: 'read' } },
    });
    await prisma.rolePermission.create({ data: { roleId: custom.id, permissionId: billingRead.id } });

    const user = await userWithRoles([custom.id]);
    await http().get('/api/v1/rbac-probe/billing').set(user.auth).expect(200);
    const me = (await http().get('/api/v1/auth/me').set(user.auth).expect(200)).body.data;
    expect(me.roles).toEqual([custom.name]);
    expect(me.permissions).toEqual(['billing:read']);
  });

  it("lists assignable roles: built-in plus own custom roles, never another agency's", async () => {
    const own = await prisma.role.create({ data: { agencyId, name: `own-${randomUUID()}` } });
    const foreign = await prisma.role.create({ data: { agencyId: otherAgencyId, name: `foreign-${randomUUID()}` } });
    const admin = await userWithRoles([await systemRoleId('agency_admin')]);

    const roles = (await http().get('/api/v1/roles').set(admin.auth).expect(200)).body.data as { id: string; name: string; isSystem: boolean; permissions: string[] }[];
    expect(roles.filter((r) => r.isSystem)).toHaveLength(ROLES.length);
    expect(roles.map((r) => r.id)).toContain(own.id);
    expect(roles.map((r) => r.id)).not.toContain(foreign.id);
    expect(roles.find((r) => r.name === 'billing_staff')!.permissions).toContain('billing:read');

    const nurse = await userWithRoles([await systemRoleId('registered_nurse')]);
    await http().get('/api/v1/roles').set(nurse.auth).expect(403);
  });

  it('picks up role changes once the cache is invalidated', async () => {
    const user = await userWithRoles([]);
    await http().get('/api/v1/rbac-probe/billing').set(user.auth).expect(403);

    await prisma.userRole.create({ data: { userId: user.id, roleId: await systemRoleId('billing_staff') } });
    app.get(PermissionsService).invalidate();
    await http().get('/api/v1/rbac-probe/billing').set(user.auth).expect(200);
  });
});
