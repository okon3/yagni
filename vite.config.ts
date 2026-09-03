import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const HELP = fileURLToPath(new URL('./src/gantt/agentApi.help.md', import.meta.url))

/**
 * Serves the agent API's own documentation at /llms.txt.
 *
 * Generated from the file `yagni.help()` returns rather than kept as a second
 * copy in public/: they say the same thing to two kinds of caller — one that
 * renders the page and one that only fetches it — and a copy drifts the first
 * time somebody forgets to mirror an edit.
 */
function llmsTxt(): Plugin {
  const read = () => readFileSync(HELP, 'utf8')
  return {
    name: 'yagni-llms-txt',
    configureServer(server) {
      server.middlewares.use('/llms.txt', (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        response.end(read())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: read() })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), llmsTxt()],
})
