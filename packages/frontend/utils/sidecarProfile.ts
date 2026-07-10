/** Infer sidecar RE section for UI — not a persisted profileType. */
import type { Profile } from '@homiio/shared-types';

export type SidecarKind = 'personal' | 'agency' | 'business' | 'cooperative';

export function inferSidecarKind(profile: Profile | null | undefined): SidecarKind {
  if (!profile) return 'personal';
  if (profile.agencyProfile?.businessType) return 'agency';
  if (profile.businessProfile?.businessType) return 'business';
  if (profile.cooperativeProfile?.legalName) return 'cooperative';
  return 'personal';
}

export function sidecarDisplayTitle(profile: Profile | null | undefined): string {
  const kind = inferSidecarKind(profile);
  switch (kind) {
    case 'agency':
      return profile?.agencyProfile?.legalCompanyName || 'Agency';
    case 'business':
      return profile?.businessProfile?.legalCompanyName || 'Business';
    case 'cooperative':
      return profile?.cooperativeProfile?.legalName || 'Cooperative';
    default:
      return 'Personal';
  }
}
