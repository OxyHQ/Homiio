import type { Profile } from '@homiio/shared-types';

export function resolveHostName(profile: Profile | null | undefined): string {
  if (!profile) return 'Host';
  return (
    profile.personalProfile?.personalInfo?.bio?.trim() ||
    profile.oxyUserId ||
    'Property owner'
  );
}

export function isSuperHost(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  const personal = profile.personalProfile;
  if (!personal) return false;
  return Boolean(personal.verification.identity && personal.verification.background);
}
