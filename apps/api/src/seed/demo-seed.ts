import { isValidNpi, recurrenceDates, todayInTimeZone, type Discipline } from '@alora/shared';
import { hash } from '@node-rs/argon2';
import { addDays, toDate, toTime } from '../common/utils/dates.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/**
 * Demo data for development and demos (DECISIONS D-033). Everything here is FAKE — invented names, example.test
 * style emails, 555 phone numbers. Deterministic (fixed-seed PRNG), idempotent (the demo agency is wiped and
 * rebuilt on every run), and refuses to run in production.
 */

export const DEMO_AGENCY_ID = '00000000-0000-4000-8000-00000000d3a0';
export const DEMO_EMAIL_DOMAIN = 'demo.alora.test';
export const DEFAULT_DEMO_PASSWORD = 'Demo-Password-1!';

export interface SeedSummary {
  agencyId: string;
  logins: { role: string; email: string }[];
  password: string;
  counts: Record<string, number>;
}

export interface SeedOptions {
  password?: string;
  appEnv?: string;
  /** Encrypts demo SSNs when provided (e.g. PhiCryptoService.encrypt). */
  encryptSsn?: (ssn: string, kind: 'patient' | 'staff') => Uint8Array<ArrayBuffer>;
  /** Makes sure built-in roles exist (RbacSyncService.sync). */
  syncRoles: () => Promise<void>;
}

/** Small deterministic PRNG (mulberry32), so every run produces the same demo agency. */
function prng(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}

const FIRST = ['Avery', 'Blake', 'Casey', 'Dana', 'Emery', 'Finley', 'Gale', 'Harper', 'Indigo', 'Jordan', 'Kendall', 'Logan', 'Morgan', 'Noel', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sage', 'Taylor', 'Umber', 'Vale', 'Wren', 'Yael', 'Zion'];
const LAST = ['Ashford', 'Bramble', 'Cobalt', 'Dunmore', 'Elsworth', 'Fairlane', 'Glenrock', 'Hollis', 'Ivers', 'Juniper', 'Kestrel', 'Larkspur', 'Merrow', 'Northam', 'Oakhurst', 'Penwick', 'Quarry', 'Redfern', 'Stillwater', 'Thistle', 'Underhill', 'Vantage', 'Whitlow', 'Yarrow'];
const STREETS = ['Maple Ave', 'Oak St', 'Birch Rd', 'Cedar Ln', 'Elm Ct', 'Willow Way', 'Aspen Dr', 'Linden Pl'];
const DIAGNOSES: [string, string][] = [
  ['E11.9', 'Type 2 diabetes mellitus without complications'],
  ['I10', 'Essential (primary) hypertension'],
  ['I50.9', 'Heart failure, unspecified'],
  ['J44.9', 'Chronic obstructive pulmonary disease, unspecified'],
  ['M17.11', 'Unilateral primary osteoarthritis, right knee'],
  ['Z96.651', 'Presence of right artificial knee joint'],
  ['G30.9', "Alzheimer's disease, unspecified"],
  ['I63.9', 'Cerebral infarction, unspecified'],
  ['N18.3', 'Chronic kidney disease, stage 3'],
  ['L89.152', 'Pressure ulcer of sacral region, stage 2'],
];
const ALLERGENS = ['Penicillin', 'Sulfa drugs', 'Latex', 'Codeine', 'Shellfish', 'Aspirin'];

/** Field staff to create: discipline, how many, their login role, and the visit type they do. */
const STAFF_PLAN: { discipline: Discipline; count: number; role: string; visitType: string }[] = [
  { discipline: 'RN', count: 3, role: 'registered_nurse', visitType: 'skilled_nursing' },
  { discipline: 'LPN', count: 1, role: 'licensed_nurse', visitType: 'skilled_nursing' },
  { discipline: 'PT', count: 2, role: 'therapist', visitType: 'physical_therapy' },
  { discipline: 'OT', count: 1, role: 'therapist', visitType: 'occupational_therapy' },
  { discipline: 'SLP', count: 1, role: 'therapist', visitType: 'speech_therapy' },
  { discipline: 'MSW', count: 1, role: 'medical_social_worker', visitType: 'medical_social_work' },
  { discipline: 'HHA', count: 6, role: 'home_health_aide', visitType: 'home_health_aide' },
];
const OFFICE_ROLES = ['super_admin', 'agency_admin', 'supervisor', 'office_staff', 'billing_staff'];
const SLOTS: [string, string][] = [['08:00', '09:00'], ['09:30', '10:30'], ['11:00', '12:00'], ['13:00', '14:00'], ['14:30', '15:30'], ['16:00', '17:00']];

/** A 10-digit NPI with a correct check digit, built from a 9-digit base. */
function makeNpi(base: number): string {
  const nine = String(base).padStart(9, '0').slice(0, 9);
  for (let d = 0; d <= 9; d++) if (isValidNpi(`${nine}${d}`)) return `${nine}${d}`;
  throw new Error('unreachable');
}

export async function runDemoSeed(prisma: PrismaClient, options: SeedOptions): Promise<SeedSummary> {
  if (options.appEnv === 'production') {
    throw new Error('Refusing to seed demo data into a production environment');
  }
  const password = options.password ?? DEFAULT_DEMO_PASSWORD;
  const rand = prng(20260927);
  await options.syncRoles();

  await wipeDemoAgency(prisma);
  const timezone = 'America/Chicago';
  await prisma.agency.create({
    data: {
      id: DEMO_AGENCY_ID,
      name: 'Demo Home Health (FAKE DATA)',
      phone: '555-010-0100',
      email: `office@${DEMO_EMAIL_DOMAIN}`,
      addressLine1: '100 Demo Plaza',
      city: 'Springfield',
      state: 'IL',
      zip: '62701',
      timezone,
    },
  });

  const roles = new Map(
    (await prisma.role.findMany({ where: { agencyId: null, isSystem: true } })).map((r) => [r.name, r.id]),
  );
  const passwordHash = await hash(password); // same fake password for every demo login
  const logins: SeedSummary['logins'] = [];

  const makeUser = async (role: string, email: string, firstName: string, lastName: string) => {
    const user = await prisma.user.create({
      data: {
        agencyId: DEMO_AGENCY_ID,
        email,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName,
        lastName,
        phone: `555-010-${String(rand.int(1000, 9999))}`,
        userRoles: { create: { roleId: roles.get(role)! } },
      },
    });
    return user.id;
  };

  for (const role of OFFICE_ROLES) {
    const email = `${role.replaceAll('_', '.')}@${DEMO_EMAIL_DOMAIN}`;
    await makeUser(role, email, rand.pick(FIRST), rand.pick(LAST));
    logins.push({ role, email });
  }

  // Field staff, each with a profile, credentials and weekday availability.
  const today = todayInTimeZone(timezone);
  const staff: { id: string; visitType: string }[] = [];
  let staffNo = 0;
  for (const plan of STAFF_PLAN) {
    for (let i = 0; i < plan.count; i++) {
      staffNo++;
      const first = rand.pick(FIRST);
      const last = rand.pick(LAST);
      const loginEmail = i === 0 ? `${plan.discipline.toLowerCase()}@${DEMO_EMAIL_DOMAIN}` : `${first}.${last}.${staffNo}@${DEMO_EMAIL_DOMAIN}`.toLowerCase();
      const userId = await makeUser(plan.role, loginEmail, first, last);
      if (i === 0) logins.push({ role: `${plan.role} (${plan.discipline})`, email: loginEmail });

      const profile = await prisma.staffProfile.create({
        data: {
          userId,
          agencyId: DEMO_AGENCY_ID,
          employeeId: `D${String(staffNo).padStart(4, '0')}`,
          discipline: plan.discipline,
          employmentType: rand.pick(['full_time', 'full_time', 'part_time', 'per_diem']),
          hireDate: toDate(addDays(today, -rand.int(60, 1500))),
          hourlyRate: plan.discipline === 'HHA' ? 18 + rand.int(0, 6) : 38 + rand.int(0, 20),
          mileageRate: 0.67,
          ssnEncrypted: options.encryptSsn?.(`9${String(rand.int(10_000_000, 99_999_999))}`, 'staff'),
          city: 'Springfield',
          state: 'IL',
          zip: rand.pick(['62701', '62702', '62703', '62704']),
          serviceAreaZipCodes: ['62701', '62702', '62703', '62704'],
          skills: plan.discipline === 'HHA' ? ['bathing', 'mobility assistance'] : ['wound care'],
          languages: rand.next() < 0.3 ? ['English', 'Spanish'] : ['English'],
        },
      });
      staff.push({ id: profile.id, visitType: plan.visitType });

      // Credentials: most valid, some expiring within the month, one already expired — so alerts have data.
      const cprExpiry = staffNo === 1 ? addDays(today, -5) : addDays(today, staffNo % 4 === 0 ? rand.int(3, 25) : rand.int(90, 700));
      await prisma.staffCredential.createMany({
        data: [
          {
            staffProfileId: profile.id,
            credentialType: 'license',
            credentialName: `${plan.discipline} license (FAKE)`,
            credentialNumber: `FAKE-${plan.discipline}-${staffNo}`,
            issuingAuthority: 'Demo State Board',
            issueDate: toDate(addDays(today, -800)),
            expiryDate: toDate(addDays(today, rand.int(120, 900))),
          },
          { staffProfileId: profile.id, credentialType: 'cpr', credentialName: 'CPR/BLS', expiryDate: toDate(cprExpiry) },
        ],
      });
      await prisma.staffAvailability.createMany({
        data: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
          staffProfileId: profile.id,
          dayOfWeek,
          startTime: toTime('08:00'),
          endTime: toTime('17:00'),
        })),
      });
    }
  }

  // Physicians with check-digit-valid (but invented) NPIs.
  const physicianIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const p = await prisma.physician.create({
      data: {
        agencyId: DEMO_AGENCY_ID,
        npi: makeNpi(199_000_000 + i * 1111),
        firstName: rand.pick(FIRST),
        lastName: rand.pick(LAST),
        practiceName: `${rand.pick(LAST)} Family Practice (FAKE)`,
        phone: `555-020-${1000 + i}`,
        fax: `555-021-${1000 + i}`,
        city: 'Springfield',
        state: 'IL',
      },
    });
    physicianIds.push(p.id);
  }

  // Patients with diagnoses and allergies.
  const patientIds: string[] = [];
  for (let i = 1; i <= 30; i++) {
    const [code, description] = rand.pick(DIAGNOSES);
    const patient = await prisma.patient.create({
      data: {
        agencyId: DEMO_AGENCY_ID,
        mrn: `DEMO-${String(i).padStart(4, '0')}`,
        firstName: rand.pick(FIRST),
        lastName: rand.pick(LAST),
        dateOfBirth: toDate(`19${rand.int(28, 60)}-${String(rand.int(1, 12)).padStart(2, '0')}-${String(rand.int(1, 28)).padStart(2, '0')}`)!,
        gender: rand.pick(['female', 'male', 'female', 'male', 'other']),
        ssnEncrypted: options.encryptSsn?.(`9${String(rand.int(10_000_000, 99_999_999))}`, 'patient'),
        phoneHome: `555-030-${String(1000 + i)}`,
        addressLine1: `${rand.int(10, 999)} ${rand.pick(STREETS)}`,
        city: 'Springfield',
        state: 'IL',
        zip: rand.pick(['62701', '62702', '62703', '62704']),
        emergencyContactName: `${rand.pick(FIRST)} ${rand.pick(LAST)}`,
        emergencyContactPhone: `555-040-${String(1000 + i)}`,
        emergencyContactRelation: rand.pick(['daughter', 'son', 'spouse', 'friend']),
        primaryPhysicianId: rand.pick(physicianIds),
        status: i <= 27 ? 'active' : 'discharged',
        admissionDate: toDate(addDays(today, -rand.int(5, 120))),
        dischargeDate: i <= 27 ? null : toDate(addDays(today, -2)),
        diagnoses: {
          create: [
            { icd10Code: code, description, isPrimary: true, sequenceOrder: 1 },
            ...(rand.next() < 0.5 ? [{ icd10Code: 'I10', description: 'Essential (primary) hypertension', sequenceOrder: 2 }] : []),
          ],
        },
        allergies: rand.next() < 0.4 ? { create: [{ allergen: rand.pick(ALLERGENS), reaction: 'Rash', severity: 'moderate' }] } : undefined,
      },
    });
    if (i <= 27) patientIds.push(patient.id);
  }

  // Two weeks of weekday visits. Each caregiver has fixed daily slots, so nobody is double-booked.
  const busy = new Set<string>();
  const freeSlot = (staffId: string, date: string) => SLOTS.find(([start]) => !busy.has(`${staffId}|${date}|${start}`));
  const visits: Prisma.VisitCreateManyInput[] = [];
  const weekdays = Array.from({ length: 14 }, (_, n) => addDays(today, n + 1)).filter((d) => {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return dow >= 1 && dow <= 5;
  });

  // A few recurring aide series (Mon/Wed/Fri) to show the recurring feature.
  const aides = staff.filter((s) => s.visitType === 'home_health_aide');
  let recurringCount = 0;
  for (const [n, patientId] of patientIds.slice(0, 4).entries()) {
    const aide = aides[n % aides.length]!;
    const [start, end] = SLOTS[n]!;
    const rule = await prisma.recurrenceRule.create({
      data: {
        agencyId: DEMO_AGENCY_ID,
        patientId,
        staffId: aide.id,
        visitType: 'home_health_aide',
        serviceCode: 'G0156',
        frequency: 'weekly',
        daysOfWeek: [1, 3, 5],
        startTime: toTime(start),
        endTime: toTime(end),
        startDate: toDate(addDays(today, 1))!,
      },
    });
    recurringCount++;
    for (const date of recurrenceDates({ frequency: 'weekly', daysOfWeek: [1, 3, 5], startDate: addDays(today, 1) }, today, addDays(today, 14))) {
      busy.add(`${aide.id}|${date}|${start}`);
      visits.push({
        agencyId: DEMO_AGENCY_ID,
        patientId,
        staffId: aide.id,
        visitType: 'home_health_aide',
        serviceCode: 'G0156',
        scheduledDate: toDate(date)!,
        scheduledStart: toTime(start),
        scheduledEnd: toTime(end),
        isRecurring: true,
        recurrenceRuleId: rule.id,
      });
    }
  }

  // One-off visits for the other patients, matched to a caregiver of the right discipline.
  for (const patientId of patientIds.slice(4)) {
    const visitType = rand.pick(['skilled_nursing', 'skilled_nursing', 'physical_therapy', 'home_health_aide', 'occupational_therapy', 'speech_therapy', 'medical_social_work']);
    const candidates = staff.filter((s) => s.visitType === visitType);
    for (let k = 0; k < rand.int(1, 3); k++) {
      const date = rand.pick(weekdays);
      const caregiver = rand.pick(candidates);
      const slot = freeSlot(caregiver.id, date);
      if (!slot) continue;
      busy.add(`${caregiver.id}|${date}|${slot[0]}`);
      visits.push({
        agencyId: DEMO_AGENCY_ID,
        patientId,
        staffId: caregiver.id,
        visitType,
        scheduledDate: toDate(date)!,
        scheduledStart: toTime(slot[0]),
        scheduledEnd: toTime(slot[1]),
        priority: rand.next() < 0.1 ? 'high' : 'normal',
      });
    }
  }

  // A few unassigned visits — future open shifts.
  for (const patientId of patientIds.slice(10, 13)) {
    visits.push({
      agencyId: DEMO_AGENCY_ID,
      patientId,
      staffId: null,
      visitType: 'home_health_aide',
      scheduledDate: toDate(rand.pick(weekdays))!,
      scheduledStart: toTime('10:00'),
      scheduledEnd: toTime('11:00'),
    });
  }
  await prisma.visit.createMany({ data: visits });

  return {
    agencyId: DEMO_AGENCY_ID,
    logins,
    password,
    counts: {
      users: await prisma.user.count({ where: { agencyId: DEMO_AGENCY_ID } }),
      staff: staff.length,
      physicians: physicianIds.length,
      patients: 30,
      visits: visits.length,
      recurringSeries: recurringCount,
    },
  };
}

/** Removes the demo agency and everything in it (children first, respecting foreign keys). */
export async function wipeDemoAgency(prisma: PrismaClient): Promise<void> {
  const where = { agencyId: DEMO_AGENCY_ID };
  await prisma.notification.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where });
  await prisma.visit.deleteMany({ where });
  await prisma.recurrenceRule.deleteMany({ where });
  await prisma.patient.deleteMany({ where }); // diagnoses, allergies cascade
  await prisma.physician.deleteMany({ where });
  await prisma.user.deleteMany({ where }); // staff profiles, credentials, availability, tokens, roles-links cascade
  await prisma.role.deleteMany({ where });
  await prisma.agency.deleteMany({ where: { id: DEMO_AGENCY_ID } });
}
