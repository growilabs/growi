/** @type {import('tailwindcss').Config} */
module.exports = {
  // Content paths for GROWI's Turborepo structure
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './pages/**/*.{js,ts,jsx,tsx}',
    '../../packages/**/*.{js,ts,jsx,tsx}',
  ],

  // CRITICAL: Add prefix to avoid Bootstrap conflicts
  prefix: 'tw-',

  // Disable preflight to prevent base style conflicts with Bootstrap
  corePlugins: {
    preflight: false,
  },

  theme: {
    extend: {
      // GROWI brand colors
      colors: {
        'growi-blue': '#1976d2',
        'growi-green': '#4caf50',
        'growi-orange': '#ff9800',
        'growi-red': '#f44336',
      },
      spacing: {
        // Custom spacing if needed
      },
      fontFamily: {
        // GROWI specific fonts
      },
    },
  },

  plugins: [
    // Add Tailwind plugins as needed
    // require('@tailwindcss/forms'),
    // require('@tailwindcss/typography'),
  ],
};
