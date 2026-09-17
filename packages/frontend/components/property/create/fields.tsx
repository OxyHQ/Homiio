import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Field } from '@oxy.so/bloom/field';
import { TextFieldInput, type TextFieldInputProps } from '@oxy.so/bloom/text-field';
import { Textarea, type TextareaProps } from '@oxy.so/bloom/textarea';
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
import { SettingsListItem } from '@oxy.so/bloom/settings-list';
import { Switch } from '@oxy.so/bloom/switch';

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

/** A labelled Bloom `Select` over a plain list of strings (value = label). */
export function WizardSelect({
  label,
  placeholder,
  options,
  value,
  onValueChange,
  error,
  style,
}: WizardSelectProps) {
  const items = React.useMemo(() => options.map((option) => ({ value: option, label: option })), [options]);
  return (
    <Field label={label} error={error || null} style={style}>
      <Select value={value || undefined} onValueChange={onValueChange}>
        <SelectTrigger label={label}>
          <SelectValue placeholder={placeholder} />
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

interface WizardSwitchItemProps {
  title: string;
  description?: string;
  value: boolean | undefined;
  onValueChange: (value: boolean) => void;
  icon?: React.ReactNode;
}

/**
 * A yes/no listing setting: a `SettingsListItem` row carrying a Bloom `Switch`.
 * Render inside a `SettingsListGroup`.
 */
export function WizardSwitchItem({
  title,
  description,
  value,
  onValueChange,
  icon,
}: WizardSwitchItemProps) {
  return (
    <SettingsListItem
      icon={icon}
      title={title}
      description={description}
      showChevron={false}
      rightElement={
        <Switch value={Boolean(value)} onValueChange={onValueChange} accessibilityLabel={title} />
      }
    />
  );
}
