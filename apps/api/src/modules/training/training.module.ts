import { DISCIPLINES } from '@alora/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { trimmed } from '../../common/validators/fields.js';
import { addMonths, fromDate, toDate } from '../../common/utils/dates.js';
import { AgencyClockService } from '../../database/agency-clock.service.js';
import { PrismaService } from '../../database/prisma.service.js';

// ── DTOs ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export class QuestionDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  prompt!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(300, { each: true })
  options!: string[];

  @IsInt()
  @Min(0)
  correctIndex!: number;
}

export class CourseDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  summary?: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  content!: string;

  @IsOptional()
  @IsArray()
  @IsIn(DISCIPLINES, { each: true })
  disciplines?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  passPercent?: number;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  credentialType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  validityMonths?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions!: QuestionDto[];
}

export class UpdateCourseDto {
  @IsOptional() @Transform(trimmed) @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(500) summary?: string;
  @IsOptional() @Transform(trimmed) @IsString() @IsNotEmpty() @MaxLength(50_000) content?: string;
  @IsOptional() @IsArray() @IsIn(DISCIPLINES, { each: true }) disciplines?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(100) passPercent?: number;
  @IsOptional() @Transform(trimmed) @IsString() @MaxLength(100) credentialType?: string;
  @IsOptional() @IsInt() @Min(1) @Max(120) validityMonths?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Replaces every question when given. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions?: QuestionDto[];
}

export class SubmitQuizDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(0, { each: true })
  answers!: number[];
}

// ── Service ──────────────────────────────────────────────────────────────────────────────────────────────────────

const normalizeType = (t: string | undefined | null) => (t ? t.trim().toLowerCase().replaceAll(/\s+/g, '_') : null);

function assertAnswers(questions: QuestionDto[]) {
  questions.forEach((q, i) => {
    if (q.correctIndex >= q.options.length) throw new BadRequestException(`Question ${i + 1}: the right answer must be one of its options`);
  });
}

export type CourseStatus = 'not_started' | 'failed' | 'passed' | 'expired';

/**
 * Primordial Academy (D-102): agencies write short courses with a multiple-choice quiz; caregivers take them in the
 * app. Passing records a credential when the course grants one, so it counts towards onboarding (D-101) and
 * credential expiry alerts like any other. Answers are checked on the server; the right answers are never sent out.
 */
@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AgencyClockService,
  ) {}

  async list(caller: AuthUser) {
    const courses = await this.prisma.trainingCourse.findMany({
      where: { agencyId: caller.agencyId },
      include: { _count: { select: { questions: true } }, completions: { where: { passed: true }, select: { staffProfileId: true } } },
      orderBy: [{ isActive: 'desc' }, { title: 'asc' }],
    });
    return courses.map(({ completions, _count, content: _content, ...c }) => ({
      ...c,
      questions: _count.questions,
      passedBy: new Set(completions.map((x) => x.staffProfileId)).size,
    }));
  }

  async get(caller: AuthUser, id: string) {
    const course = await this.prisma.trainingCourse.findFirst({
      where: { id, agencyId: caller.agencyId },
      include: { questions: { orderBy: { sortOrder: 'asc' }, select: { prompt: true, options: true, correctIndex: true } } },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  async create(caller: AuthUser, dto: CourseDto) {
    assertAnswers(dto.questions);
    const { questions, credentialType, ...fields } = dto;
    const course = await this.prisma.trainingCourse.create({
      data: {
        ...fields,
        disciplines: fields.disciplines ?? [],
        credentialType: normalizeType(credentialType),
        agencyId: caller.agencyId,
        questions: { create: questions.map((q, i) => ({ ...q, sortOrder: i })) },
      },
    });
    return this.get(caller, course.id);
  }

  async update(caller: AuthUser, id: string, dto: UpdateCourseDto) {
    await this.get(caller, id);
    const { questions, credentialType, ...fields } = dto;
    if (questions) assertAnswers(questions);
    await this.prisma.$transaction([
      this.prisma.trainingCourse.update({
        where: { id },
        data: { ...fields, ...(credentialType !== undefined ? { credentialType: normalizeType(credentialType) } : {}) },
      }),
      ...(questions
        ? [
            this.prisma.trainingQuestion.deleteMany({ where: { courseId: id } }),
            this.prisma.trainingQuestion.createMany({ data: questions.map((q, i) => ({ ...q, courseId: id, sortOrder: i })) }),
          ]
        : []),
    ]);
    return this.get(caller, id);
  }

  /** Each attempt, newest first, with who took it. */
  async results(caller: AuthUser, id: string) {
    await this.get(caller, id);
    const rows = await this.prisma.trainingCompletion.findMany({
      where: { courseId: id },
      include: { staffProfile: { select: { id: true, discipline: true, user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { completedAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      staffId: r.staffProfile.id,
      name: `${r.staffProfile.user.firstName} ${r.staffProfile.user.lastName}`,
      discipline: r.staffProfile.discipline,
      scorePercent: r.scorePercent,
      passed: r.passed,
      completedAt: r.completedAt,
    }));
  }

  private async me(caller: AuthUser) {
    const staff = await this.prisma.staffProfile.findFirst({ where: { userId: caller.userId, agencyId: caller.agencyId, isActive: true }, select: { id: true, discipline: true } });
    if (!staff) throw new NotFoundException('Training is for staff members');
    return staff;
  }

  private forDiscipline(discipline: string) {
    return { OR: [{ disciplines: { isEmpty: true } }, { disciplines: { has: discipline } }] };
  }

  /** The caller's courses (their discipline, active) and where they stand on each. */
  async myCourses(caller: AuthUser) {
    const staff = await this.me(caller);
    const today = await this.clock.todayString(caller.agencyId);
    const courses = await this.prisma.trainingCourse.findMany({
      where: { agencyId: caller.agencyId, isActive: true, ...this.forDiscipline(staff.discipline) },
      select: {
        id: true,
        title: true,
        summary: true,
        credentialType: true,
        validityMonths: true,
        _count: { select: { questions: true } },
        completions: { where: { staffProfileId: staff.id }, orderBy: { completedAt: 'desc' }, take: 10, select: { passed: true, scorePercent: true, completedAt: true } },
      },
      orderBy: { title: 'asc' },
    });
    return courses.map((c) => {
      const lastPass = c.completions.find((x) => x.passed);
      const validUntil = lastPass && c.validityMonths ? addMonths(fromDate(lastPass.completedAt)!, c.validityMonths) : null;
      const status: CourseStatus = lastPass
        ? validUntil && validUntil < today
          ? 'expired'
          : 'passed'
        : c.completions.length
          ? 'failed'
          : 'not_started';
      return {
        id: c.id,
        title: c.title,
        summary: c.summary,
        questions: c._count.questions,
        grantsCredential: Boolean(c.credentialType),
        status,
        lastScore: c.completions[0]?.scorePercent ?? null,
        passedAt: lastPass?.completedAt ?? null,
        validUntil,
      };
    });
  }

  /** The lesson and the questions — without the answers. */
  async myCourse(caller: AuthUser, id: string) {
    const staff = await this.me(caller);
    const course = await this.prisma.trainingCourse.findFirst({
      where: { id, agencyId: caller.agencyId, isActive: true, ...this.forDiscipline(staff.discipline) },
      select: { id: true, title: true, summary: true, content: true, passPercent: true, questions: { orderBy: { sortOrder: 'asc' }, select: { prompt: true, options: true } } },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  async submit(caller: AuthUser, id: string, answers: number[]) {
    const staff = await this.me(caller);
    const course = await this.prisma.trainingCourse.findFirst({
      where: { id, agencyId: caller.agencyId, isActive: true, ...this.forDiscipline(staff.discipline) },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (answers.length !== course.questions.length) throw new BadRequestException(`Answer all ${course.questions.length} questions`);
    const right = course.questions.filter((q, i) => answers[i] === q.correctIndex).length;
    const scorePercent = Math.round((right / course.questions.length) * 100);
    const passed = scorePercent >= course.passPercent;
    const today = await this.clock.todayString(caller.agencyId);

    let credentialId: string | null = null;
    if (passed && course.credentialType) {
      const credential = await this.prisma.staffCredential.create({
        data: {
          staffProfileId: staff.id,
          credentialType: course.credentialType,
          credentialName: course.title,
          issuingAuthority: 'Primordial Academy',
          issueDate: toDate(today),
          expiryDate: course.validityMonths ? toDate(addMonths(today, course.validityMonths)) : null,
          notes: `Passed with ${scorePercent}%`,
        },
      });
      credentialId = credential.id;
    }
    await this.prisma.trainingCompletion.create({ data: { courseId: id, staffProfileId: staff.id, scorePercent, passed, credentialId } });
    // Which questions were wrong (by number) helps them learn; the right answers stay private.
    const wrong = course.questions.map((q, i) => (answers[i] === q.correctIndex ? null : i + 1)).filter((n): n is number => n !== null);
    return { scorePercent, passed, passPercent: course.passPercent, wrongQuestions: wrong, credentialRecorded: Boolean(credentialId) };
  }
}

// ── Controller ───────────────────────────────────────────────────────────────────────────────────────────────────

const uuid = () => new ParseUUIDPipe();

@ApiTags('training')
@Controller('training')
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  /** Courses for the signed-in caregiver, with their status. */
  @Get('my')
  myCourses(@CurrentUser() caller: AuthUser) {
    return this.training.myCourses(caller);
  }

  @Get('my/:id')
  myCourse(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.training.myCourse(caller, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audit({ action: 'SUBMIT_TRAINING_QUIZ', resourceType: 'training' })
  @Post('my/:id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: SubmitQuizDto) {
    return this.training.submit(caller, id, dto.answers);
  }

  @Permissions('training:manage')
  @Get('courses')
  list(@CurrentUser() caller: AuthUser) {
    return this.training.list(caller);
  }

  @Permissions('training:manage')
  @Get('courses/:id')
  get(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.training.get(caller, id);
  }

  @Permissions('training:manage')
  @Get('courses/:id/results')
  results(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string) {
    return this.training.results(caller, id);
  }

  @Permissions('training:manage')
  @Audit({ action: 'CREATE_TRAINING_COURSE', resourceType: 'training' })
  @Post('courses')
  create(@CurrentUser() caller: AuthUser, @Body() dto: CourseDto) {
    return this.training.create(caller, dto);
  }

  @Permissions('training:manage')
  @Audit({ action: 'UPDATE_TRAINING_COURSE', resourceType: 'training' })
  @Patch('courses/:id')
  update(@CurrentUser() caller: AuthUser, @Param('id', uuid()) id: string, @Body() dto: UpdateCourseDto) {
    return this.training.update(caller, id, dto);
  }
}

@Module({ controllers: [TrainingController], providers: [TrainingService] })
export class TrainingModule {}
