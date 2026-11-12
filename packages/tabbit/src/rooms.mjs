// Rooms: which Tabbit room carries which conversation of a magpie session.
//
// A Tabbit room is linear. Measured: whatever parent_message_id a turn names,
// the model sees every earlier turn of the room, so a room can't be rewound or
// branched. And a room answers one turn at a time: a second run while one is
// answering is refused with 409 ("already has an active room run"), while
// separate rooms of one account answer side by side (20 at once, measured).
//
// So a session keeps one room per lane — "tools" for the agent's requests
// (they carry client tools), "plain" for the side requests a harness makes
// under the same session id (a title, a summary) — and each lane takes its
// requests one at a time (see `serial`). For each request it decides whether
// the transcript simply continues the room (send only the new messages),
// repeats the last request (a retry), or was rewritten (edited, compacted);
// in the last two cases the room is still reused, with a note that says so.
//
// Nothing of the conversation itself is kept: a transcript is remembered as a
// hash chain (its length and the hash of its last link), and a tool list as a
// short hash per tool. That is what makes the record cheap enough to persist,
// so a restart of the plugin host doesn't lose a session's room.

import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Rooms live at Tabbit as long as the account does; a week is the token's own
// lifetime, after which a sign-in starts over anyway.
export const ROOM_TTL = 7 * 24 * 60 * 60 * 1000
// Lanes kept (two per session at most), oldest dropped first.
export const ROOM_LIMIT = 512
// What one room is given in all, in characters, before the next turn moves to
// a fresh room by itself: the room holds every rewrite and note sent to it, so
// past this the model reads far more than the caller's transcript. The move
// sends the transcript in full to the new room; the caller sees nothing.
// TABBIT_ROOM_CHARS sets it (50,000 to 2,000,000).
export const ROOM_CHARS = roomCharsOf(process.env)
export function roomCharsOf(env) {
  const n = Number.parseInt(String(env?.TABBIT_ROOM_CHARS ?? "").replace(/[_,]/g, ""), 10)
  return Number.isFinite(n) && n >= 50_000 && n <= 2_000_000 ? n : 800_000
}

const digest = (text) => createHash("sha256").update(text).digest("base64url").slice(0, 22)

// DeepSeek Harness adds a timestamp message ("Time sampled while preparing turn
// N, step M: …") that changes on every step. It says nothing about which
// conversation this is, so it is left out of the match (it is still sent).
const TIME_NOTE = /^Time sampled while preparing turn \d+, step \d+: [^\n]*(?:\n[^\n]*){0,3}$/
export const isTimeNote = (m) => m?.role === "user" && TIME_NOTE.test(String(m.content ?? "").trim())

const keyOf = (m) => digest(`${m.role}\u0000${m.content}`)
const link = (head, m) => digest(`${head}\u0001${keyOf(m)}`)

// chainOf hashes the messages that aren't time notes; `trail` counts the time
// notes after the last of them, which the room has also been sent.
export function chainOf(history) {
  let head = ""
  let count = 0
  let trail = 0
  for (const m of history) {
    if (isTimeNote(m)) {
      trail++
      continue
    }
    head = link(head, m)
    count++
    trail = 0
  }
  return { head, count, trail }
}

// cutOf is the index in `history` just past what `lane` was last sent, or null
// when `history` doesn't start with exactly that.
export function cutOf(lane, history) {
  if (!lane?.count) return null
  let head = ""
  let count = 0
  for (let i = 0; i < history.length; i++) {
    const m = history[i]
    if (isTimeNote(m)) continue
    head = link(head, m)
    count++
    if (count < lane.count) continue
    if (head !== lane.head) return null
    let cut = i + 1
    for (let t = 0; t < (lane.trail ?? 0) && isTimeNote(history[cut]); t++) cut++
    return cut
  }
  return null
}

export function toolHashes(specs) {
  const out = {}
  for (const s of specs) out[s.name] = digest(s.line).slice(0, 12)
  return out
}

// laneOf is what is remembered of a room after a turn: the transcript it was
// sent (as a chain), the answer to hang the next turn off, the tool list it
// knows, how much it has been given, and whether its last turn was cut.
export function laneOf({ room, parent = null, history = [], tools = null, chars = 0, open = false, at = Date.now() }) {
  const { head, count, trail } = chainOf(history)
  return { room, parent, count, head, trail, tools, chars, open, at }
}

// laneFrom reads a remembered entry: a lane, or the {room, parent, sent}
// entry older code kept.
export function laneFrom(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.room !== "string") return null
  if (Array.isArray(entry.sent)) return laneOf({ ...entry, history: entry.sent, tools: entry.tools ?? null })
  return entry
}

// pruneLanes drops what is past its TTL, then the oldest beyond the cap.
export function pruneLanes(map, now = Date.now()) {
  for (const [key, entry] of map) if (now - (entry?.at ?? 0) >= ROOM_TTL) map.delete(key)
  while (map.size > ROOM_LIMIT) map.delete(map.keys().next().value)
}

// serial runs one task per key at a time, in arrival order: a lane's next turn
// waits for the one before it to finish rather than be refused with 409.
// `task` gets a `release` to call when the turn is over (a streamed turn ends
// after `task` has returned). A wait is capped: a turn that never releases
// doesn't hold its lane for good.
export function serial(locks, key, task, { maxWait = 10 * 60 * 1000 } = {}) {
  const before = locks.get(key) ?? Promise.resolve()
  let release
  const done = new Promise((resolve) => (release = resolve))
  const mine = before.then(() => done)
  locks.set(key, mine)
  mine.then(() => {
    if (locks.get(key) === mine) locks.delete(key)
  })
  let released = false
  const releaseOnce = () => {
    if (released) return
    released = true
    release()
  }
  let timer
  const waited = Promise.race([before, new Promise((resolve) => (timer = setTimeout(resolve, maxWait)))]).finally(() => clearTimeout(timer))
  return waited.then(async () => {
    try {
      return await task(releaseOnce)
    } catch (error) {
      releaseOnce()
      throw error
    }
  })
}

// ---- persistence ------------------------------------------------------------

// roomsFile is where the record is kept: TABBIT_ROOMS_FILE, "off" for nowhere,
// else magpie's state directory.
export function roomsFile(env = process.env) {
  const set = env.TABBIT_ROOMS_FILE
  if (set !== undefined) return set === "" || set === "off" ? null : set
  // A test run must not read or write the user's record.
  if (env.NODE_TEST_CONTEXT || env.BUN_TEST || env.NODE_ENV === "test") return null
  const base = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  return path.join(base, "magpie", "tabbit-rooms.json")
}

export function loadRooms(file, map, now = Date.now()) {
  if (!file) return
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return
  }
  for (const [key, entry] of Object.entries(raw?.rooms ?? {})) {
    const lane = laneFrom(entry)
    if (lane && typeof lane.head === "string" && now - (lane.at ?? 0) < ROOM_TTL && !map.has(key)) map.set(key, lane)
  }
}

export function saveRooms(file, map) {
  if (!file) return
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, rooms: Object.fromEntries(map) }), { mode: 0o600 })
    fs.renameSync(tmp, file)
  } catch {
    /* the record is a convenience; a failed write costs one new room */
  }
}
