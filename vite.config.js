import config from '@utsubo/config/vite'
import { defineConfig } from 'vite'
import * as path from 'node:path'

// Filters out external dependencies from bundling unless specified
const inline = []
const external = (id) =>
  !id.startsWith('.') &&
  !id.startsWith('@/') &&
  !path.isAbsolute(id) &&
  !inline.includes(id)

export default defineConfig({
  root: process.argv[2] ? undefined : 'demo',
  resolve: {
    alias: {
      '@utsubo/npm-template': '@',
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    lib: {
      entry: 'src/index.js',
    },
    rollupOptions: {
      external,
    },
  },
  worker: {
    rollupOptions: {
      external,
    },
  },
  plugins: [config()],
})
