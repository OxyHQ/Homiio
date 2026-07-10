/**
 * Host presentation helpers — derive display name and "super host" from sidecar RE data.
 */
import type { Profile } from '@homiio/shared-types';
import { inferSidecarKind } from '@/utils/sidecarProfile';

const SUPER_HOST_MIN_RATING = 4.8;
const SUPER_HOST_MIN_RATING_COUNT = 10;

export function resolveHostName(profile: Profile | null | undefined): string {
  if (!profile) return 'Host';
  switch (inferSidecarKind(profile)) {
    case 'personal':
      return profile.personalProfile?.personalInfo?.bio?.trim() || profile.oxyUserId || 'Property owner';
    case 'agency':
      return profile.agencyProfile?.legalCompanyName || profile.oxyUserId || 'Real estate agency';
    case 'business':
      return profile.businessProfile?.legalCompanyName || profile.oxyUserId || 'Property management';
    case 'cooperative':
      return profile.cooperativeProfile?.legalName || profile.oxyUserId || 'Housing cooperative';
    default:
      return profile.oxyUserId || 'Property owner';
  }
}

export function isSuperHost(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  const kind = inferSidecarKind(profile);

  if (kind === 'personal') {
    const personal = profile.personalProfile;
    if (!personal) return false;
    return Boolean(personal.verification.identity && personal.verification.background);
  }

  if (kind === 'agency' || kind === 'business') {
    const org = kind === 'agency' ? profile.agencyProfile : profile.businessProfile;
    if (!org) return false;
    const verified = org.verification.businessLicense && org.verification.backgroundCheck;
    return (
      verified &&
      org.ratings.count >= SUPER_HOST_MIN_RATING_COUNT &&
      org.ratings.average >= SUPER_HOST_MIN_RATING
    );
  }

  return false;
}
