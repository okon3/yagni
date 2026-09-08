#!/usr/bin/env node
/**
 * Starts the dev server on a guaranteed-free port 5173.
 *
 * With `strictPort` Vite refuses to start when a stale server still holds the
 * port, which is the point — but the operator then has to find and kill it by
 * hand before every cold restart. HMR here has served stale stylesheets and
 * stale modules often enough (CLAUDE.md) that a cold restart is routine, not
 * exceptional, so it gets one command.
 */
import { spawnSync } from 'node:child_process'

const PORT = 5173

/**
 * PIDs listening on `port`, via the only tool each platform ships with.
 *
 * `netstat -p TCP` is *not* the narrower query it looks like: it excludes the
 * TCPv6 family, and Vite binds `::1` because that is what localhost resolves
 * to first here — the stale server is invisible to the filtered call.
 */
function listeners(port) {
  if (process.platform === 'win32') {
    const { stdout } = spawnSync('netstat', ['-ano'], { encoding: 'utf8' })
    return [
      ...new Set(
        (stdout ?? '')
          .split('\n')
          .filter((line) => line.includes('LISTENING') && line.includes(`:${port} `))
          .map((line) => line.trim().split(/\s+/).at(-1))
          .filter((pid) => pid && pid !== '0'),
      ),
    ]
  }
  const { stdout } = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  return [...new Set((stdout ?? '').split('\n').filter(Boolean))]
}

function kill(pid) {
  const [command, args] =
    process.platform === 'win32' ? ['taskkill', ['/F', '/T', '/PID', pid]] : ['kill', ['-9', pid]]
  spawnSync(command, args, { stdio: 'ignore' })
}

for (const pid of listeners(PORT)) {
  console.log(`dev-fresh: killing stale listener on :${PORT} (pid ${pid})`)
  kill(pid)
}

// Vite's own API rather than its CLI: the `vite` bin is a .cmd shim on Windows
// (spawning one without a shell throws EINVAL on Node >= 18.20, with one is
// deprecated) and vite@8 does not export ./bin/vite.js to resolve around it.
const { createServer } = await import('vite')
const server = await createServer()
await server.listen()
server.printUrls()
