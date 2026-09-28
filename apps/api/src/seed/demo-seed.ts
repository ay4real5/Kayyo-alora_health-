import { randomUUID } from 'node:crypto';
import {
  isValidNpi,
  MANDATORY_TWO_FACTOR_ROLES,
  recurrenceDates,
  todayInTimeZone,
  zonedTimeToUtc,
  type Discipline,
  type Role,
} from '@alora/shared';
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
  /**
   * Encrypts a base32 TOTP secret the way users.two_fa_secret stores it. When provided, demo admins get 2FA already
   * on with DEMO_TOTP_SECRET (admins must use 2FA, D-045); otherwise they set it up at first sign-in.
   */
  encryptTwoFaSecret?: (base32Secret: string) => string;
  /** Encrypts a message's text (PhiCryptoService.encryptBytes with messageContentContext). No messages without it. */
  encryptMessage?: (text: string, messageId: string) => Uint8Array<ArrayBuffer>;
  /** Makes sure built-in roles exist (RbacSyncService.sync). */
  syncRoles: () => Promise<void>;
}

/**
 * The demo admins' authenticator secret (FAKE data, development only — the seed refuses to run in production).
 * Add it to an authenticator app as "Alora demo", or compute codes from it in tests.
 */
export const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

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
const AIDE_TASKS = ['Assist with bathing', 'Prepare a meal', 'Medication reminder', 'Light housekeeping', 'Walk / range of motion'];

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
      npi: makeNpi(188_888_888),
      taxId: '99-0000001',
      phone: '555-010-0100',
      email: `office@${DEMO_EMAIL_DOMAIN}`,
      addressLine1: '100 Demo Plaza',
      city: 'Springfield',
      state: 'IL',
      zip: '62701-1234',
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
        ...(MANDATORY_TWO_FACTOR_ROLES.includes(role as Role) && options.encryptTwoFaSecret
          ? { is2faEnabled: true, twoFaSecret: options.encryptTwoFaSecret(DEMO_TOTP_SECRET) }
          : {}),
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
        medicaidId: `DEMO${String(i).padStart(8, '0')}`,
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
        // Homes scattered within ~8 km of central Springfield, IL (fake).
        latitude: 39.7817 + (rand.next() - 0.5) * 0.14,
        longitude: -89.6501 + (rand.next() - 0.5) * 0.18,
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
  const authorizations = await seedBilling(prisma, {
    today,
    patientIds,
    recurringPatientIds: patientIds.slice(0, 4),
    evvPatientIds: patientIds.slice(14, 20),
  });

  // A typical aide checklist on every assigned aide visit (P2-04), so the caregiver app has something to tick off.
  const aideVisits = await prisma.visit.findMany({
    where: { agencyId: DEMO_AGENCY_ID, visitType: 'home_health_aide', staffId: { not: null } },
    select: { id: true },
  });
  await prisma.visitTask.createMany({
    data: aideVisits.flatMap(({ id }) =>
      AIDE_TASKS.map((taskName, sortOrder) => ({ visitId: id, taskName, sortOrder })),
    ),
  });

  const evvRecords = await seedEvvHistory(prisma, {
    today,
    timezone,
    aideIds: aides.map((a) => a.id),
    patientIds: patientIds.slice(14, 20),
  });

  const messages = options.encryptMessage ? await seedMessages(prisma, options.encryptMessage, patientIds[0]!) : 0;

  // A family member with portal access to the first patient (P3-14/P3-16), and something for them to see.
  const familyEmail = `family@${DEMO_EMAIL_DOMAIN}`;
  const familyId = await makeUser('portal_user', familyEmail, 'Fran', 'Family');
  logins.push({ role: 'portal_user (family of DEMO-0001)', email: familyEmail });
  await seedPortalFamily(prisma, { patientId: patientIds[0]!, familyId, physicianId: physicianIds[0]!, today, encrypt: options.encryptMessage });

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
      evvRecords,
      authorizations,
      messages,
    },
  };
}

/**
 * Two demo conversations (P3-13): office ↔ RN about covering a visit, and a care-team group about the first patient.
 * Unread for the people who didn't write the last message, so the Messages badge shows something.
 */
async function seedMessages(
  prisma: PrismaClient,
  encrypt: (text: string, messageId: string) => Uint8Array<ArrayBuffer>,
  patientId: string,
): Promise<number> {
  const byEmail = async (local: string) =>
    (await prisma.user.findFirstOrThrow({ where: { agencyId: DEMO_AGENCY_ID, email: `${local}@${DEMO_EMAIL_DOMAIN}` } })).id;
  const [office, supervisor, rn, hha] = await Promise.all(['office.staff', 'supervisor', 'rn', 'hha'].map(byEmail));
  const threads: { subject?: string; patientId?: string; people: string[]; lines: [string, string][] }[] = [
    {
      people: [office!, rn!],
      lines: [
        [office!, 'Can you take the Tuesday 9:00 skilled nursing visit for the new admission?'],
        [rn!, 'Yes, please add it to my schedule.'],
      ],
    },
    {
      subject: 'Care team',
      patientId,
      people: [supervisor!, rn!, hha!, office!],
      lines: [
        [supervisor!, 'Care team thread for this patient. Please post changes in condition here.'],
        [hha!, 'Client was a little tired today but ate a full lunch.'],
        [rn!, 'Thanks, I will check vitals at my visit on Thursday.'],
      ],
    },
  ];
  let count = 0;
  const start = Date.now() - 3 * 3_600_000;
  for (const [t, thread] of threads.entries()) {
    const conversation = await prisma.conversation.create({
      data: {
        agencyId: DEMO_AGENCY_ID,
        type: thread.people.length === 2 ? 'direct' : 'group',
        subject: thread.subject ?? null,
        patientId: thread.patientId ?? null,
        createdById: thread.lines[0]![0],
        participants: { create: thread.people.map((userId) => ({ userId })) },
      },
    });
    let at = new Date();
    for (const [i, [senderId, text]] of thread.lines.entries()) {
      at = new Date(start + (t * 60 + i * 20) * 60_000);
      const id = randomUUID();
      await prisma.message.create({
        data: { id, agencyId: DEMO_AGENCY_ID, conversationId: conversation.id, senderId, contentEncrypted: encrypt(text, id), createdAt: at },
      });
      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: conversation.id, userId: senderId } },
        data: { lastReadAt: at },
      });
      count++;
    }
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: at } });
  }
  return count;
}

/**
 * EVV history for the review and monitor screens (P2-03): two past days of aide visits — verified two days ago,
 * completed yesterday, with two flagged ones (clocked in ~1.2 km away; a 10-minute visit) — and, during the day,
 * one visit in progress right now. Coordinates are the fake patients' homes.
 */
async function seedEvvHistory(
  prisma: PrismaClient,
  opts: { today: string; timezone: string; aideIds: string[]; patientIds: string[] },
): Promise<number> {
  const patients = await prisma.patient.findMany({
    where: { id: { in: opts.patientIds } },
    select: { id: true, latitude: true, longitude: true },
  });
  const at = (date: string, time: string, plusMinutes = 0) =>
    new Date(zonedTimeToUtc(date, time, opts.timezone).getTime() + plusMinutes * 60_000);
  let created = 0;

  const record = async (p: {
    date: string;
    start: string;
    end: string;
    staffId: string;
    patient: (typeof patients)[number];
    clockIn: Date;
    clockOut: Date | null;
    offsetLat?: number;
    flags?: string[];
    status: string;
  }) => {
    const home = { lat: Number(p.patient.latitude), lng: Number(p.patient.longitude) };
    const lat = home.lat + (p.offsetLat ?? 0.0001);
    const distance = Math.round(Math.abs(lat - home.lat) * 111_195);
    const authorization = await prisma.authorization.findFirst({
      where: { patientId: p.patient.id, serviceCode: 'G0156', status: 'active' },
      select: { id: true },
    });
    const visit = await prisma.visit.create({
      data: {
        agencyId: DEMO_AGENCY_ID,
        patientId: p.patient.id,
        staffId: p.staffId,
        authorizationId: authorization?.id ?? null,
        visitType: 'home_health_aide',
        serviceCode: 'G0156',
        status: p.clockOut ? 'completed' : 'in_progress',
        scheduledDate: toDate(p.date)!,
        scheduledStart: toTime(p.start),
        scheduledEnd: toTime(p.end),
        actualStart: p.clockIn,
        actualEnd: p.clockOut,
      },
    });
    await prisma.evvRecord.create({
      data: {
        visitId: visit.id,
        agencyId: DEMO_AGENCY_ID,
        staffId: p.staffId,
        patientId: p.patient.id,
        serviceType: 'home_health_aide',
        serviceDate: toDate(p.date)!,
        clockInTime: p.clockIn,
        clockOutTime: p.clockOut,
        clockInMethod: 'gps',
        clockOutMethod: p.clockOut ? 'gps' : null,
        clockInLatitude: lat,
        clockInLongitude: home.lng,
        clockOutLatitude: p.clockOut ? home.lat + 0.0001 : null,
        clockOutLongitude: p.clockOut ? home.lng : null,
        clockInAccuracyMeters: 8,
        clockInWithinGeofence: distance <= 200,
        clockInDistanceMeters: distance,
        clockOutWithinGeofence: p.clockOut ? true : null,
        clockOutDistanceMeters: p.clockOut ? 11 : null,
        flags: p.flags ?? [],
        status: p.status,
        deviceId: 'demo-device',
      },
    });
    if (p.clockOut) {
      const author = await prisma.staffProfile.findUniqueOrThrow({ where: { id: p.staffId }, select: { userId: true } });
      await prisma.visitNote.create({
        data: {
          visitId: visit.id,
          staffId: p.staffId,
          authorId: author.userId,
          noteType: 'aide_activity',
          narrative: 'Assisted with bathing and lunch; patient in good spirits. (demo)',
          status: 'submitted',
          submittedAt: p.clockOut,
        },
      });
    }
    created++;
  };

  for (const [dayBack, status] of [[2, 'verified'], [1, 'completed']] as const) {
    const date = addDays(opts.today, -dayBack);
    for (const [n, patient] of patients.entries()) {
      const [start, end] = SLOTS[n % SLOTS.length]!;
      const flagged = dayBack === 1 && n < 2;
      const short = flagged && n === 1;
      await record({
        date,
        start,
        end,
        staffId: opts.aideIds[n % opts.aideIds.length]!,
        patient,
        clockIn: at(date, start, 3),
        clockOut: short ? at(date, start, 13) : at(date, end, -2),
        offsetLat: flagged && n === 0 ? 0.011 : undefined,
        flags: flagged ? [n === 0 ? 'outside_geofence_in' : 'very_short_visit'] : [],
        status: flagged ? 'exception' : status,
      });
    }
  }

  // One visit in progress now, if it's daytime in the agency (the monitor's map needs someone on it).
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: opts.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()),
  );
  if (hour >= 6 && hour <= 20 && patients[0]) {
    // Started in the previous hour, so the clock-in is always in the past.
    const start = `${String(hour - 1).padStart(2, '0')}:00`;
    const end = `${String(hour + 1).padStart(2, '0')}:00`;
    await record({
      date: opts.today,
      start,
      end,
      staffId: opts.aideIds[opts.aideIds.length - 1]!,
      patient: patients[0],
      clockIn: at(opts.today, start, 2),
      clockOut: null,
      status: 'in_progress',
    });
  }
  return created;
}

/**
 * Billing setup for the demo (P3-01, D-050): fake payers (Medicaid requires authorizations), Virginia-style service
 * codes with rates, every active patient on the demo Medicaid plan, and authorizations for the recurring aide series
 * (their visits linked) plus one expiring soon.
 */
async function seedBilling(
  prisma: PrismaClient,
  opts: { today: string; patientIds: string[]; recurringPatientIds: string[]; evvPatientIds: string[] },
): Promise<number> {
  const medicaid = await prisma.payer.create({
    data: {
      agencyId: DEMO_AGENCY_ID,
      name: 'Demo Medicaid (FAKE)',
      payerType: 'medicaid',
      payerIdCode: 'DEMOMCD',
      ediSubmitterId: 'DEMOSUB01',
      ediReceiverId: 'DEMOCLEAR',
      state: 'VA',
      requiresAuthorization: true,
    },
  });
  const medicare = await prisma.payer.create({
    data: { agencyId: DEMO_AGENCY_ID, name: 'Demo Medicare (FAKE)', payerType: 'medicare', payerIdCode: 'DEMOMCR' },
  });
  const privatePay = await prisma.payer.create({ data: { agencyId: DEMO_AGENCY_ID, name: 'Private pay', payerType: 'private_pay' } });

  const codes = [
    { code: 'G0156', description: 'Home health aide, each 15 minutes', unitType: 'unit_15min', rate: 7.5, revenueCode: '0571' },
    { code: 'G0299', description: 'Skilled nursing (RN), each 15 minutes', unitType: 'unit_15min', rate: 42, revenueCode: '0551' },
    { code: 'G0151', description: 'Physical therapy, each 15 minutes', unitType: 'unit_15min', rate: 45, revenueCode: '0421' },
    { code: 'T1019', description: 'Personal care services, each 15 minutes', unitType: 'unit_15min', rate: 5.25, revenueCode: null },
  ];
  const yearStart = `${opts.today.slice(0, 4)}-01-01`;
  for (const c of codes) {
    const code = await prisma.serviceCode.create({
      data: { agencyId: DEMO_AGENCY_ID, code: c.code, codeType: 'hcpcs', description: c.description, unitType: c.unitType, defaultRate: c.rate, revenueCode: c.revenueCode },
    });
    for (const [payer, factor] of [[medicaid, 1], [medicare, 1.2], [privatePay, 1.4]] as const) {
      await prisma.payerRate.create({
        data: { payerId: payer.id, serviceCodeId: code.id, rate: Math.round(c.rate * factor * 100) / 100, effectiveDate: toDate(yearStart)! },
      });
    }
  }

  await prisma.patient.updateMany({ where: { id: { in: opts.patientIds } }, data: { payerPrimaryId: medicaid.id } });
  // The last EVV-history patient pays privately, so their verified visits go on an invoice, not a claim (P3-10).
  const privatePatient = opts.evvPatientIds[opts.evvPatientIds.length - 1];
  if (privatePatient) await prisma.patient.update({ where: { id: privatePatient }, data: { payerPrimaryId: privatePay.id } });

  let created = 0;
  for (const [n, patientId] of opts.recurringPatientIds.entries()) {
    const start = addDays(opts.today, -30);
    const end = addDays(opts.today, 60);
    const auth = await prisma.authorization.create({
      data: {
        patientId,
        payerId: medicaid.id,
        authorizationNumber: `DEMO-AUTH-${1000 + n}`,
        serviceCode: 'G0156',
        startDate: toDate(start)!,
        endDate: toDate(end)!,
        authorizedVisits: 40,
      },
    });
    await prisma.visit.updateMany({
      where: { patientId, serviceCode: 'G0156', scheduledDate: { gte: toDate(start), lte: toDate(end) } },
      data: { authorizationId: auth.id },
    });
    created++;
  }
  // The EVV-history patients (seedEvvHistory links their visits) — so some past visits are ready to bill.
  for (const [n, patientId] of opts.evvPatientIds.entries()) {
    if (patientId === privatePatient) continue; // private pay: no payer authorization
    await prisma.authorization.create({
      data: {
        patientId,
        payerId: medicaid.id,
        authorizationNumber: `DEMO-AUTH-${3000 + n}`,
        serviceCode: 'G0156',
        startDate: toDate(addDays(opts.today, -14))!,
        endDate: toDate(addDays(opts.today, 45))!,
        authorizedVisits: 30,
      },
    });
    created++;
  }
  const soon = opts.patientIds[4];
  if (soon) {
    await prisma.authorization.create({
      data: {
        patientId: soon,
        payerId: medicaid.id,
        authorizationNumber: 'DEMO-AUTH-2000',
        serviceCode: 'G0299',
        startDate: toDate(addDays(opts.today, -80))!,
        endDate: toDate(addDays(opts.today, 10))!,
        authorizedHours: 24,
        notes: 'Renewal requested (demo)',
      },
    });
    created++;
  }
  return created;
}

/** Removes the demo agency and everything in it (children first, respecting foreign keys). */
export async function wipeDemoAgency(prisma: PrismaClient): Promise<void> {
  const where = { agencyId: DEMO_AGENCY_ID };
  await prisma.notification.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where });
  await prisma.payment.deleteMany({ where }); // details cascade
  await prisma.ediFile.deleteMany({ where });
  await prisma.invoice.deleteMany({ where }); // lines, payments cascade
  await prisma.claim.deleteMany({ where }); // lines cascade
  await prisma.evvRecord.deleteMany({ where }); // EVV exceptions cascade
  await prisma.conversation.deleteMany({ where }); // participants and messages cascade
  await prisma.document.deleteMany({ where }); // stored files cascade; version links are cleared
  await prisma.visit.deleteMany({ where }); // notes, vitals, tasks cascade
  await prisma.recurrenceRule.deleteMany({ where });
  await prisma.patient.deleteMany({ where }); // diagnoses, allergies, authorizations cascade
  await prisma.payer.deleteMany({ where }); // rates cascade
  await prisma.serviceCode.deleteMany({ where });
  await prisma.physician.deleteMany({ where });
  await prisma.user.deleteMany({ where }); // staff profiles, credentials, availability, tokens, roles-links cascade
  await prisma.role.deleteMany({ where });
  await prisma.agency.deleteMany({ where: { id: DEMO_AGENCY_ID } });
}

/** Portal demo content for the first patient: link the family login, an active plan of care, two medications, and
 * (with encryption) a short thread with the office. */
async function seedPortalFamily(
  prisma: PrismaClient,
  demo: {
    patientId: string;
    familyId: string;
    physicianId: string;
    today: string;
    encrypt?: (text: string, messageId: string) => Uint8Array<ArrayBuffer>;
  },
): Promise<void> {
  const { patientId, familyId } = demo;
  await prisma.patient.update({ where: { id: patientId }, data: { portalUserId: familyId } });
  await prisma.carePlan.create({
    data: {
      patientId,
      physicianId: demo.physicianId,
      status: 'active',
      certificationPeriodStart: toDate(addDays(demo.today, -10))!,
      certificationPeriodEnd: toDate(addDays(demo.today, 49))!,
      physicianSignatureDate: toDate(addDays(demo.today, -8))!,
      goals: ['Walk safely inside the home with a walker', 'Take medications as prescribed'],
      interventions: [
        { discipline: 'HHA', description: 'Help with bathing and dressing' },
        { discipline: 'RN', description: 'Check blood pressure and review medications' },
      ],
      visitFrequency: [
        { discipline: 'HHA', frequency: '3W8' },
        { discipline: 'RN', frequency: '1W8' },
      ],
      disciplinesRequired: ['HHA', 'RN'],
    },
  });
  await prisma.medication.createMany({
    data: [
      { patientId, drugName: 'Lisinopril', dosage: '10 mg', route: 'by mouth', frequency: 'once daily', isActive: true },
      { patientId, drugName: 'Metformin', dosage: '500 mg', route: 'by mouth', frequency: 'twice daily with meals', isActive: true },
    ],
  });
  if (!demo.encrypt) return;
  const office = await prisma.user.findFirstOrThrow({ where: { agencyId: DEMO_AGENCY_ID, email: `office.staff@${DEMO_EMAIL_DOMAIN}` } });
  const supervisor = await prisma.user.findFirstOrThrow({ where: { agencyId: DEMO_AGENCY_ID, email: `supervisor@${DEMO_EMAIL_DOMAIN}` } });
  const conversation = await prisma.conversation.create({
    data: {
      agencyId: DEMO_AGENCY_ID,
      type: 'portal',
      patientId,
      createdById: familyId,
      participants: { create: [{ userId: familyId }, { userId: office.id }, { userId: supervisor.id }] },
    },
  });
  const lines: [string, string][] = [
    [familyId, 'Could the aide come a little later on Fridays? Mom has a standing appointment until 9:30.'],
    [office.id, 'Of course. We will move Friday visits to 10:00 starting next week.'],
  ];
  let at = new Date(Date.now() - 26 * 3_600_000);
  for (const [senderId, text] of lines) {
    at = new Date(at.getTime() + 45 * 60_000);
    const id = randomUUID();
    await prisma.message.create({
      data: { id, agencyId: DEMO_AGENCY_ID, conversationId: conversation.id, senderId, contentEncrypted: demo.encrypt(text, id), createdAt: at },
    });
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: conversation.id, userId: senderId } },
      data: { lastReadAt: at },
    });
  }
  await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: at } });
}
