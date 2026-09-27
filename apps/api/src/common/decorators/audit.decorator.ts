import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';
export const SKIP_AUDIT_KEY = 'skipAudit';

export interface AuditOptions {
  /** UPPER_SNAKE action, e.g. 'DISCHARGE_PATIENT'. Default: VIEW_/CREATE_/UPDATE_/DELETE_ + resource. */
  action?: string;
  /** e.g. 'patients'. Default: the resource of the route's first @Permissions entry. */
  resourceType?: string;
  /** Route param holding the record id. Default: 'id'. */
  idParam?: string;
}

/**
 * Customises the automatic audit entry for a route. Every authenticated route with @Permissions is
 * audited even without this decorator (DECISIONS D-023); use @Audit to name the action precisely, or to
 * audit a route that has no @Permissions.
 */
export const Audit = (options: AuditOptions = {}) => SetMetadata(AUDIT_KEY, options);

/** Opt a route out of automatic auditing. Only for routes that return no PHI (e.g. high-frequency polls). */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
