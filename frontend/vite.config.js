import { fileURLToPath, URL } from 'node:url'
import { extname, join } from 'node:path'
import { readFileSync } from 'node:fs'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const extractionDevFallback = () => ({
  name: 'extraction-dev-fallback',
  configureServer(server) {
    const workflowIndexPath = join(server.config.root, 'public', 'extraction', 'index.html')

    server.middlewares.use((req, res, next) => {
      const pathname = req.url?.split('?')[0] || ''
      const isWorkflowRoute =
        pathname === '/extraction/' ||
        pathname.startsWith('/extraction/standard') ||
        pathname.startsWith('/extraction/language') ||
        pathname.startsWith('/extraction/question-crafter') ||
        pathname === '/lb-workflow' ||
        pathname.startsWith('/lb-workflow/')
      const isAssetRequest = Boolean(extname(pathname))

      if (!isWorkflowRoute || isAssetRequest) {
        next()
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html')
      res.end(readFileSync(workflowIndexPath))
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    extractionDevFallback(),
    vue(),
    vueDevTools(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/api-docs': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/api-docs.json': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
})
