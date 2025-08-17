/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all of your component files.
  content: ["./App.{js,jsx,ts,tsx}", "./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0047bf',
          light: '#ffffff',
          dark: '#1A1A1A',
        },
        secondary: {
          DEFAULT: '#ffd013',
          light: '#fff7d7',
        },
        // Keeping commonly used grayscale tokens for parity with styles/colors.ts
        black: '#000000',
        'black-light-1': '#111111',
        'black-light-2': '#1e1e1e',
        'black-light-3': '#3c3c3c',
        'black-light-4': '#5e5e5e',
        'black-light-5': '#949494',
        'black-light-6': '#ededed',
        'black-light-7': '#F5F5F5',
        'black-light-8': '#FAFAFA',
        'black-light-9': '#FDFDFD',
      },
      fontFamily: {
        sans: [
          'Cereal-Book',
          'Inter-Regular',
          'system-ui',
          'Arial',
          'sans-serif',
        ],
        display: [
          'Cereal-Bold',
          'Inter-Bold',
          'system-ui',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
