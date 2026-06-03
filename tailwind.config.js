/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        'cat-base': '#1e1e2e',
        'cat-mantle': '#181825',
        'cat-crust': '#11111b',
        'cat-surface0': '#313244',
        'cat-surface1': '#45475a',
        'cat-surface2': '#585b70',
        'cat-overlay0': '#6c7086',
        'cat-text': '#cdd6f4',
        'cat-subtext': '#a6adc8',
        'cat-blue': '#89b4fa',
        'cat-green': '#a6e3a1',
        'cat-red': '#f38ba8',
        'cat-yellow': '#f9e2af',
        'cat-mauve': '#cba6f7',
        'cat-peach': '#fab387',
        'cat-teal': '#94e2d5',
      }
    }
  },
  plugins: []
}
