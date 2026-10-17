/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1E88E5',
        success: '#4CAF50',
        danger: '#F44336',
        warning: '#FF9800',
      },
    },
  },
  plugins: [],
}
