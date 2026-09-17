import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { Command, type CommandItem } from '@oxy.so/bloom/command';
import { Field } from '@oxy.so/bloom/field';
import { TextFieldInput, type TextFieldInputProps } from '@oxy.so/bloom/text-field';
import { Textarea, type TextareaProps } from '@oxy.so/bloom/textarea';
import { RiArrowDownSLine, RiCheckLine } from '@oxy.so/bloom/icons';

type WizardTextFieldProps = Omit<TextFieldInputProps, 'isInvalid' | 'style'> & {
  /** Visible label above the field; also the input's accessible name. */
  label: string;
  /** Validation message. A non-empty string paints the field invalid. */
  error?: string | null;
  description?: string;
  required?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The wizard's one text input: Bloom `Field` (label, hint, error wiring) around
 * a `TextFieldInput`, so every step reads and announces its fields the same way.
 */
export function WizardTextField({
  label,
  error,
  description,
  required,
  style,
  ...input
}: WizardTextFieldProps) {
  return (
    <Field label={label} error={error || null} description={description} required={required} style={style}>
      <TextFieldInput label={label} isInvalid={Boolean(error)} {...input} />
    </Field>
  );
}

type WizardTextareaProps = Omit<TextareaProps, 'isInvalid' | 'hint'> & {
  label: string;
  error?: string | null;
};

/** Multiline sibling of {@link WizardTextField}, on Bloom `Textarea`. */
export function WizardTextarea({ error, rows = 5, ...props }: WizardTextareaProps) {
  return (
    <Textarea
      rows={rows}
      autoResize
      maxRows={12}
      isInvalid={Boolean(error)}
      hint={error || undefined}
      {...props}
    />
  );
}

interface WizardSelectProps {
  label: string;
  placeholder: string;
  options: readonly string[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
}

/**
 * A labelled, SEARCHABLE pick from a plain list of strings (value = label).
 *
 * Bloom `Select` has no search, and these lists are long (the state list is
 * about 60 entries), so the trigger opens Bloom `Command` over the page: type
 * to filter, press to pick. The chosen value carries the check.
 */
export function WizardSelect({
  label,
  placeholder,
  options,
  value,
  onValueChange,
  error,
  style,
}: WizardSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const items = React.useMemo<CommandItem[]>(
    () =>
      options.map((option) => ({
        id: option,
        label: option,
        icon: option === value ? RiCheckLine : undefined,
        onSelect: () => onValueChange(option),
      })),
    [options, value, onValueChange],
  );
  return (
    <Field label={label} error={error || null} style={style}>
      <Button
        variant="secondary"
        fullWidth
        trailingIcon={RiArrowDownSLine}
        onPress={() => setOpen(true)}
        accessibilityLabel={value ? `${label}: ${value}` : label}
        style={styles.trigger}
      >
        {value || placeholder}
      </Button>
      <Command
        visible={open}
        onClose={close}
        items={items}
        placeholder={`${t('common.search')}…`}
        emptyText={t('common.noResults')}
        filter={matchesIgnoringAccents}
      />
    </Field>
  );
}

/** Case- and accent-insensitive, so "malaga" finds "Málaga". */
function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function matchesIgnoringAccents(item: CommandItem, query: string): boolean {
  return foldForSearch(item.label).includes(foldForSearch(query.trim()));
}

const styles = StyleSheet.create({
  trigger: { justifyContent: 'space-between' },
});
