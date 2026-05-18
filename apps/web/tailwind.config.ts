import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';
import { tailwindPreset } from '@tripbng/config/tailwind';

const config: Config = {
  presets: [tailwindPreset as unknown as Config],
  content: ['./src/**/*.{ts,tsx}'],
  plugins: [animate],
};

export default config;
