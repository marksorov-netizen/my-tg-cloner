import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Прокси API запросов на backend во время разработки
    // changeOrigin + cookieDomainRewrite необходимы для корректной работы
    // httpOnly cookies (JWT) через Vite dev proxy
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        cookieDomainRewrite: { '*': '' },
      },
      '/auth': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        cookieDomainRewrite: { '*': '' },
      },
      '/batch': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        cookieDomainRewrite: { '*': '' },
      },
      '/status': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        cookieDomainRewrite: { '*': '' },
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        cookieDomainRewrite: { '*': '' },
      },
    },
  },
});