import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  root: './src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心 —— 每个页面都依赖，单独拆出
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // 图标库（lucide-react 体积不小）
          'icon-vendor': ['lucide-react'],
          // xlsx 库非常大，只有个别页面用到
          'xlsx-vendor': ['xlsx'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['xdxt.henankadigao.cn'],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
