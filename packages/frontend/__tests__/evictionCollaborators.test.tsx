import type React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { EvictionCollaborators } from '@/components/evictions/EvictionCollaborators';
import { evictionService } from '@/services/evictionService';
import { confirm } from '@oxy.so/bloom/surfaces';

jest.mock('@oxy.so/services', () => ({
  useOxy: () => ({
    oxyServices: {
      users: {
        byUsername: jest.fn(async (username: string) => ({ id: 'resolved-target', username })),
      },
    },
  }),
}));
jest.mock('@/hooks/useOxyAvatars', () => ({ useOxyAvatars: () => ({ usersById: new Map() }) }));
jest.mock('@/services/evictionService', () => ({
  evictionService: {
    addCollaborator: jest.fn(),
    removeCollaborator: jest.fn(),
    getExactLocation: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('react-i18next', () => {
  const en = require('@/locales/en.json');
  return {
    useTranslation: () => ({
      t: (key: string, args?: { account: string }) =>
        key.startsWith('evictions.team.')
          ? (
              en.evictions.team[
                key.replace('evictions.team.', '') as keyof typeof en.evictions.team
              ] ?? key
            ).replace('{{account}}', args?.account ?? '')
          : key,
    }),
  };
});
jest.mock('@oxy.so/bloom/surfaces', () => ({ confirm: jest.fn() }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@oxy.so/bloom/button', () => {
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ children, ...props }: { children: React.ReactNode }) => (
      <Pressable {...props}>
        <Text>{children}</Text>
      </Pressable>
    ),
  };
});
jest.mock('@oxy.so/bloom/card', () => ({ Card: require('react-native').View }));
jest.mock('@oxy.so/bloom/typography', () => ({
  H3: require('react-native').Text,
  Text: require('react-native').Text,
}));
jest.mock('@oxy.so/bloom/textarea', () => {
  const { TextInput } = require('react-native');
  return {
    Textarea: ({ label, ...props }: { label: string }) => (
      <TextInput accessibilityLabel={label} {...props} />
    ),
  };
});
const team = {
  isOwner: true,
  canEdit: true,
  collaborators: [{ oxyUserId: 'editor', addedAt: '2026-01-01' }],
};
beforeEach(() => jest.clearAllMocks());

it('does not add before the warning is confirmed, and cancellation never grants access', async () => {
  let resolve!: (answer: boolean) => void;
  jest.mocked(confirm).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const screen = render(<EvictionCollaborators caseId="case" team={team} onChanged={jest.fn()} />);
  fireEvent.changeText(screen.getByLabelText('Oxy username'), 'target');
  fireEvent.press(screen.getByText('Add collaborator'));
  await waitFor(() =>
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          '@target will be able to edit this case, publish updates and read the exact address',
        ),
      }),
    ),
  );
  expect(evictionService.addCollaborator).not.toHaveBeenCalled();
  resolve(false);
  await waitFor(() => expect(evictionService.addCollaborator).not.toHaveBeenCalled());
});

it('adds only after explicit confirmation and refreshes membership', async () => {
  jest.mocked(confirm).mockResolvedValue(true);
  jest.mocked(evictionService.addCollaborator).mockResolvedValue();
  const changed = jest.fn();
  const screen = render(<EvictionCollaborators caseId="case" team={team} onChanged={changed} />);
  fireEvent.changeText(screen.getByLabelText('Oxy username'), 'target');
  fireEvent.press(screen.getByText('Add collaborator'));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(evictionService.addCollaborator).toHaveBeenCalledWith('case', 'resolved-target');
});

it('collaborators have no membership controls', () => {
  const screen = render(
    <EvictionCollaborators
      caseId="case"
      team={{ ...team, isOwner: false }}
      onChanged={jest.fn()}
    />,
  );
  expect(screen.queryByText('Add collaborator')).toBeNull();
  expect(screen.queryByText('Remove collaborator')).toBeNull();
  expect(screen.getByText('Read exact location')).toBeTruthy();
});

it('does not redisplay a previous exact location after a fresh access denial', async () => {
  jest
    .mocked(evictionService.getExactLocation)
    .mockResolvedValueOnce({
      exactAddress: 'Private address',
      accessPolicy: { householdAuthorizedExact: true, maxGrantHours: 72 },
    })
    .mockRejectedValueOnce(new Error('Revoked'));
  const screen = render(<EvictionCollaborators caseId="case" team={team} onChanged={jest.fn()} />);
  fireEvent.press(screen.getByText('Read exact location'));
  await waitFor(() => expect(screen.getByDisplayValue('Private address')).toBeTruthy());
  fireEvent.press(screen.getByText('Read exact location'));
  await waitFor(() => expect(screen.queryByDisplayValue('Private address')).toBeNull());
});
