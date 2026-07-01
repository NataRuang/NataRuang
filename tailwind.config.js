/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './*.html',
    './src/**/*.{js,html}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        wood: {
          50:  '#fdf8f3',
          100: '#f7ead9',
          200: '#efd4b0',
          300: '#e4b87e',
          400: '#d49555',
          500: '#c07a38',
          600: '#a5622d',
          700: '#864d27',
          800: '#6e3f26',
          900: '#5c3522'
        },
        charcoal: {
          50:  '#f5f5f4',
          100: '#e8e8e6',
          200: '#d4d3cf',
          300: '#b2b1ab',
          400: '#8c8b83',
          500: '#716f68',
          600: '#5e5c56',
          700: '#4e4c47',
          800: '#44423d',
          900: '#3b3935',
          950: '#1a1917'
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'ui-sans-serif', 'system-ui'],
        serif: ['Playfair Display', 'ui-serif', 'Georgia']
      },
      animation: {
        'fade-in':    'fadeIn 0.4s ease forwards',
        'slide-up':   'slideUp 0.4s ease forwards',
        'skeleton':   'skeleton 1.5s ease infinite',
        'float':      'float 3s ease-in-out infinite'
      },
      keyframes: {
        fadeIn:   { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        skeleton: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.4' } },
        float:    { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } }
      },
      boxShadow: {
        'card':   '0 2px 12px 0 rgba(0,0,0,.08)',
        'card-hover': '0 8px 30px 0 rgba(0,0,0,.14)',
        'dialog': '0 20px 60px 0 rgba(0,0,0,.18)'
      },
      borderRadius: {
        'xl': '16px',
        '2xl':'20px',
        '3xl':'24px'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography')
  ]
}
