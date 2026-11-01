import type React from 'react';
import { act, render } from '@testing-library/react-native';
import { DatePicker } from '@oxy.so/bloom/date-picker';
import { LocationStep } from '@/components/property/create/LocationStep';
import type { LocationStepProps } from '@/components/property/create/types';
import { StepPriceDates } from '@/components/reviews/write/StepPriceDates';
import { INITIAL_WIZARD_DATA } from '@/components/reviews/write/types';
import { createDefaultFormData } from '@/store/createPropertyFormStore';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@oxy.so/bloom/date-picker', () => ({ DatePicker: jest.fn(() => null) }));
jest.mock('@oxy.so/bloom/field', () => ({
  Field: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@oxy.so/bloom/button', () => ({ Button: () => null }));
jest.mock('@oxy.so/bloom/chip', () => ({ Chip: () => null }));
jest.mock('@oxy.so/bloom/theme', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('@oxy.so/bloom/icons/RiExpandDiagonalSLine', () => ({
  RiExpandDiagonalSLine: () => null,
}));
jest.mock('@oxy.so/bloom/icons/RiEyeLine', () => ({ RiEyeLine: () => null }));
jest.mock('@oxy.so/bloom/icons/RiEyeOffLine', () => ({ RiEyeOffLine: () => null }));
jest.mock('@/components/map/AddressPickerMap', () => ({ AddressPickerMap: () => null }));
jest.mock('@/components/property/create/fields', () => ({
  WizardSelect: () => null,
  WizardTextField: () => null,
}));
jest.mock('@oxy.so/bloom/segmented-control', () => ({
  SegmentedControl: () => null,
  SegmentedControlItem: () => null,
  SegmentedControlItemText: () => null,
}));
jest.mock('@oxy.so/bloom/text-field', () => ({ TextFieldInput: () => null }));

const picker = jest.mocked(DatePicker);
const pickerProps = () => picker.mock.calls.at(-1)?.[0];

beforeEach(() => picker.mockClear());

test('property location handles its absent default and converts a selected local day', () => {
  const formData = createDefaultFormData();
  expect(formData.location.availableFrom).toBeUndefined();
  const updateFormField = jest.fn();
  const props: LocationStepProps = {
    formData,
    validationErrors: {},
    fieldsToShow: [],
    updateFormField,
    setFormData: jest.fn(),
    mapPoint: null,
    onAddressSelect: jest.fn(),
    onOpenFullscreenMap: jest.fn(),
    onFloorChange: jest.fn(),
    onShowFloorToggle: jest.fn(),
  };
  const screen = render(<LocationStep {...props} />);
  expect(pickerProps()?.value).toBeNull();
  const location = { ...formData.location, availableFrom: '26-1-2' };
  screen.rerender(<LocationStep {...props} formData={{ ...formData, location }} />);
  expect(pickerProps()?.value?.getFullYear()).toBe(26);
  expect(pickerProps()?.value?.getMonth()).toBe(0);
  expect(pickerProps()?.value?.getDate()).toBe(2);
  act(() => pickerProps()?.onChange?.(new Date(2024, 1, 29)));
  expect(updateFormField).toHaveBeenCalledWith('location', 'availableFrom', '2024-02-29');
});

test('review dates keep valid, invalid, and selected calendar days', () => {
  const update = jest.fn();
  const data = { ...INITIAL_WIZARD_DATA, livedFrom: '2024-2-29', livedTo: '2026-2-29' };
  render(<StepPriceDates data={data} update={update} />);
  const [from, to] = picker.mock.calls.map(([props]) => props);
  expect(from.value?.getFullYear()).toBe(2024);
  expect(from.value?.getMonth()).toBe(1);
  expect(from.value?.getDate()).toBe(29);
  expect(to.value).toBeNull();
  act(() => to.onChange?.(new Date(2026, 2, 1)));
  expect(update).toHaveBeenCalledWith('livedTo', '2026-03-01');
});
