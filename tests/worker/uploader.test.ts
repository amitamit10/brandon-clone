import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp, type Env } from '../../src/worker/index'
import { cleanUploaderName, validateUpload } from '../../src/worker/validate'
import { applyMigrations, chatWith, uploadBody } from './support'

const ENV = env as unknown as Env
const DB = ENV.DB

beforeAll(async () => {
  await applyMigrations(DB)
})

const post = (app: ReturnType<typeof createApp>, body: unknown, ip: string) =>
  Promise.resolve(
    app.request(
      '/api/chats',
      { method: 'POST', headers: { 'CF-Connecting-IP': ip, 'content-type': 'application/json' }, body: JSON.stringify(body) },
      ENV,
    ),
  )

describe('uploaderName validation', () => {
  it('rejects a missing, empty or whitespace-only name with 400', async () => {
    const app = createApp()
    const { uploaderName: _omit, ...missing } = uploadBody(chatWith(40))
    expect((await post(app, missing, 'up-missing')).status).toBe(400)
    expect((await post(app, { ...uploadBody(chatWith(40)), uploaderName: '' }, 'up-empty')).status).toBe(400)
    expect((await post(app, { ...uploadBody(chatWith(40)), uploaderName: ' \n\t ' }, 'up-blank')).status).toBe(400)
    expect((await post(app, { ...uploadBody(chatWith(40)), uploaderName: 42 }, 'up-type')).status).toBe(400)
  })

  it('rejects a name longer than 60 characters and accepts exactly 60', () => {
    const base = uploadBody(chatWith(40))
    expect(() => validateUpload({ ...base, uploaderName: 'a'.repeat(61) })).toThrow()
    expect(validateUpload({ ...base, uploaderName: 'a'.repeat(60) }).uploaderName).toBe('a'.repeat(60))
  })

  it('collapses whitespace and strips control and bidi characters before storing', async () => {
    const app = createApp()
    const res = await post(app, { ...uploadBody(chatWith(40)), uploaderName: '‎al‮ice \n  Ko\u0007ch' }, 'up-clean')
    expect(res.status).toBe(201)
    const { chatId } = (await res.json()) as { chatId: string }
    const row = await DB.prepare('SELECT uploader_name FROM chats WHERE id = ?').bind(chatId).first<{ uploader_name: string }>()
    expect(row?.uploader_name).toBe('alice Koch')
  })

  it('cleanUploaderName keeps letters, collapses spaces and returns null for junk', () => {
    expect(cleanUploaderName('  Dana   Levi ')).toBe('Dana Levi')
    expect(cleanUploaderName('‪‬')).toBeNull()
    expect(cleanUploaderName(undefined)).toBeNull()
  })
})
