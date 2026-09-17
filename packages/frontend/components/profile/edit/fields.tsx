/**
 * Bloom-backed field adapters for the profile edit form.
 *
 * The form keeps every value as a plain string (see `types.ts`), so these
 * adapters translate between that storage shape and the Bloom controls:
 *
 * - `OptionSelect` — a labelled Bloom `Select` over a fixed option list.
 * - `DateField` — a Bloom `DatePicker` over a `YYYY-MM-DD` string.
 * - `PhoneField` — a Bloom `PhoneInput` over a single `+<dial> <number>` string.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DatePicker } from '@oxy.so/bloom/date-picker';
import { Field } from '@oxy.so/bloom/field';
import { COUNTRIES, PhoneInput, type Country } from '@oxy.so/bloom/phone-input';
import {
  Select,
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@oxy.so/bloom/select';

interface OptionItem {
  value: string;
  label: string;
}

interface OptionSelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  /** i18n key prefix; each option's label is `t(\`${labelPrefix}.${option}\`)`. */
  labelPrefix: string;
  onChange: (value: T) => void;
}

export function OptionSelect<T extends string>({
  label,
  value,
  options,
  labelPrefix,
  onChange,
}: OptionSelectProps<T>) {
  const { t } = useTranslation();
  const items = useMemo<OptionItem[]>(
    () => options.map((option) => ({ value: option, label: t(`${labelPrefix}.${option}`) })),
    [options, labelPrefix, t],
  );

  return (
    <Field label={label}>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger label={label}>
          <SelectValue placeholder={label} />
          <SelectIcon />
        </SelectTrigger>
        <SelectContent
          label={label}
          items={items}
          renderItem={(item) => (
            <SelectItem value={item.value} label={item.label}>
              <SelectItemIndicator />
              <SelectItemText>{item.label}</SelectItemText>
            </SelectItem>
          )}
        />
      </Select>
    </Field>
  );
}

const DATE_INPUT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → local-midnight `Date` (the picker's own convention). */
export function parseDateInput(value: string | undefined): Date | null {
  const match = value ? DATE_INPUT.exec(value) : null;
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Local `Date` → `YYYY-MM-DD`, the string the form and schema carry. */
export function formatDateInput(date: Date | null): string {
  if (!date) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

interface DateFieldProps {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  minDate?: Date | null;
}

export function DateField({ label, value, onChange, placeholder, minDate }: DateFieldProps) {
  const { i18n } = useTranslation();
  return (
    <Field label={label}>
      <DatePicker
        value={parseDateInput(value)}
        onChange={(date) => onChange(formatDateInput(date))}
        placeholder={placeholder}
        accessibilityLabel={label}
        locale={i18n.language}
        minDate={minDate}
      />
    </Field>
  );
}

const DEFAULT_PHONE_COUNTRY = 'ES';

/** Longest dial code first, so `+1 242…` resolves to the Bahamas before `+1`. */
const COUNTRIES_BY_DIAL_LENGTH = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

/**
 * Split a stored phone string into the country whose dial code prefixes it and
 * the rest of the number. A value without a leading `+` keeps the fallback
 * country and is shown exactly as stored.
 */
export function splitPhone(
  value: string | undefined,
  fallbackIso2: string = DEFAULT_PHONE_COUNTRY,
): { iso2: string; number: string } {
  const raw = (value ?? '').trim();
  if (!raw.startsWith('+')) return { iso2: fallbackIso2, number: raw };
  const digits = raw.slice(1);
  const compact = digits.replace(/\s/g, '');
  // The fallback (the country already selected) wins when its code matches, so
  // a US number is not re-read as a longer +1 code it happens to begin with.
  const preferred = COUNTRIES.find((c) => c.iso2 === fallbackIso2);
  const country =
    preferred && compact.startsWith(preferred.dial)
      ? preferred
      : COUNTRIES_BY_DIAL_LENGTH.find((c) => compact.startsWith(c.dial));
  if (!country) return { iso2: fallbackIso2, number: raw };
  let consumed = 0;
  let index = 0;
  while (consumed < country.dial.length && index < digits.length) {
    if (digits[index] !== ' ') consumed += 1;
    index += 1;
  }
  return { iso2: country.iso2, number: digits.slice(index).trim() };
}

/** Compose the stored string; an empty number stores nothing. */
export function joinPhone(country: Country | undefined, number: string): string {
  const trimmed = number.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+') || !country) return trimmed;
  return `+${country.dial} ${trimmed}`;
}

interface PhoneFieldProps {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function PhoneField({ label, value, onChange, placeholder }: PhoneFieldProps) {
  // The country is held locally: several countries share a dial code (+1), so
  // the one the person picked cannot be re-derived from the stored string.
  const [iso2, setIso2] = useState(() => splitPhone(value).iso2);
  const country = COUNTRIES.find((c) => c.iso2 === iso2);
  const number = splitPhone(value, iso2).number;

  return (
    <PhoneInput
      label={label}
      accessibilityLabel={label}
      placeholder={placeholder}
      country={iso2}
      onCountryChange={(nextIso2, next) => {
        setIso2(nextIso2);
        onChange(joinPhone(next, number));
      }}
      value={number}
      onChangeText={(text) => onChange(joinPhone(country, text))}
    />
  );
}
