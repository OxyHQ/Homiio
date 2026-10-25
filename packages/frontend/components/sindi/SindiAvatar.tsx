/**
 * Sindi's face where Homiio offers her — the sidebar row, "Ask Sindi about this
 * home": her Oxy character, read from her Alia profile (`useAgentProfile`), as
 * the sheet itself draws her. Homiio keeps no picture of its own.
 *
 * Signed out there is no profile to read (it needs a session), and asking opens
 * Oxy's sign-in anyway; the row then shows a neutral assistant glyph.
 */

import type React from 'react';
import { AgentAvatar } from '@oxy.so/bloom/agent-avatar';
import { RiSparkling2Line } from '@oxy.so/bloom/icons/RiSparkling2Line';
import { readAgentCharacter } from '@alia.onl/sdk';
import { useAgentProfile } from '@alia.onl/sdk/runtime';

import { SINDI_AGENT_ID } from '@/components/sindi/sindiAgent';

export interface SindiAvatarProps {
  size: number;
  /** The glyph's colour while there is no character to draw. */
  color?: string;
}

export const SindiAvatar: React.FC<SindiAvatarProps> = ({ size, color }) => {
  const { data: profile } = useAgentProfile(SINDI_AGENT_ID);
  if (!profile) return <RiSparkling2Line width={size} height={size} fill={color} />;
  return (
    <AgentAvatar
      character={readAgentCharacter(profile.character)}
      size={size}
      label={profile.name}
      portrait
    />
  );
};
