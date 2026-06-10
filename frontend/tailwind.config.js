/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'douyin-red': '#FE2C55',
        'douyin-orange': '#FF7D00',
        'dark-bg': '#1A1A1A',
      },
      animation: {
        'pulse-fast': 'pulse 0.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-price': 'bounce 0.3s ease-out',
      }
    },
  },
  plugins: [],
}
