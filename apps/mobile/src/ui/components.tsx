import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { currentTheme, spacing } from './theme';

const theme = currentTheme();

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Subheading({ children }: { children: ReactNode }) {
  return <Text style={styles.subheading}>{children}</Text>;
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
        (pressed || disabled) && styles.buttonDimmed,
      ]}
    >
      <Text style={isPrimary ? styles.buttonPrimaryText : styles.buttonSecondaryText}>{label}</Text>
    </Pressable>
  );
}

/** A labelled 0..1 progress bar; the ladder screen is built out of these. */
export function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View
      style={styles.progressTrack}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View style={[styles.progressFill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'warning' | 'success' }) {
  const color =
    tone === 'warning' ? theme.warning : tone === 'success' ? theme.success : theme.muted;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  heading: { color: theme.text, fontSize: 22, fontWeight: '700', marginBottom: spacing.sm },
  subheading: { color: theme.text, fontSize: 16, fontWeight: '600', marginBottom: spacing.xs },
  body: { color: theme.text, fontSize: 15, lineHeight: 21 },
  muted: { color: theme.muted, fontSize: 13, lineHeight: 18 },
  button: { borderRadius: 10, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: 'center' },
  buttonPrimary: { backgroundColor: theme.accent },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  buttonDimmed: { opacity: 0.6 },
  buttonPrimaryText: { color: theme.accentText, fontWeight: '600', fontSize: 15 },
  buttonSecondaryText: { color: theme.text, fontWeight: '600', fontSize: 15 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: theme.border, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: theme.accent },
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 11, fontWeight: '600' },
});
