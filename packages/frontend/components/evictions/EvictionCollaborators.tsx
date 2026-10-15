import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOxy } from '@oxy.so/services';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Textarea } from '@oxy.so/bloom/textarea';
import { H3, Text } from '@oxy.so/bloom/typography';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import type { EvictionCaseTeam, EvictionLocationPrivate } from '@homiio/shared-types';
import { evictionService } from '@/services/evictionService';
import { spacing } from '@/constants/styles';

export function EvictionCollaborators({
  caseId,
  team,
  onChanged,
}: {
  caseId: string;
  team: EvictionCaseTeam;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { oxyServices } = useOxy();
  const { usersById } = useOxyAvatars(team.collaborators.map((member) => member.oxyUserId));
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  // Private data lives only in this mounted panel, never in a persisted query cache.
  const [location, setLocation] = useState<EvictionLocationPrivate | null>(null);
  const [exactAddress, setExactAddress] = useState('');

  const add = async () => {
    const target = account.trim();
    if (!target || busy) return;
    setBusy(true);
    try {
      const selected = await oxyServices.users.byUsername(target.replace(/^@/, ''), {
        cache: false,
      });
      const accepted = await confirm({
        title: t('evictions.team.addTitle'),
        description: t('evictions.team.warning', { account: `@${selected.username}` }),
        confirmLabel: t('evictions.team.add'),
        cancelLabel: t('common.cancel'),
      });
      if (!accepted) return;
      await evictionService.addCollaborator(caseId, selected.id);
      setAccount('');
      onChanged();
    } catch {
      toast.error(t('evictions.team.failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (oxyUserId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await evictionService.removeCollaborator(caseId, oxyUserId);
      onChanged();
    } catch {
      toast.error(t('evictions.team.failed'));
    } finally {
      setBusy(false);
    }
  };

  const readLocation = async () => {
    setLocation(null);
    setExactAddress('');
    setBusy(true);
    try {
      const current = await evictionService.getExactLocation(caseId);
      setLocation(current);
      setExactAddress(current.exactAddress ?? '');
    } catch {
      toast.error(t('evictions.team.locationDenied'));
    } finally {
      setBusy(false);
    }
  };

  const saveAddress = async () => {
    setBusy(true);
    try {
      await evictionService.update(caseId, { exactAddress });
      setLocation(null);
      setExactAddress('');
    } catch {
      setLocation(null);
      setExactAddress('');
      toast.error(t('evictions.team.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card appearance="outline" radius="radius-16" style={{ padding: spacing.lg, gap: spacing.md }}>
      <H3>{t('evictions.team.title')}</H3>
      <Text>{t('evictions.team.personal')}</Text>
      {team.collaborators.map((member) => (
        <View key={member.oxyUserId} style={{ gap: spacing.sm }}>
          <Text>
            {usersById.get(member.oxyUserId)?.username
              ? `@${usersById.get(member.oxyUserId)?.username}`
              : member.oxyUserId}
          </Text>
          {team.isOwner ? (
            <Button
              disabled={busy}
              onPress={() => {
                void remove(member.oxyUserId);
              }}
              tone="danger"
              appearance="outline"
            >
              {t('evictions.team.remove')}
            </Button>
          ) : null}
        </View>
      ))}
      {team.isOwner ? (
        <>
          <Textarea
            label={t('evictions.team.account')}
            value={account}
            onChangeText={setAccount}
            rows={1}
          />
          <Button
            disabled={busy || !account.trim()}
            onPress={() => {
              void add();
            }}
          >
            {t('evictions.team.add')}
          </Button>
        </>
      ) : null}
      <Button
        disabled={busy}
        onPress={() => {
          void readLocation();
        }}
        appearance="outline"
      >
        {t('evictions.team.location')}
      </Button>
      {location ? (
        <>
          <Textarea
            label={t('evictions.team.exactAddress')}
            value={exactAddress}
            onChangeText={setExactAddress}
            rows={2}
          />
          {location.exactCoordinates ? <Text>{location.exactCoordinates.join(', ')}</Text> : null}
          <Button
            disabled={busy}
            onPress={() => {
              void saveAddress();
            }}
          >
            {t('evictions.team.saveAddress')}
          </Button>
          <Button
            onPress={() => {
              setLocation(null);
              setExactAddress('');
            }}
            appearance="outline"
          >
            {t('evictions.team.hide')}
          </Button>
        </>
      ) : null}
    </Card>
  );
}
