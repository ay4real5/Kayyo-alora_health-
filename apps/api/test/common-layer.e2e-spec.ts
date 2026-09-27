import { Body, Controller, Get, NotFoundException, Post, Query } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsEmail, IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { Paginated, PaginationQueryDto } from '../src/common/dto/pagination.dto.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { setupApp } from '../src/setup-app.js';

class CreateThingDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;
}

/** Test-only endpoints that exercise each behaviour of the common layer. */
@Controller('probe')
class ProbeController {
  @Get('list')
  list(@Query() query: PaginationQueryDto) {
    return Paginated.of([{ id: 1 }], 42, query);
  }

  @Post('things')
  create(@Body() dto: CreateThingDto) {
    return { created: dto.name };
  }

  @Get('missing')
  missing() {
    throw new NotFoundException('Thing not found');
  }

  @Get('crash')
  crash() {
    throw new Error('secret internal detail: SELECT * FROM patients');
  }

  @Get('duplicate')
  duplicate() {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
  }
}

describe('Common layer (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps paginated results with meta and applies query defaults/limits', async () => {
    const res = await http().get('/api/v1/probe/list?page=3').expect(200);
    expect(res.body).toEqual({ success: true, data: [{ id: 1 }], meta: { page: 3, limit: 20, total: 42 } });
    await http().get('/api/v1/probe/list?limit=500').expect(400);
  });

  it('validates bodies and lists every problem', async () => {
    const res = await http().post('/api/v1/probe/things').send({ name: 'x', email: 'nope' }).expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toHaveLength(2);
  });

  it('rejects unknown fields', async () => {
    const res = await http()
      .post('/api/v1/probe/things')
      .send({ name: 'Ok name', email: 'a@b.co', isAdmin: true })
      .expect(400);
    expect(res.body.error.details).toEqual(['property isAdmin should not exist']);
  });

  it('accepts a valid body', async () => {
    const res = await http().post('/api/v1/probe/things').send({ name: 'Ok name', email: 'a@b.co' }).expect(201);
    expect(res.body).toEqual({ success: true, data: { created: 'Ok name' } });
  });

  it('formats HTTP errors', async () => {
    const res = await http().get('/api/v1/probe/missing').expect(404);
    expect(res.body).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Thing not found' } });
  });

  it('hides internal error details', async () => {
    const res = await http().get('/api/v1/probe/crash').expect(500);
    expect(res.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(JSON.stringify(res.body)).not.toContain('SELECT');
  });

  it('maps Prisma unique violations to 409', async () => {
    const res = await http().get('/api/v1/probe/duplicate').expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('sets a request id (reusing a safe incoming one) and security headers', async () => {
    const generated = await http().get('/api/v1/health').expect(200);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.headers['x-content-type-options']).toBe('nosniff');

    const reused = await http().get('/api/v1/health').set('X-Request-Id', 'lb-abc123').expect(200);
    expect(reused.headers['x-request-id']).toBe('lb-abc123');

    const unsafe = await http().get('/api/v1/health').set('X-Request-Id', 'bad id <script>').expect(200);
    expect(unsafe.headers['x-request-id']).not.toContain('<');
  });
});
