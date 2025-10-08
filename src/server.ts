import dotenv from 'dotenv'
dotenv.config()

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import { randomUUID } from 'crypto'

interface User { id: string; name: string; email: string; password: string; createdAt: string }
interface List { id: string; userId: string; title: string; position: number; createdAt: string; updatedAt?: string }
interface Task {
  id: string; userId: string; listId: string; title: string; description?: string | null; status: 'todo'|'doing'|'done';
  dueDate?: string | null; priority: number; tags: string[]; position: number; createdAt: string; updatedAt?: string
}

const db = {
  users: new Map<string, User>(),
  lists: new Map<string, List>(),
  tasks: new Map<string, Task>(),
  refresh: new Map<string, { id: string; userId: string; token: string; createdAt: string; revokedAt?: string }>() ,
}

function now() { return new Date().toISOString() }

function nextPositionAfter(collection: { position: number }[], afterId?: string, idSelector?: (x:any)=>string){
  if (!collection.length && !afterId) return 100
  if (!afterId) return collection[0] ? collection[0].position - 100 : 100
  const idx = collection.findIndex(x => idSelector ? idSelector(x) === afterId : (x as any).id === afterId)
  if (idx === -1) return collection.length ? collection[collection.length-1].position + 100 : 100
  const after = collection[idx]
  const next = collection[idx+1]
  if (!next) return after.position + 100
  return (after.position + next.position) / 2
}

function taskMatchesFilters(t: Task, q?: string, status?: string, due?: string, priority?: number, tags?: string[]) {
  if (q) {
    const ql = q.toLowerCase()
    if (!(t.title.toLowerCase().includes(ql) || (t.description||'').toLowerCase().includes(ql))) return false
  }
  if (status && t.status !== status) return false
  if (priority && t.priority !== priority) return false
  if (tags && tags.length && !tags.every(tag => t.tags.includes(tag))) return false
  if (due) {
    const nowD = new Date()
    const d = t.dueDate ? new Date(t.dueDate) : null
    if (due === 'today') {
      if (!d) return false
      const same = d.getFullYear()===nowD.getFullYear() && d.getMonth()===nowD.getMonth() && d.getDate()===nowD.getDate()
      if (!same) return false
    }
    if (due === 'overdue') {
      if (!d) return false
      if (!(d < nowD && t.status !== 'done')) return false
    }
    if (due === 'week') {
      if (!d) return false
      const start = new Date(nowD.toDateString())
      const in7 = new Date(start); in7.setDate(start.getDate()+7)
      if (!(d >= start && d < in7)) return false
    }
  }
  return true
}

function buildSorter(sort: string){
  if (!sort) return (a: any, b: any) => a.position - b.position
  const fields = sort.split(',').map(s => s.trim()).filter(Boolean)
  return (a: any, b: any) => {
    for (const f of fields){
      const desc = f.startsWith('-')
      const key = desc ? f.slice(1) : f
      const av = a[key]; const bv = b[key]
      if (av == null && bv == null) continue
      if (av == null) return 1
      if (bv == null) return -1
      if (av < bv) return desc ? 1 : -1
      if (av > bv) return desc ? -1 : 1
    }
    return 0
  }
}

async function bootstrap(){
  const app = Fastify({ logger: true })

  const origins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  await app.register(cors, { origin: origins.length ? origins : true })
  await app.register(helmet)
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret-change-me' })

  // Auth hook
  app.decorate('auth', async (request: any, reply: any) => {
    try { await request.jwtVerify() }
    catch { return reply.code(401).send({ error: 'unauthorized', message: 'Token inválido' }) }
  })

  // Health
  app.get('/api/health', async () => ({ status: 'ok' }))

  // Auth – Sprint 1 (dev only)
  app.post('/api/auth/register', async (req: any, reply) => {
    let { name, email, password } = req.body ?? {}
    if (!email || !password || password.length < 8) {
      return reply.code(400).send({ error: 'bad_request', message: 'Dados inválidos' })
    }
    if (!name || !String(name).trim()) { name = String(email).split('@')[0] }
    if ([...db.users.values()].some(u => u.email === email)) {
      return reply.code(409).send({ error: 'conflict', message: 'E-mail já cadastrado' })
    }
    const user: User = { id: randomUUID(), name, email, password, createdAt: now() }
    db.users.set(user.id, user)
    const accessToken = app.jwt.sign({ sub: user.id }, { expiresIn: '15m' })
    const refreshToken = app.jwt.sign({ sub: user.id }, { expiresIn: '7d' })
    db.refresh.set(refreshToken, { id: randomUUID(), userId: user.id, token: refreshToken, createdAt: now() })
    return reply.code(201).send({ accessToken, refreshToken, tokenType: 'Bearer', expiresIn: 900 })
  })

  app.post('/api/auth/login', async (req: any, reply) => {
    const { email, password } = req.body ?? {}
    const user = [...db.users.values()].find(u => u.email === email && u.password === password)
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'Credenciais inválidas' })
    const accessToken = app.jwt.sign({ sub: user.id }, { expiresIn: '15m' })
    const refreshToken = app.jwt.sign({ sub: user.id }, { expiresIn: '7d' })
    db.refresh.set(refreshToken, { id: randomUUID(), userId: user.id, token: refreshToken, createdAt: now() })
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: 900 }
  })

  app.post('/api/auth/refresh', async (req: any, reply) => {
    const { refreshToken } = req.body ?? {}
    if (!refreshToken) return reply.code(400).send({ error: 'bad_request', message: 'refreshToken é obrigatório' })
    const saved = db.refresh.get(refreshToken)
    if (!saved || saved.revokedAt) return reply.code(401).send({ error: 'unauthorized', message: 'Refresh inválido' })
    const payload: any = app.jwt.decode(refreshToken)
    const userId = payload?.sub
    if (!userId || !db.users.get(userId)) return reply.code(401).send({ error: 'unauthorized', message: 'Usuário inválido' })
    const accessToken = app.jwt.sign({ sub: userId }, { expiresIn: '15m' })
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: 900 }
  })

  app.post('/api/auth/logout', async (req: any, reply) => {
    const { refreshToken } = req.body ?? {}
    const saved = refreshToken ? db.refresh.get(refreshToken) : undefined
    if (saved) saved.revokedAt = now()
    return reply.code(204).send()
  })

  app.get('/api/me', { preHandler: [ (app as any).auth ] }, async (req: any) => {
    const user = db.users.get(req.user.sub)
    return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt }
  })

  // Lists
  app.get('/api/lists', { preHandler: [ (app as any).auth ] }, async (req: any) => {
    const items = [...db.lists.values()].filter(l => l.userId === req.user.sub).sort((a,b)=>a.position-b.position)
    return items
  })

  app.post('/api/lists', { preHandler: [ (app as any).auth ] }, async (req: any, reply) => {
    const { title, afterId } = req.body ?? {}
    if (!title) return reply.code(400).send({ error: 'bad_request', message: 'title é obrigatório' })
    const userLists = [...db.lists.values()].filter(l => l.userId === req.user.sub).sort((a,b)=>a.position-b.position)
    const pos = nextPositionAfter(userLists, afterId)
    const list: List = { id: randomUUID(), userId: req.user.sub, title, position: pos, createdAt: now() }
    db.lists.set(list.id, list)
    return reply.code(201).send(list)
  })

  app.patch('/api/lists/:listId', { preHandler: [ (app as any).auth ] }, async (req: any, reply) => {
    const { listId } = req.params
    const list = db.lists.get(listId)
    if (!list || list.userId !== req.user.sub) return reply.code(404).send({ error: 'not_found', message: 'Lista não encontrada' })
    const { title } = req.body ?? {}
    if (title) list.title = title
    list.updatedAt = now()
    return list
  })

  app.delete('/api/lists/:listId', { preHandler: [ (app as any).auth ] }, async (req: any, reply) => {
    const { listId } = req.params
    const list = db.lists.get(listId)
    if (!list || list.userId !== req.user.sub) return reply.code(404).send({ error: 'not_found', message: 'Lista não encontrada' })
    for (const t of [...db.tasks.values()]) if (t.listId === listId && t.userId === req.user.sub) db.tasks.delete(t.id)
    db.lists.delete(listId)
    return reply.code(204).send()
  })

  app.post('/api/lists/reorder', { preHandler: [ (app as any).auth ] }, async (req: any, reply) => {
    const { order } = req.body ?? {}
    if (!Array.isArray(order)) return reply.code(400).send({ error: 'bad_request', message: 'order deve ser array' })
    let pos = 100
    for (const id of order) {
      const list = db.lists.get(id)
      if (list && list.userId === req.user.sub) { list.position = pos; pos += 100 }
    }
    return reply.code(204).send()
  })

  // Tasks
  app.get('/api/lists/:listId/tasks', { preHandler: [ (app as any).auth ] }, async (req: any) => {
    const { listId } = req.params
    const page = Math.max(1, parseInt(req.query.page ?? '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize ?? '20')))
    const sort = String(req.query.sort || '')
    const q = req.query.q as string | undefined
    const status = req.query.status as string | undefined
    const due = req.query.due as string | undefined
    const priority = req.query.priority ? parseInt(req.query.priority) : undefined
    const tags = req.query.tags ? String(req.query.tags).split(',').map((s:string)=>s.trim()).filter(Boolean) : undefined

    const all = [...db.tasks.values()].filter(t => t.userId === req.user.sub && t.listId === listId)
    const filtered = all.filter(t => taskMatchesFilters(t, q, status, due, priority, tags))
    const sorter = buildSorter(sort)
    const ordered = filtered.sort(sorter)
    const start = (page-1)*pageSize
    const items = ordered.slice(start, start+pageSize)
    return { items, page, pageSize, total: filtered.length }
  })

  app.post('/api/lists/:listId/tasks', { preHandler: [ (app as any).auth ] }, async (req: any, reply) => {
    const { listId } = req.params
    const list = db.lists.get(listId)
    if (!list || list.userId !== req.user.sub) return reply.code(404).send({ error: 'not_found', message: 'Lista não encontrada' })
    const { title, description, dueDate, priority = 3, tags = [], afterId } = req.body ?? {}
    if (!title) return reply.code(400).send({ error: 'bad_request', message: 'title é obrigatório' })
    const tasks = [...db.tasks.values()].filter(t => t.userId === req.user.sub && t.listId === listId).sort((a,b)=>a.position-b.position)
    const pos = nextPositionAfter(tasks, afterId)
    const task: Task = { id: randomUUID(), userId: req.user.sub, listId, title, description: description ?? null, status: 'todo', dueDate: dueDate ?? null, priority, tags, position: pos, createdAt: now() }
    db.tasks.set(task.id, task)
    return reply.code(201).send(task)
  })

  app.get('/api/tasks', { preHandler: [ (app as any).auth ] }, async (req: any) => {
    const page = Math.max(1, parseInt(req.query.page ?? '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize ?? '20')))
    const sort = String(req.query.sort || '')
    const q = req.query.q as string | undefined
    const status = req.query.status as string | undefined
    const due = req.query.due as string | undefined
    const priority = req.query.priority ? parseInt(req.query.priority) : undefined
    const tags = req.query.tags ? String(req.query.tags).split(',').map((s:string)=>s.trim()).filter(Boolean) : undefined

    const all = [...db.tasks.values()].filter(t => t.userId === req.user.sub)
    const filtered = all.filter(t => taskMatchesFilters(t, q, status, due, priority, tags))
    const sorter = buildSorter(sort)
    const ordered = filtered.sort(sorter)
    const start = (page-1)*pageSize
    const items = ordered.slice(start, start+pageSize)
    return { items, page, pageSize, total: filtered.length }
  })

  app.patch('/api/tasks/:taskId', { preHandler: [ (app as any).auth ] }, async (req: any, reply) => {
    const { taskId } = req.params
    const task = db.tasks.get(taskId)
    if (!task || task.userId !== req.user.sub) return reply.code(404).send({ error: 'not_found', message: 'Tarefa não encontrada' })
    const { title, description, status, dueDate, priority, tags } = req.body ?? {}
    if (title !== undefined) task.title = title
    if (description !== undefined) task.description = description
    if (status !== undefined) task.status = status
    if (dueDate !== undefined) task.dueDate = dueDate
    if (priority !== undefined) task.priority = priority
    if (tags !== undefined) task.tags = Array.isArray(tags) ? tags : []
    task.updatedAt = now()
    return task
  })

  app.delete('/api/tasks/:taskId', { preHandler: [ (app as any).auth ] }, async (req: any, reply) => {
    const { taskId } = req.params
    const task = db.tasks.get(taskId)
    if (!task || task.userId !== req.user.sub) return reply.code(404).send({ error: 'not_found', message: 'Tarefa não encontrada' })
    db.tasks.delete(taskId)
    return reply.code(204).send()
  })

  app.post('/api/tasks/:taskId/move', { preHandler: [ (app as any).auth ] }, async (req: any, reply) => {
    const { taskId } = req.params
    const { targetListId, afterId } = req.body ?? {}
    const task = db.tasks.get(taskId)
    if (!task || task.userId !== req.user.sub) return reply.code(404).send({ error: 'not_found', message: 'Tarefa não encontrada' })
    const targetList = db.lists.get(targetListId)
    if (!targetList || targetList.userId !== req.user.sub) return reply.code(404).send({ error: 'not_found', message: 'Lista alvo não encontrada' })
    const tasks = [...db.tasks.values()].filter(t => t.userId === req.user.sub && t.listId === targetListId).sort((a,b)=>a.position-b.position)
    task.listId = targetListId
    task.position = nextPositionAfter(tasks, afterId)
    task.updatedAt = now()
    return task
  })

  const port = Number(process.env.PORT || 3000)
  await app.listen({ port, host: '0.0.0.0' })
  app.log.info(`Task.IO Sprint 1 API running on http://localhost:${port}/api`)
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
