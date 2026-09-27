import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const NEW_USER_PASSWORD = 'Starting-Pass-1!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};

describe.skipIf(!hasDb)('Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let otherAgencyId: string;
  const roleIds: Record<string, string> = {};
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Users Test ${randomUUID()}` } })).id;
    otherAgencyId = (await prisma.agency.create({ data: { name: `Users Other ${randomUUID()}` } })).id;
    for (const role of await prisma.role.findMany({ where: { agencyId: null, isSystem: true } })) {
      roleIds[role.name] = role.id;
    }
  });

  afterAll(async () => {
    for (const id of [agencyId, otherAgencyId]) {
      await prisma.auditLog.deleteMany({ where: { agencyId: id } });
      await prisma.user.deleteMany({ where: { agencyId: id } });
      await prisma.role.deleteMany({ where: { agencyId: id } });
      await prisma.agency.delete({ where: { id } });
    }
    await app.close();
  });

  /** Seeds a user directly and returns id, email and a bearer header. */
  async function seedUser(roles: string[], inAgency = agencyId) {
    const email = `u-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId: inAgency,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Seed',
        lastName: `User-${randomUUID().slice(0, 6)}`,
        userRoles: { create: roles.map((name) => ({ roleId: roleIds[name] ?? name })) },
      },
    });
    const { accessToken } = (await http().post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.data;
    return { id: user.id, email, auth: { Authorization: `Bearer ${accessToken}` } };
  }

  const newUserBody = (roles: string[], overrides: Record<string, unknown> = {}) => ({
    email: `New.User-${randomUUID()}@Example.test`,
    firstName: ' Nora ',
    lastName: 'Nurse',
    phone: '+1 (555) 010-2000',
    password: NEW_USER_PASSWORD,
    roleIds: roles.map((name) => roleIds[name] ?? name),
    ...overrides,
  });

  describe('create', () => {
    it('creates a user who must change the starting password at first login', async () => {
      const admin = await seedUser(['agency_admin']);
      const body = newUserBody(['registered_nurse']);
      const res = await http().post('/api/v1/users').set(admin.auth).send(body).expect(201);

      expect(res.body.data).toMatchObject({
        email: body.email.toLowerCase(),
        firstName: 'Nora',
        isActive: true,
        is2faEnabled: false,
        roles: [{ name: 'registered_nurse' }],
      });
      expect(res.body.data).not.toHaveProperty('passwordHash');
      expect(res.body.data).not.toHaveProperty('twoFaSecret');

      const login = await http().post('/api/v1/auth/login').send({ email: body.email, password: NEW_USER_PASSWORD });
      expect(login.body.data.mustChangePassword).toBe(true);
    });

    it('rejects weak passwords, bad roles and duplicate emails', async () => {
      const admin = await seedUser(['agency_admin']);
      await http().post('/api/v1/users').set(admin.auth).send(newUserBody([], { password: 'weak' })).expect(400);
      await http().post('/api/v1/users').set(admin.auth).send(newUserBody([randomUUID()])).expect(400);

      const body = newUserBody([]);
      await http().post('/api/v1/users').set(admin.auth).send(body).expect(201);
      const dup = await http().post('/api/v1/users').set(admin.auth).send(body).expect(409);
      expect(dup.body.error.message).toBe('A user with this email already exists');
    });

    it("refuses another agency's custom role", async () => {
      const admin = await seedUser(['agency_admin']);
      const foreign = await prisma.role.create({ data: { agencyId: otherAgencyId, name: `r-${randomUUID()}` } });
      await http().post('/api/v1/users').set(admin.auth).send(newUserBody([foreign.id])).expect(400);
    });
  });

  describe('no privilege escalation', () => {
    it('cannot grant a role carrying permissions the caller lacks', async () => {
      // A custom "HR" role that may create users but has nothing clinical or financial.
      const hr = await prisma.role.create({ data: { agencyId, name: `hr-${randomUUID()}` } });
      const perms = await prisma.permission.findMany({
        where: { OR: [{ resource: 'users' }, { resource: 'patients', action: 'read' }] },
      });
      await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: hr.id, permissionId: p.id })) });
      const hrUser = await seedUser([hr.id]);

      const denied = await http().post('/api/v1/users').set(hrUser.auth).send(newUserBody(['billing_staff'])).expect(403);
      expect(denied.body.error.message).toMatch(/permissions you do not have/);
      await http().post('/api/v1/users').set(hrUser.auth).send(newUserBody(['agency_admin'])).expect(403);

      // A role within the caller's own permissions is fine.
      const reader = await prisma.role.create({ data: { agencyId, name: `reader-${randomUUID()}` } });
      const patientsRead = perms.find((p) => p.resource === 'patients')!;
      await prisma.rolePermission.create({ data: { roleId: reader.id, permissionId: patientsRead.id } });
      await http().post('/api/v1/users').set(hrUser.auth).send(newUserBody([reader.id])).expect(201);
    });

    it('only a super admin can create a super admin', async () => {
      const admin = await seedUser(['agency_admin']); // same permission set as super_admin, but not the role
      await http().post('/api/v1/users').set(admin.auth).send(newUserBody(['super_admin'])).expect(403);
      const superAdmin = await seedUser(['super_admin']);
      await http().post('/api/v1/users').set(superAdmin.auth).send(newUserBody(['super_admin'])).expect(201);
    });

    it("cannot deactivate or change someone with more access, even once they're deactivated", async () => {
      const admin = await seedUser(['agency_admin']);
      const superAdmin = await seedUser(['super_admin']);
      await http().delete(`/api/v1/users/${superAdmin.id}`).set(admin.auth).expect(403);

      await prisma.user.update({ where: { id: superAdmin.id }, data: { isActive: false } });
      await http().post(`/api/v1/users/${superAdmin.id}/reactivate`).set(admin.auth).expect(403);
    });

    it('cannot change own roles or deactivate self', async () => {
      const admin = await seedUser(['agency_admin']);
      await http().patch(`/api/v1/users/${admin.id}`).set(admin.auth).send({ roleIds: [roleIds.super_admin] }).expect(400);
      await http().delete(`/api/v1/users/${admin.id}`).set(admin.auth).expect(400);
    });
  });

  describe('read and update', () => {
    it('lists with pagination, search and filters, only within the agency', async () => {
      const admin = await seedUser(['agency_admin']);
      const marker = randomUUID().slice(0, 8);
      await prisma.user.create({
        data: { agencyId, email: `${marker}@example.test`, passwordHash: 'x', firstName: 'Findable', lastName: marker },
      });
      await prisma.user.create({
        data: { agencyId: otherAgencyId, email: `${marker}-other@example.test`, passwordHash: 'x', firstName: 'Hidden', lastName: marker },
      });

      const res = await http().get(`/api/v1/users?search=${marker}&limit=5`).set(admin.auth).expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].firstName).toBe('Findable');
      expect(res.body.meta).toMatchObject({ page: 1, limit: 5, total: 1 });

      const nurses = await http().get('/api/v1/users?role=agency_admin').set(admin.auth).expect(200);
      expect(nurses.body.data.every((u: { roles: { name: string }[] }) => u.roles.some((r) => r.name === 'agency_admin'))).toBe(true);
    });

    it("returns 404 for another agency's user and 400 for a malformed id", async () => {
      const admin = await seedUser(['agency_admin']);
      const outsider = await seedUser([], otherAgencyId);
      await http().get(`/api/v1/users/${outsider.id}`).set(admin.auth).expect(404);
      await http().patch(`/api/v1/users/${outsider.id}`).set(admin.auth).send({ firstName: 'X' }).expect(404);
      await http().get('/api/v1/users/not-a-uuid').set(admin.auth).expect(400);
    });

    it('updates details and roles; new roles take effect immediately', async () => {
      const admin = await seedUser(['agency_admin']);
      const target = await seedUser(['home_health_aide']);
      await http().get('/api/v1/users').set(target.auth).expect(403); // aides can't list users

      const res = await http()
        .patch(`/api/v1/users/${target.id}`)
        .set(admin.auth)
        .send({ lastName: 'Renamed', roleIds: [roleIds.office_staff, roleIds.agency_admin] })
        .expect(200);
      expect(res.body.data.lastName).toBe('Renamed');
      expect(res.body.data.roles.map((r: { name: string }) => r.name)).toEqual(['agency_admin', 'office_staff']);
      await http().get('/api/v1/users').set(target.auth).expect(200);
    });

    it('refuses callers without user permissions', async () => {
      const supervisor = await seedUser(['supervisor']);
      await http().get('/api/v1/users').set(supervisor.auth).expect(403);
      await http().post('/api/v1/users').set(supervisor.auth).send(newUserBody([])).expect(403);
    });
  });

  describe('account actions', () => {
    it('deactivation ends sessions and blocks login; reactivation restores it', async () => {
      const admin = await seedUser(['agency_admin']);
      const target = await seedUser(['registered_nurse']);
      const { refreshToken } = (
        await http().post('/api/v1/auth/login').send({ email: target.email, password: PASSWORD })
      ).body.data;

      await http().delete(`/api/v1/users/${target.id}`).set(admin.auth).expect(204);
      await http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
      await http().post('/api/v1/auth/login').send({ email: target.email, password: PASSWORD }).expect(401);
      expect(await prisma.auditLog.count({ where: { action: 'DEACTIVATE_USER', resourceId: target.id } })).toBe(1);

      await http().post(`/api/v1/users/${target.id}/reactivate`).set(admin.auth).expect(200);
      await http().post('/api/v1/auth/login').send({ email: target.email, password: PASSWORD }).expect(200);
    });

    it('unlocks a locked account', async () => {
      const admin = await seedUser(['agency_admin']);
      const target = await seedUser(['registered_nurse']);
      await prisma.user.update({ where: { id: target.id }, data: { lockedUntil: new Date(Date.now() + 3_600_000) } });
      await http().post('/api/v1/auth/login').send({ email: target.email, password: PASSWORD }).expect(401);

      const res = await http().post(`/api/v1/users/${target.id}/unlock`).set(admin.auth).expect(200);
      expect(res.body.data.isLocked).toBe(false);
      await http().post('/api/v1/auth/login').send({ email: target.email, password: PASSWORD }).expect(200);
    });

    it("resets a user's 2FA so they can log in with their password again", async () => {
      const admin = await seedUser(['agency_admin']);
      const target = await seedUser(['registered_nurse']);
      await prisma.user.update({ where: { id: target.id }, data: { is2faEnabled: true, twoFaSecret: 'x' } });
      const before = await http().post('/api/v1/auth/login').send({ email: target.email, password: PASSWORD });
      expect(before.body.data.requires2FA).toBe(true);

      await http().post(`/api/v1/users/${target.id}/reset-2fa`).set(admin.auth).expect(200);
      const after = await http().post('/api/v1/auth/login').send({ email: target.email, password: PASSWORD });
      expect(after.body.data.accessToken).toBeDefined();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).twoFaSecret).toBeNull();
    });

    it("shows a user's activity from the audit trail", async () => {
      const admin = await seedUser(['agency_admin']);
      const target = await seedUser(['registered_nurse']); // seeding logged them in once
      const res = await http().get(`/api/v1/users/${target.id}/activity`).set(admin.auth).expect(200);
      expect(res.body.data.map((e: { action: string }) => e.action)).toContain('LOGIN_SUCCESS');
      expect(typeof res.body.data[0].id).toBe('string');
      expect(res.body.meta.total).toBeGreaterThan(0);
    });
  });
});
