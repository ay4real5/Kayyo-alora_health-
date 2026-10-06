/** Referral pipeline (D-098): the stages a prospective client moves through, in order. */
export const REFERRAL_STATUSES = ['new', 'contacted', 'assessment', 'authorization_pending', 'ready', 'admitted', 'lost'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/** Stages that still need work (the board's columns). */
export const OPEN_REFERRAL_STATUSES: readonly ReferralStatus[] = ['new', 'contacted', 'assessment', 'authorization_pending', 'ready'];

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  assessment: 'Assessment',
  authorization_pending: 'Authorization pending',
  ready: 'Ready to start',
  admitted: 'Admitted',
  lost: 'Lost',
};

export const REFERRAL_SOURCE_TYPES = ['hospital', 'physician', 'social_worker', 'family', 'website', 'community', 'insurance', 'other'] as const;
export type ReferralSourceType = (typeof REFERRAL_SOURCE_TYPES)[number];

export const REFERRAL_PAYER_TYPES = ['medicaid', 'medicare', 'private_pay', 'insurance', 'va', 'unknown'] as const;
export type ReferralPayerType = (typeof REFERRAL_PAYER_TYPES)[number];

export const REFERRAL_PAYER_LABELS: Record<ReferralPayerType, string> = {
  medicaid: 'Medicaid',
  medicare: 'Medicare',
  private_pay: 'Private pay',
  insurance: 'Private insurance',
  va: 'VA',
  unknown: 'Not sure',
};
