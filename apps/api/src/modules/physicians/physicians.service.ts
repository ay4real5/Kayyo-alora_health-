import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Paginated } from '../../common/dto/pagination.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, type Physician } from '../../generated/prisma/client.js';
import type { CreatePhysicianDto, ListPhysiciansQueryDto, UpdatePhysicianDto } from './dto/physicians.dto.js';

export type PhysicianView = Omit<Physician, 'agencyId'>;

/** The agency's directory of referring/ordering physicians. Scoped to the caller's agency. */
@Injectable()
export class PhysiciansService {
  constructor(private readonly prisma: PrismaService) {}

  async list(caller: AuthUser, query: ListPhysiciansQueryDto): Promise<Paginated<PhysicianView>> {
    const where: Prisma.PhysicianWhereInput = {
      agencyId: caller.agencyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { practiceName: { contains: query.search, mode: 'insensitive' } },
              { npi: query.search },
            ],
          }
        : {}),
    };
    const [physicians, total] = await Promise.all([
      this.prisma.physician.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.physician.count({ where }),
    ]);
    return Paginated.of(physicians.map(toView), total, query);
  }

  async get(caller: AuthUser, id: string): Promise<PhysicianView> {
    return toView(await this.find(caller, id));
  }

  async create(caller: AuthUser, dto: CreatePhysicianDto): Promise<PhysicianView> {
    return toView(
      await this.saveOrConflict(() =>
        this.prisma.physician.create({
          data: { ...(fields(dto) as { firstName: string; lastName: string }), agencyId: caller.agencyId },
        }),
      ),
    );
  }

  async update(caller: AuthUser, id: string, dto: UpdatePhysicianDto): Promise<PhysicianView> {
    await this.find(caller, id);
    return toView(await this.saveOrConflict(() => this.prisma.physician.update({ where: { id }, data: fields(dto) })));
  }

  private async find(caller: AuthUser, id: string): Promise<Physician> {
    const physician = await this.prisma.physician.findFirst({ where: { id, agencyId: caller.agencyId } });
    if (!physician) throw new NotFoundException('Physician not found');
    return physician;
  }

  private async saveOrConflict(save: () => Promise<Physician>): Promise<Physician> {
    try {
      return await save();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A physician with this NPI is already in the directory');
      }
      throw error;
    }
  }
}

const WRITABLE = [
  'firstName', 'lastName', 'npi', 'practiceName', 'phone', 'fax', 'email', 'addressLine1', 'city', 'state', 'zip',
  'isActive',
] as const;

/** Only known columns, and only those present in the request, are written. */
function fields(dto: UpdatePhysicianDto): Prisma.PhysicianUncheckedUpdateInput {
  const data: Record<string, unknown> = {};
  for (const key of WRITABLE) if (dto[key] !== undefined) data[key] = dto[key];
  return data;
}

function toView({ agencyId: _agencyId, ...physician }: Physician): PhysicianView {
  return physician;
}
