import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxy = {
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
  '/temp_media': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react({ fastRefresh: false })],
  resolve: {
    preserveSymlinks: true,
  },
  server: {
    host: true,
    port: 5173,
    fs: {
      strict: false,
    },
    proxy: apiProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    proxy: apiProxy,
  },
});