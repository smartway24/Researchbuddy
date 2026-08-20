import { Appearance } from 'react-native';

/**
 * A small, deliberately boring palette. Reading is the product; the interface
 * should get out of the way, in both light and dark.
 */
export interface Theme {
  background: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  warning: string;
  success: string;
}

const light: Theme = {
  background: '#f7f7f5',
  surface: '#ffffff',
  border: '#e2e2dd',
  text: '#16160f',
  muted: '#6b6b62',
  accent: '#1c5d99',
  accentText: '#ffffff',
  warning: '#8a5a00',
  success: '#2b6b3f',
};

const dark: Theme = {
  background: '#131316',
  surface: '#1d1d21',
  border: '#33333a',
  text: '#f2f2ef',
  muted: '#a0a09a',
  accent: '#6aa9e0',
  accentText: '#0d1520',
  warning: '#e0b062',
  success: '#7fc79a',
};

export function currentTheme(): Theme {
  return Appearance.getColorScheme() === 'dark' ? dark : light;
}

export const spacing = { xs: 4, sm: 8, md: 14, lg: 22, xl: 32 } as const;
