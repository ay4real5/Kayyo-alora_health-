'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-provider';
import { roleLabel } from '@/lib/labels';
import type { RoleOption } from '@/lib/types/people';

/**
 * Role checkboxes. Roles carrying permissions the current user lacks are shown but disabled — the API refuses to
 * grant them anyway (no privilege escalation, DECISIONS D-025).
 */
export function RolePicker({ selected, onChange }: { selected: string[]; onChange(ids: string[]): void }) {
  const { request, user } = useAuth();
  const roles = useQuery({ queryKey: ['roles'], queryFn: async () => (await request<RoleOption[]>('/roles')).data });
  const mine = new Set(user?.permissions ?? []);
  const isSuperAdmin = user?.roles.includes('super_admin') ?? false;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-slate-800">Roles</legend>
      {roles.data
        ?.filter((r) => r.name !== 'portal_user')
        .map((role) => {
          const grantable =
            role.permissions.every((p) => mine.has(p)) && (role.name !== 'super_admin' || isSuperAdmin);
          return (
            <label key={role.id} className={`flex items-start gap-2 text-sm ${grantable ? 'text-slate-800' : 'text-slate-400'}`}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selected.includes(role.id)}
                disabled={!grantable}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, role.id] : selected.filter((id) => id !== role.id))
                }
              />
              <span>
                {roleLabel(role.name)}
                {!grantable && <span className="ml-1 text-xs">(needs access you don&apos;t have)</span>}
                <span className="block text-xs text-slate-500">{role.permissions.length} permissions</span>
              </span>
            </label>
          );
        })}
    </fieldset>
  );
}
