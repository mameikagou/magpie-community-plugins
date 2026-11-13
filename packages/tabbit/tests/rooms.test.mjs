// Rooms: one per session lane, kept across requests, retries and restarts,
// and taken one turn at a time.

import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { TabbitPlugin, _internal } from "../index.mjs"
import { chainOf, cutOf, laneOf, loadRooms, saveRooms, serial, roomsFile } from "../src/rooms.mjs"

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const auth = { type: "api", key: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.sig", metadata: { userId: "u-1" } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A Tabbit that, like the real one, refuses a second run in a room while one
// is still answering, and answers each turn after `delay` ms.
function busyTabbit({ delay = 30, failRun = null } = {}) {
  const calls = []
  const active = new Set()
  let rooms = 0
  let answers = 0
  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url)
    const method = (init.method ?? "GET").toUpperCase()
    const room = url.pathname.match(/rooms\/([^/]+)\//)?.[1]
    calls.push({ method, path: url.pathname, room, body: init.body ? JSON.parse(init.body) : null })
    if (url.pathname === "/api/v3/chat/rooms" && method === "POST") return Response.json({ room_id: `room-${++rooms}` })
    if (url.pathname.endsWith("/runs")) {
      const fail = failRun?.(calls.filter((c) => c.path.endsWith("/runs")).length, room)
      if (fail) return Response.json({ detail: "boom" }, { status: fail })
      if (active.has(room)) return Response.json({ detail: { message: "already has an active room run" } }, { status: 409 })
      active.add(room)
      return Response.json({ run_id: "run" })
    }
    if (url.pathname.endsWith("/join")) {
      const id = `a${++answers}`
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(encoder.encode(frame("assistant_message_started", { payload: { run_id: "run", message_id: id } })))
            await sleep(delay)
            c.enqueue(encoder.encode(frame("assistant_message_delta", { payload: { chunk_payload: { content: "ok" } } })))
            c.enqueue(encoder.encode(frame("assistant_message_finished", { payload: { message_id: id } })))
            active.delete(room)
            c.enqueue(encoder.encode(frame("run_completed", { payload: { status: "COMPLETED" } })))
            c.close()
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )
    }
    return new Response("{}", { status: 200 })
  }
  return { calls, restore: () => (globalThis.fetch = original) }
}

async function ask(loader, session, body) {
  const res = await loader.fetch(`${loader.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-magpie-tabbit-session": session },
    body: JSON.stringify({ model: "Gemini-4-Carbon", ...body }),
  })
  return { status: res.status, text: await res.text() }
}

const tool = { type: "function", function: { name: "read", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } } } } }

test("requests of one session lane wait for each other instead of opening rooms", async () => {
  const t = busyTabbit()
  try {
    _internal.rooms.clear()
    const hooks = await TabbitPlugin()
    const loader = await hooks.auth.loader(async () => auth)
    const first = ask(loader, "s1", { messages: [{ role: "user", content: "one" }], tools: [tool], stream: true })
    const second = ask(loader, "s1", { messages: [{ role: "user", content: "one" }, { role: "assistant", content: "ok" }, { role: "user", content: "two" }], tools: [tool], stream: true })
    const [a, b] = await Promise.all([first, second])
    assert.match(a.text, /"finish_reason":"stop"/)
    assert.match(b.text, /"finish_reason":"stop"/)
    const created = t.calls.filter((c) => c.path === "/api/v3/chat/rooms")
    assert.equal(created.length, 1, "one room for the session")
    const runs = t.calls.filter((c) => c.path.endsWith("/runs"))
    assert.equal(runs.length, 2)
    assert.equal(runs[1].body.input_payload.content.startsWith("two"), true, runs[1].body.input_payload.content)
  } finally {
    t.restore()
    _internal.rooms.clear()
  }
})

test("a session's side requests (no tools) get their own room, alongside the agent's", async () => {
  const t = busyTabbit({ delay: 60 })
  try {
    _internal.rooms.clear()
    const hooks = await TabbitPlugin()
    const loader = await hooks.auth.loader(async () => auth)
    const started = Date.now()
    await Promise.all([
      ask(loader, "s2", { messages: [{ role: "user", content: "work" }], tools: [tool], stream: true }),
      ask(loader, "s2", { messages: [{ role: "user", content: "title this" }], stream: false }),
    ])
    assert.equal(t.calls.filter((c) => c.path === "/api/v3/chat/rooms").length, 2)
    assert.ok(Date.now() - started < 115, "the two lanes ran side by side")
    // The next side request goes back into the side room.
    await ask(loader, "s2", { messages: [{ role: "user", content: "title this" }, { role: "assistant", content: "ok" }, { role: "user", content: "shorter" }] })
    assert.equal(t.calls.filter((c) => c.path === "/api/v3/chat/rooms").length, 2)
  } finally {
    t.restore()
    _internal.rooms.clear()
  }
})

test("a room still busy from elsewhere is stopped and asked again, not replaced", async () => {
  const t = busyTabbit()
  try {
    _internal.rooms.clear()
    const hooks = await TabbitPlugin()
    const loader = await hooks.auth.loader(async () => auth)
    await ask(loader, "s3", { messages: [{ role: "user", content: "one" }] })
    // Something else holds the room: the first /runs is refused once.
    const realFetch = globalThis.fetch
    let refused = false
    globalThis.fetch = async (input, init = {}) => {
      const p = new URL(typeof input === "string" ? input : input.url).pathname
      if (p.endsWith("/runs") && !refused) {
        refused = true
        return Response.json({ detail: { message: "already has an active room run" } }, { status: 409 })
      }
      return realFetch(input, init)
    }
    const r = await ask(loader, "s3", { messages: [{ role: "user", content: "one" }, { role: "assistant", content: "ok" }, { role: "user", content: "two" }] })
    globalThis.fetch = realFetch
    assert.equal(r.status, 200)
    assert.equal(t.calls.filter((c) => c.path === "/api/v3/chat/rooms").length, 1)
    assert.ok(t.calls.some((c) => c.path === "/proxy/v0/chat/stop/"), "the busy run was stopped")
  } finally {
    t.restore()
    _internal.rooms.clear()
  }
})

test("serial runs tasks of one key in order and frees the key", async () => {
  const locks = new Map()
  const order = []
  const task = (n, ms) => async (release) => {
    order.push(`start ${n}`)
    await sleep(ms)
    order.push(`end ${n}`)
    release()
    return n
  }
  const out = await Promise.all([serial(locks, "k", task(1, 20)), serial(locks, "k", task(2, 1)), serial(locks, "other", task(3, 1))])
  assert.deepEqual(out, [1, 2, 3])
  assert.ok(order.indexOf("end 1") < order.indexOf("start 2"))
  assert.ok(order.indexOf("start 3") < order.indexOf("end 1"))
  await sleep(5)
  assert.equal(locks.size, 0)
  // A task that throws releases its key too.
  await assert.rejects(serial(locks, "k", async () => {
    throw new Error("x")
  }))
  assert.equal(await serial(locks, "k", async (release) => (release(), "after")), "after")
})

test("a lane is a hash chain: matches its own transcript, persists, and holds no text", () => {
  const history = [{ role: "system", content: "sys" }, { role: "user", content: "secret text" }, { role: "assistant", content: "ok" }]
  const lane = laneOf({ room: "r1", parent: "a1", history, tools: { read: "abc" }, chars: 10 })
  assert.equal(cutOf(lane, [...history, { role: "user", content: "next" }]), 3)
  assert.equal(cutOf(lane, [{ role: "system", content: "sys" }, { role: "user", content: "other" }, { role: "assistant", content: "ok" }]), null)
  assert.equal(chainOf(history).count, 3)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabbit-rooms-"))
  const file = path.join(dir, "rooms.json")
  try {
    saveRooms(file, new Map([["u\u0000s\u0000tools", lane]]))
    const raw = fs.readFileSync(file, "utf8")
    assert.doesNotMatch(raw, /secret text/)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    const back = new Map()
    loadRooms(file, back)
    assert.deepEqual(back.get("u\u0000s\u0000tools"), lane)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(roomsFile({ TABBIT_ROOMS_FILE: "off" }), null)
  assert.equal(roomsFile({ NODE_TEST_CONTEXT: "child" }), null)
  assert.match(roomsFile({ XDG_STATE_HOME: "/x" }), /^\/x\/magpie\/tabbit-rooms\.json$/)
})

test("concurrency defaults to 4", async () => {
  assert.equal(_internal.CONCURRENCY, 4)
  const hooks = await TabbitPlugin()
  assert.equal(hooks.auth.maxConcurrency, 4)
})

test("a room past ROOM_CHARS moves to a fresh room by itself and the old one is archived", async () => {
  const { ROOM_CHARS } = await import("../src/rooms.mjs")
  const t = busyTabbit()
  // The archive reads the old room's title and puts it back prefixed.
  const inner = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url)
    if (url.pathname === "/api/v0/chat/md5-key-sessions/user-sessions") {
      t.calls.push({ method: "GET", path: url.pathname })
      return Response.json({ sessions: [{ chat_session_id: "room-old", chat_session_title: "写代码" }] })
    }
    return inner(input, init)
  }
  try {
    _internal.rooms.clear()
    const hooks = await TabbitPlugin()
    const loader = await hooks.auth.loader(async () => auth)
    const history = [{ role: "user", content: "one" }, { role: "assistant", content: "ok" }]
    const key = `u-1\u0000s-full\u0000plain`
    _internal.rooms.set(key, laneOf({ room: "room-old", parent: "a0", history: _internal.historyOf(history), chars: ROOM_CHARS - 1 }))
    const r = await ask(loader, "s-full", { messages: [...history, { role: "user", content: "two" }] })
    assert.equal(r.status, 200)
    const runs = t.calls.filter((c) => c.path.endsWith("/runs"))
    assert.equal(runs.length, 1)
    assert.equal(runs[0].room, "room-1", "the turn goes to a new room")
    assert.match(runs[0].body.input_payload.content, /user: one[\s\S]*user: two/, "with the whole transcript")
    assert.equal(_internal.rooms.get(key).room, "room-1")
    for (let i = 0; i < 20 && !t.calls.some((c) => c.method === "PUT"); i++) await sleep(5)
    const put = t.calls.find((c) => c.method === "PUT")
    assert.equal(put?.path, "/proxy/v0/chat/sessions/room-old")
    assert.deepEqual(put.body, { title: "[归档] 写代码" })
  } finally {
    globalThis.fetch = inner
    t.restore()
  }
})

test("ROOM_CHARS reads TABBIT_ROOM_CHARS within bounds", async () => {
  const { roomCharsOf } = await import("../src/rooms.mjs")
  assert.equal(roomCharsOf({}), 800_000)
  assert.equal(roomCharsOf({ TABBIT_ROOM_CHARS: "300_000" }), 300_000)
  assert.equal(roomCharsOf({ TABBIT_ROOM_CHARS: "10" }), 800_000)
})

test("a turn that never releases holds up only the next one, once", async () => {
  const { serial } = await import("../src/rooms.mjs")
  const locks = new Map()
  const order = []
  serial(locks, "k", async () => order.push("a"), { maxWait: 30 }) // never releases
  const b = serial(locks, "k", async (release) => (order.push("b"), release()), { maxWait: 30 })
  const t0 = Date.now()
  const c = serial(locks, "k", async (release) => (order.push("c"), release()), { maxWait: 5000 })
  await Promise.all([b, c])
  assert.deepEqual(order, ["a", "b", "c"])
  assert.ok(Date.now() - t0 < 1000, "c should not wait out its own maxWait")
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(locks.size, 0)
})

test("a long prompt cut after some parts went in: the room is retired, not filled again", async () => {
  // The 2nd run (part 2 of 3) fails with 500 after part 1 went in and was answered.
  const t = busyTabbit({ delay: 1, failRun: (n) => (n === 2 ? 500 : 0) })
  try {
    _internal.rooms.clear()
    const hooks = await TabbitPlugin()
    const loader = await hooks.auth.loader(async () => auth)
    const big = "x ".repeat(25_000)
    const first = await ask(loader, "s-broken", { messages: [{ role: "user", content: big }] })
    assert.notEqual(first.status, 200)
    const lane = [..._internal.rooms.values()][0]
    assert.equal(lane.broken, true)
    assert.equal(lane.parent, "a1")
    const again = await ask(loader, "s-broken", { messages: [{ role: "user", content: "short" }] })
    assert.equal(again.status, 200)
    const rooms = t.calls.filter((c) => c.path === "/api/v3/chat/rooms")
    assert.equal(rooms.length, 2)
    const stops = t.calls.filter((c) => c.path.includes("/chat/stop"))
    assert.ok(stops.length >= 1)
  } finally {
    t.restore()
  }
})
