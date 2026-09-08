import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

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
// `--mode single` inlines every bundle into index.html, for a build that is a
// lone file to hand around; llms.txt still comes out beside it, unserved there.
export default defineConfig(({ mode }) => ({
  // Relative, so the build works from a sub-path too — the app has no router
  // and nothing else that assumes the site root.
  base: './',
  // A stale server holding 5173 used to push the new one to 5174, and whoever
  // was measuring in the browser then measured the wrong app. Failing loudly
  // is the cheaper end of that trade; `npm run dev:fresh` clears the port.
  server: { port: 5173, strictPort: true },
  plugins: [react(), llmsTxt(), ...(mode === 'single' ? [viteSingleFile()] : [])],
}))
