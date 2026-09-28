import { describe, expect, it } from 'vitest';
import { billingUnits, evaluate, type ReadinessFacts } from './billing-readiness.js';

const ready: ReadinessFacts = {
  visitStatus: 'completed',
  serviceDate: '2026-09-01',
  minutes: 60,
  evvStatus: 'verified',
  hasFinalNote: true,
  serviceCode: { code: 'G0156', unitType: 'unit_15min', defaultRate: 7, requiresAuth: false },
  visitServiceCode: 'G0156',
  payer: {
    payerType: 'medicaid',
    requiresAuthorization: true,
    timelyFilingDays: 365,
    isActive: true,
  },
  memberIds: { medicaidId: 'VA123', medicareBeneficiaryId: null, insuranceMemberId: null },
  hasPrimaryDiagnosis: true,
  authorization: { state: 'active', coversDate: true, overLimit: false },
  payerRate: 7.5,
  agencyNpi: '1234567893',
  today: '2026-09-28',
};

const failing = (f: Partial<ReadinessFacts>) =>
  evaluate({ ...ready, ...f })
    .checks.filter((c) => !c.ok)
    .map((c) => `${c.code}:${c.severity}`);

describe('billingUnits', () => {
  it('rounds 15-minute units at 8 minutes, hours to the quarter', () => {
    expect(billingUnits('unit_15min', 7)).toBe(0);
    expect(billingUnits('unit_15min', 8)).toBe(1);
    expect(billingUnits('unit_15min', 60)).toBe(4);
    expect(billingUnits('unit_15min', 67)).toBe(4);
    expect(billingUnits('unit_15min', 68)).toBe(5);
    expect(billingUnits('hour', 95)).toBe(1.5);
    expect(billingUnits('visit', 200)).toBe(1);
  });
});

describe('evaluate', () => {
  it('passes a complete visit and prices it', () => {
    expect(evaluate(ready)).toMatchObject({ ready: true, units: 4, rate: 7.5, amount: 30 });
    expect(failing({})).toEqual([]);
  });

  it('explains each missing piece', () => {
    expect(failing({ visitStatus: 'in_progress' })).toEqual(['visit_completed:error']);
    expect(failing({ alreadyBilledOn: 'C123' })).toEqual(['not_billed:error']);
    expect(failing({ evvStatus: 'exception' })).toEqual(['evv_verified:error']);
    expect(failing({ hasFinalNote: false })).toEqual(['note_finalised:error']);
    expect(failing({ serviceCode: null })).toEqual(['service_code:error']);
    expect(
      failing({
        memberIds: { medicaidId: null, medicareBeneficiaryId: 'X', insuranceMemberId: null },
      }),
    ).toEqual(['member_id:error']);
    expect(failing({ hasPrimaryDiagnosis: false })).toEqual(['diagnosis:error']);
    expect(failing({ authorization: null })).toEqual(['authorization:error']);
    expect(
      failing({ authorization: { state: 'active', coversDate: true, overLimit: true } }),
    ).toEqual(['authorization:error']);
    expect(failing({ agencyNpi: null })).toEqual(['agency_npi:error']);
    expect(
      evaluate({ ...ready, evvStatus: 'rejected' }).checks.find((c) => c.code === 'evv_verified')
        ?.message,
    ).toMatch(/rejected/);
  });

  it('falls back to the default rate with a warning, and fails with no rate at all', () => {
    const fallback = evaluate({ ...ready, payerRate: null });
    expect(fallback).toMatchObject({ ready: true, rate: 7, amount: 28 });
    expect(
      fallback.checks.some((c) => c.severity === 'warning' && /default rate/.test(c.message)),
    ).toBe(true);
    expect(
      failing({ payerRate: null, serviceCode: { ...ready.serviceCode!, defaultRate: null } }),
    ).toEqual(['rate:error']);
  });

  it('warns 30 days before the filing limit and fails after it', () => {
    expect(failing({ payer: { ...ready.payer!, timelyFilingDays: 45 } })).toEqual([
      'timely_filing:warning',
    ]);
    expect(evaluate({ ...ready, payer: { ...ready.payer!, timelyFilingDays: 45 } }).ready).toBe(
      true,
    );
    expect(failing({ payer: { ...ready.payer!, timelyFilingDays: 20 } })).toEqual([
      'timely_filing:error',
    ]);
  });

  it("doesn't ask for an authorization the payer and code don't need", () => {
    expect(
      failing({ payer: { ...ready.payer!, requiresAuthorization: false }, authorization: null }),
    ).toEqual([]);
  });
});
