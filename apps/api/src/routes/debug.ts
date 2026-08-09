import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AuthSession as Session, User } from '@slide-maker/shared'
import { authMiddleware } from '../middleware/auth.js'
import { adminMiddleware } from '../middleware/admin.js'
import { debugBus } from '../debug/event-bus.js'
import { clearTranscripts, readTranscripts } from '../debug/transcript-log.js'

type Env = {
  Variables: {
    user: User
    session: Session
  }
}

const debug = new Hono<Env>()

// All debug routes require auth + admin
debug.use('*', authMiddleware, adminMiddleware)

// GET /api/debug/stream — SSE relay of debugBus events
debug.get('/stream', async (c) => {
  return streamSSE(c, async (stream) => {
    // Heartbeat to keep connections alive (20s)
    const ping = setInterval(() => {
      stream.writeSSE({ event: 'ping', data: '' }).catch(() => {})
    }, 20_000)

    const onStart = (data: any) => {
      stream.writeSSE({ event: 'stream:start', data: JSON.stringify(data) }).catch(() => {})
    }
    const onChunk = (data: any) => {
      stream.writeSSE({ event: 'stream:chunk', data: JSON.stringify(data) }).catch(() => {})
    }
    const onDone = (data: any) => {
      stream.writeSSE({ event: 'stream:done', data: JSON.stringify(data) }).catch(() => {})
    }
    const onError = (data: any) => {
      stream.writeSSE({ event: 'stream:error', data: JSON.stringify(data) }).catch(() => {})
    }

    debugBus.on('stream:start', onStart)
    debugBus.on('stream:chunk', onChunk)
    debugBus.on('stream:done', onDone)
    debugBus.on('stream:error', onError)

    await new Promise<void>((resolve) => {
      stream.onAbort(() => resolve())
    })

    clearInterval(ping)
    debugBus.off('stream:start', onStart)
    debugBus.off('stream:chunk', onChunk)
    debugBus.off('stream:done', onDone)
    debugBus.off('stream:error', onError)
  })
})

// GET /api/debug/transcripts
debug.get('/transcripts', async (c) => {
  const limit = Number(c.req.query('limit') ?? '50')
  const deck = c.req.query('deck') ?? undefined
  const model = c.req.query('model') ?? undefined
  const transcripts = await readTranscripts({ limit, deck, model })
  return c.json({ transcripts })
})

// DELETE /api/debug/transcripts
debug.delete('/transcripts', async (c) => {
  await clearTranscripts()
  return c.json({ ok: true })
})

export default debug
