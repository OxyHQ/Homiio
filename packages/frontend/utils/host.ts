/**
 * Host presentation helpers — derive a host's display name and "super host"
 * status from a `Profile`, shared by the booking card header (and reusable by
 * any future host surface).
 *
 * "Super host" is not a stored flag; we derive it from the signals the profile
 * model already carries, mirroring how Airbnb computes the badge from
 * verification + reputation:
 *  - personal: identity AND background verified, with a high trust score.
 *  - agency/business: business license AND background check verified, with a
 *    strong average rating over a meaningful number of ratings.
 * Cooperative profiles carry none of these signals, so they're never flagged.
 */
import type { Profile } from '@homiio/shared-types';

/** Trust score (0–100) at/above which a verified personal host is "super". */
const SUPER_HOST_TRUST_SCORE = 90;
/** Average rating (0–5) at/above which a verified org host is "super". */
const SUPER_HOST_MIN_RATING = 4.8;
/** Minimum number of ratings required before the org rating counts. */
const SUPER_HOST_MIN_RATING_COUNT = 10;

/**
 * Resolve a human-readable host name from a profile. Falls back through the
 * profile's org/legal name, then the Oxy user id, then a role-appropriate
 * generic label, so the header always has something to show.
 */
export function resolveHostName(profile: Profile | null | undefined): string {
  if (!profile) return 'Host';
  switch (profile.profileType) {
    case 'personal':
      return (
        profile.personalProfile?.personalInfo?.bio?.trim() ||
        profile.oxyUserId ||
        'Property owner'
      );
    case 'agency':
      return (
        profile.agencyProfile?.legalCompanyName ||
        profile.oxyUserId ||
        'Real estate agency'
      );
    case 'business':
      return (
        profile.businessProfile?.legalCompanyName ||
        profile.oxyUserId ||
        'Property management'
      );
    case 'cooperative':
      return (
        profile.cooperativeProfile?.legalName ||
        profile.oxyUserId ||
        'Housing cooperative'
      );
    default:
      return profile.oxyUserId || 'Property owner';
  }
}

/**
 * Whether a host qualifies for the "super host" badge, derived from the
 * profile's verification + reputation signals (see file header).
 */
export function isSuperHost(profile: Profile | null | undefined): boolean {
  if (!profile || !profile.isActive) return false;

  if (profile.profileType === 'personal') {
    const personal = profile.personalProfile;
    if (!personal) return false;
    const verified = personal.verification.identity && personal.verification.background;
    return verified && personal.trustScore.score >= SUPER_HOST_TRUST_SCORE;
  }

  if (profile.profileType === 'agency' || profile.profileType === 'business') {
    const org =
      profile.profileType === 'agency' ? profile.agencyProfile : profile.businessProfile;
    if (!org) return false;
    const verified =
      org.verification.businessLicense && org.verification.backgroundCheck;
    return (
      verified &&
      org.ratings.count >= SUPER_HOST_MIN_RATING_COUNT &&
      org.ratings.average >= SUPER_HOST_MIN_RATING
    );
  }

  return false;
}
