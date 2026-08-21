/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sand: {
          50: '#faf8f4',
          100: '#f3efe6',
          200: '#e7dfcd',
          300: '#d5c7ab',
          400: '#bfa980',
          500: '#a68b5b',
          600: '#8a7048',
          700: '#6d583a',
          800: '#4f4029',
          900: '#33291a',
        },
        palm: {
          50: '#eefbf4',
          100: '#d6f5e3',
          200: '#b0e9cb',
          300: '#7bd7ac',
          400: '#44bd88',
          500: '#1fa26e',
          600: '#128359',
          700: '#0f6849',
          800: '#0f533b',
          900: '#0d4432',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'ping-badge': {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '75%,100%': { transform: 'scale(1.8)', opacity: '0' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.2s ease-out',
        'ping-badge': 'ping-badge 1.4s cubic-bezier(0,0,0.2,1) infinite',
      },
    },
  },
  plugins: [],
}
