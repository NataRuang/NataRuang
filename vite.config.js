import { resolve } from 'path'
import { defineConfig } from 'vite'
import { createHtmlPlugin } from 'vite-plugin-html'

export default defineConfig({
  plugins: [
    createHtmlPlugin({ minify: true })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    rollupOptions: {
      input: {
        main:   resolve(__dirname, 'index.html'),
        admin:  resolve(__dirname, 'admin.html'),
        login:  resolve(__dirname, 'login.html'),
        status: resolve(__dirname, 'status.html'),
        produk: resolve(__dirname, 'produk.html'),
        checkout: resolve(__dirname, 'checkout.html')
      },
      output: {
        manualChunks: {
          supabase: ['@supabase/supabase-js'],
          charts:   ['chart.js'],
          pdf:      ['jspdf', 'jspdf-autotable'],
          excel:    ['xlsx']
        }
      }
    },
    target: 'es2020',
    minify: 'terser',
    sourcemap: false
  },
  optimizeDeps: {
    include: ['@supabase/supabase-js']
  }
})
