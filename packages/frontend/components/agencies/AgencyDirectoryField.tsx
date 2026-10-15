import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@oxy.so/bloom/card';
import { Field } from '@oxy.so/bloom/field';
import { Item } from '@oxy.so/bloom/item';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { reviewService } from '@/services/reviewService';

/** Display text is local form state; only a directory selection is submitted as identity. */
export function AgencyDirectoryField({
  label,
  placeholder,
  name,
  accountId,
  onChange,
}: {
  label: string;
  placeholder: string;
  name: string;
  accountId: string;
  onChange: (name: string, oxyAccountId: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const search = useQuery({
    queryKey: ['agencyDirectory', query],
    queryFn: () => reviewService.searchAgencies(query),
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });
  const edit = (text: string) => {
    onChange(text, '');
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery(text), 300);
  };
  return (
    <View>
      <Field
        label={label}
        description={name.trim() && !accountId ? t('agencyDirectory.select') : undefined}
        error={search.isError ? t('agencyDirectory.unavailable') : undefined}
      >
        <TextFieldInput label={label} placeholder={placeholder} value={name} onChangeText={edit} />
      </Field>
      {open && name === query && query.trim().length >= 2 && search.data?.length ? (
        <Card radius="radius-12" appearance="outline">
          {search.data.map((company) => (
            <Item
              key={company.oxyAccountId}
              role="option"
              density="compact"
              title={company.name}
              accessibilityLabel={company.name}
              onPress={() => {
                if (timer.current) clearTimeout(timer.current);
                onChange(company.name, company.oxyAccountId);
                setOpen(false);
                setQuery('');
              }}
            />
          ))}
        </Card>
      ) : null}
    </View>
  );
}
