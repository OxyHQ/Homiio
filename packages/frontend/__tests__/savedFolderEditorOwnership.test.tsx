import { fireEvent, render, screen } from '@testing-library/react-native';
import EditFolderScreen from '@/app/(pages)/(tabs)/saved/[folderId]/edit';

const mockOwner = { userId: 'A', sessionId: 'session-A', epoch: 1, oxyServices: {} };
let mockFolderName = 'A folder';
jest.mock('@/hooks/useAccountOwner', () => ({
  accountOwnerKey: (owner: typeof mockOwner) => [owner.userId, owner.sessionId, owner.epoch],
  useAccountOwner: () => mockOwner,
  useAccountOwnerGuard: () => ({ owner: mockOwner, isCurrent: () => true }),
}));
jest.mock('@/hooks/useSavedQueries', () => ({
  useSavedFoldersQuery: () => ({ data: { folders: [{ id: 'shared-id', name: mockFolderName }] } }),
}));
jest.mock('@/context/SavedPropertiesContext', () => ({
  useSavedPropertiesContext: () => ({
    deleteFolder: jest.fn(),
    updateFolder: jest.fn(),
    loadSavedProperties: jest.fn(),
  }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ folderId: 'shared-id' }),
  router: { canGoBack: () => false },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@oxy.so/bloom/app-shell', () => ({ AppShellMenuButton: () => null }));
jest.mock('@oxy.so/bloom/button', () => ({ Button: () => null }));
jest.mock('@oxy.so/bloom/field', () => ({
  Field: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@oxy.so/bloom/icons/RiDeleteBinLine', () => ({ RiDeleteBinLine: () => null }), {
  virtual: true,
});
jest.mock('@oxy.so/bloom/icons/RiFolderOpenLine', () => ({ RiFolderOpenLine: () => null }), {
  virtual: true,
});
jest.mock('@oxy.so/bloom/page-header', () => ({ PageHeader: () => null }));
jest.mock('@oxy.so/bloom/screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
  ScreenScrollView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@oxy.so/bloom/surfaces', () => ({ confirm: jest.fn() }));
jest.mock('@oxy.so/bloom/text-field', () => ({
  TextFieldInput: (props: object) => {
    const { TextInput } = require('react-native');
    return <TextInput {...props} />;
  },
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/components/SaveToFolderBottomSheet', () => ({
  FolderColorSwatches: () => null,
  FOLDER_COLORS: ['red'],
}));
jest.mock('@/components/ui/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('@/components/ui/ListSkeleton', () => ({ ListSkeleton: () => null }));

it('resets the actual folder editor when the account changes even for the same folder id', () => {
  const view = render(<EditFolderScreen />);
  fireEvent.changeText(screen.getByDisplayValue('A folder'), 'A private draft');
  mockOwner.userId = 'B';
  mockOwner.sessionId = 'session-B';
  mockFolderName = 'B folder';
  view.rerender(<EditFolderScreen />);
  expect(screen.queryByDisplayValue('A private draft')).toBeNull();
  expect(screen.getByDisplayValue('B folder')).toBeTruthy();
});
