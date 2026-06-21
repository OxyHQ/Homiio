/** @type {import('tailwindcss').Config} */
module.exports = {
  // Bloom toggles the `.dark` class on the document root (web) / RN appearance,
  // so class-based dark mode keeps NativeWind utilities in sync with Bloom.
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './context/**/*.{js,jsx,ts,tsx}',
    './hooks/**/*.{js,jsx,ts,tsx}',
    './services/**/*.{js,jsx,ts,tsx}',
    './store/**/*.{js,jsx,ts,tsx}',
    './utils/**/*.{js,jsx,ts,tsx}',
    './styles/**/*.{js,jsx,ts,tsx}',
    '../../node_modules/@oxyhq/services/lib/**/*.{js,jsx}',
    '../../node_modules/@oxyhq/bloom/lib/**/*.{js,jsx}',
  ],
  plugins: [],
};
