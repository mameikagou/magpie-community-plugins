// Tabbit (web.tabbit.com, and web.tabbit.ai for international accounts) as a
// magpie provider.
//
// The shape is the one every magpie provider plugin has — config, auth,
// provider.models — because the work is a plain HTTP conversation with
// Tabbit, not a browser drive:
//
//   sign-in  →  the `token` cookie (JWT, 7 days) the Tabbit app keeps
//   catalog  →  /proxy/v1/model_config/models
//   a turn   →  create room → POST runs → POST join (SSE)
//
// The one thing a plain OpenAI client can't do is Tabbit's turn shape, so
// loader() hands back a `fetch` that rewrites chat/completions into
// room+runs+join and writes the answer back as OpenAI chunks. That is the
// same trick the WorkBuddy plugin uses for its own protocol, not a sidecar.
//
// Turn history: Tabbit keeps it in the room, so a follow-up inside the same
// magpie session sends only the new messages and hangs them off the previous
// answer's id. A session keeps its room: a retry, a changed tool list or a
// rewritten (compacted, edited) transcript is sent into the same room with a
// note that says so, rather than opening a new room each time — see
// src/rooms.mjs. The session's side requests (no client tools: a title, a
// summary) keep a second room, and each room takes one turn at a time.

import {
  credsOf,
  expiresAt,
  listModels,
  usage as readUsage,
  createRoom,
  runTurn,
  join,
  stop,
  archiveRoom,
  TabbitError,
} from "./src/api.mjs"
import { BOOTSTRAP, NPM, CHAT_BASE, rowsOf, allowedModels } from "./src/models.mjs"
import { turnDeltas, readTurn } from "./src/sse.mjs"
import { splitTurn } from "./src/chunk.mjs"
import {
  ROOM_TTL,
  ROOM_CHARS,
  cutOf,
  isTimeNote,
  lastKeyOf,
  toolHashes,
  laneOf,
  laneFrom,
  pruneLanes,
  serial,
  roomsFile,
  loadRooms,
  saveRooms,
} from "./src/rooms.mjs"
import { desktopSignIn } from "./src/cookie.mjs"
import { checkinOf } from "./src/checkin.mjs"
import {
  OPEN,
  CLOSE,
  partText,
  toolsOf,
  choiceOf,
  toolsKeyOf,
  callText,
  choiceDirective,
  toolPreamble,
  parseToolCalls,
  StreamHold,
} from "./src/toolcall.mjs"

const ID = "tabbit"
const NAME = "Tabbit"
const SESSION = "x-magpie-tabbit-session"
const FREE_ONLY = "freeOnly"

// How many turns the plugin has Tabbit answer at once, across all sessions.
// Separate rooms answer side by side (20 at once, measured); 4 is enough for
// two agent sessions with a side request each, without leaning on the account.
const CONCURRENCY = concurrencyOf(process.env)
function concurrencyOf(env) {
  const n = Number.parseInt(env?.TABBIT_CONCURRENCY ?? "", 10)
  return Number.isFinite(n) && n >= 1 && n <= 16 ? n : 4
}

// Rooms: per magpie session, account and lane, the lane record of
// src/rooms.mjs. Kept in memory and in a small file of hashes, so a restart
// of the plugin host keeps a session in its rooms.
const rooms = new Map()
const locks = new Map()
const roomsPath = roomsFile()
let roomsLoaded = false
function loadOnce() {
  if (roomsLoaded) return
  roomsLoaded = true
  loadRooms(roomsPath, rooms)
}

// pruneRooms drops what is past its TTL and then the oldest beyond the cap.
function pruneRooms(now = Date.now()) {
  pruneLanes(rooms, now)
}

const NOTE_REWRITTEN =
  "[Note from the caller: the conversation was rewritten since the messages above (compacted, edited or restarted). Disregard everything earlier in this room, including any earlier tool list; the complete, current transcript follows and replaces it.]"
const NOTE_RETRY =
  "[Note from the caller: your previous answer to the message below did not reach the caller. Answer it again.]"
const NOTE_INTERRUPTED =
  "[Note from the caller: your last reply in this room was interrupted and never reached the caller; disregard it.]"

// toolsNote tells a room what changed in the client's tool list since the
// room last saw it, instead of resending the whole catalog.
function toolsNote(prev, specs, ch, useTools) {
  const now = useTools ? toolHashes(specs) : null
  if (!prev && !now) return ""
  if (!prev) return `${toolPreamble(specs, ch)}\n\n[Note from the caller: the client tools above are available from now on.]`
  if (!now) return `[Note from the caller: client tools are no longer available in this conversation. Don't write ${OPEN} blocks; answer in plain text.]`
  const removed = Object.keys(prev).filter((n) => !(n in now))
  const changed = specs.filter((s) => prev[s.name] !== now[s.name])
  if (!removed.length && !changed.length) return ""
  const lines = ["[Note from the caller: the client tool list changed.]"]
  if (removed.length) lines.push(`No longer available, don't call: ${removed.map((n) => `\`${n}\``).join(", ")}.`)
  if (changed.length) lines.push(`New or changed tools (these definitions replace earlier ones):\n\n${changed.map((s) => s.line).join("\n\n")}`)
  return lines.join("\n\n")
}

const clean = (v) => (typeof v === "string" ? v.trim() : "")

function sessionOf(headers) {
  try {
    return clean(new Headers(headers).get(SESSION))
  } catch {
    return ""
  }
}

// usesTools is whether a request goes out with its client tools — the same
// test planTurn makes, needed earlier to pick the lane.
function usesTools(body) {
  const specs = toolsOf(body)
  return specs.length > 0 && !choiceOf(body, specs.map((t) => t.name)).off
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener?.("abort", () => (clearTimeout(timer), resolve()), { once: true })
  })
}

// stripModel accepts either the bare id magpie sends the SDK or a
// `tabbit/<id>` spelling, so a route written by hand still resolves.
function stripModel(value) {
  const id = clean(value)
  return id.startsWith(`${ID}/`) ? id.slice(ID.length + 1) : id
}

// contentOf flattens one message's content: a string, or the array of parts
// the OpenAI SDK sends. Only text parts are taken; an image part is named so
// the turn still says something about it.
function contentOf(content) {
  return partText(content)
}

// historyOf is the conversation a room would remember, in order: system
// prompts, user turns, assistant replies (including tool_calls), and tool
// execution results.
function historyOf(messages) {
  const out = []
  const callNames = new Map()
  for (const message of Array.isArray(messages) ? messages : []) {
    const rawRole = message?.role
    if (rawRole === "system" || rawRole === "developer") {
      const content = contentOf(message?.content)
      if (content) out.push({ role: "system", content })
      continue
    }
    if (rawRole === "assistant") {
      const parts = []
      const text = contentOf(message?.content)
      if (text) parts.push(text)
      const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
      for (const c of calls) {
        if (c?.id && c?.function?.name) callNames.set(c.id, c.function.name)
        parts.push(callText(c))
      }
      if (parts.length) out.push({ role: "assistant", content: parts.join("\n"), hasToolCalls: calls.length > 0 })
      continue
    }
    if (rawRole === "tool" || rawRole === "function") {
      const name = clean(message?.name) || callNames.get(message?.tool_call_id) || ""
      const text = contentOf(message?.content)
      const label = `[tool result${name ? ` of ${name}` : ""}${message?.tool_call_id ? ` (${message.tool_call_id})` : ""}]`
      out.push({ role: "tool", content: `${label}\n${text}` })
      continue
    }
    const content = contentOf(message?.content)
    if (content) out.push({ role: "user", content })
  }
  return out
}

// flatten writes a transcript as one prompt. Tabbit's turn takes one
// `content` string, and a fresh room has no history of its own, so the
// transcript is what carries it. When client tools are active, their JSON
// Schemas and `<tool_call>` instructions go at the top of the prompt.
function flatten(history, body = null) {
  const specs = toolsOf(body)
  const ch = choiceOf(body, specs.map((t) => t.name))
  const useTools = specs.length > 0 && !ch.off
  const hasToolTurns = history.some((m) => m.role === "tool" || m.hasToolCalls)

  if (!useTools && !hasToolTurns) {
    const systems = history.filter((m) => m.role === "system").map((m) => m.content)
    const turns = history.filter((m) => m.role !== "system")
    const lastUser = [...turns].reverse().find((m) => m.role === "user")
    const before = lastUser ? turns.slice(0, turns.lastIndexOf(lastUser)) : turns
    const lines = []
    if (systems.length) lines.push(`[system]\n${systems.join("\n\n")}`)
    for (const m of before) lines.push(`${m.role === "assistant" ? "assistant" : "user"}: ${m.content}`)
    const header = lines.length ? "Below is the conversation so far. Answer the final user message, continuing it.\n\n" : ""
    return header + lines.join("\n\n") + (lines.length ? "\n\n" : "") + `user: ${lastUser?.content ?? ""}`
  }

  const systems = history.filter((m) => m.role === "system").map((m) => m.content.trim()).filter(Boolean)
  const turns = history.filter((m) => m.role !== "system")
  const blocks = []
  if (useTools) blocks.push(toolPreamble(specs, ch))
  if (systems.length) blocks.push(`# System Instructions\n\n${systems.join("\n\n")}`)
  if (body?.response_format?.type === "json_object" || body?.response_format?.type === "json_schema") {
    const schema = body.response_format.json_schema?.schema
    blocks.push(`Answer with one valid JSON value and nothing else.${schema ? ` JSON Schema: ${JSON.stringify(schema)}` : ""}`)
  }
  const renderedTurns = turns.map((m) => {
    if (m.role === "tool") return m.content
    return `[${m.role}]\n${m.content}`
  })
  blocks.push(`# Conversation\n\n${renderedTurns.join("\n\n")}`)
  blocks.push(
    useTools
      ? `Write the next assistant response now (without the [assistant] prefix). Remember: if you need to call a tool, end with ${OPEN}{"name": "<tool>", "arguments": {...}}${CLOSE} and wait for the caller's [tool result].`
      : "Write the next assistant response now, without the [assistant] prefix.",
  )
  return blocks.join("\n\n")
}

// formatContinuation formats the messages a room hasn't seen yet — the ones
// after what it was last sent — so a room continues across user follow-ups
// and tool loops without the system prompt and tool catalog again. A leading
// assistant message is the room's own last reply and is skipped.
function formatContinuation(added, useTools, ch) {
  const tail = added[0]?.role === "assistant" ? added.slice(1) : added
  if (!tail.length) return null
  if (!useTools && tail.every((m) => m.role === "user")) return tail.map((m) => m.content).join("\n\n")
  if (useTools && tail.length === 1 && tail[0].role === "user") return tail[0].content + choiceDirective(ch)

  const parts = tail.map((m) => (m.role === "tool" ? m.content : `[${m.role}]\n${m.content}`))
  const hasResults = tail.some((m) => m.role === "tool")
  parts.push(
    !useTools
      ? "Write the next assistant response now, without the [assistant] prefix."
      : hasResults
        ? `Continue from the tool result(s) above. If another tool call is needed, emit ${OPEN}{"name": "<tool>", "arguments": {...}}${CLOSE} with no trailing prose; otherwise answer the user directly.${choiceDirective(ch)}`
        : `Write the next assistant response now. If you need a tool, end with ${OPEN}{"name": "<tool>", "arguments": {...}}${CLOSE}.${choiceDirective(ch)}`,
  )
  return parts.join("\n\n")
}

// planTurn decides what one request sends into the lane's room (`entry`, the
// lane record of src/rooms.mjs, or nothing yet). In order:
//   - the transcript continues what the room was sent: only the new messages;
//   - it is exactly what the room was last sent: a retry, with a note and the
//     last message again;
//   - compacted (older messages folded into summaries by a context manager):
//     only what follows the last assistant reply — the room has the originals;
//   - anything else (another conversation): a note that the
//     transcript was rewritten, then the whole of it — still the same room;
//   - no room yet, or the room is full: a new room with the whole transcript.
// A changed tool list is a note in front of whatever goes into an old room.
function planTurn(entry, messages, now = Date.now(), body = null) {
  if (typeof now === "object" && now !== null) {
    body = now
    now = Date.now()
  }
  const history = historyOf(messages)
  const specs = toolsOf(body)
  const ch = choiceOf(body, specs.map((t) => t.name))
  const useTools = specs.length > 0 && !ch.off
  const toolsKey = toolsKeyOf(body)
  const allowedNames = useTools ? new Set(specs.map((s) => s.name)) : null
  const tools = useTools ? toolHashes(specs) : null
  const base = { history, toolsKey, useTools, allowedNames, tools }

  const lane = laneFrom(entry)
  const live = lane && !lane.broken && now - (lane.at ?? 0) < ROOM_TTL ? lane : null
  // A room left with part of a long prompt in it (a later part failed) holds
  // text the caller never saw answered; it is retired, not continued.
  if (lane?.broken && now - (lane.at ?? 0) < ROOM_TTL) return fresh(base, history, body, "full", lane.room)
  // A room that has been given ROOM_CHARS in all is left behind: whatever
  // this turn would have sent into it goes to a new room as the whole
  // transcript instead, the same as a first turn.
  const fits = (text) => (live.chars ?? 0) + text.length <= ROOM_CHARS
  const into = (content, mode) => {
    const note = toolsNote(live.tools ?? null, specs, ch, useTools)
    const text = note ? `${note}\n\n${content}` : content
    if (!fits(text)) return null
    return { ...base, room: live.room, parent: live.parent ?? null, content: text, chars: (live.chars ?? 0) + text.length, mode }
  }

  if (live) {
    const cut = cutOf(live, history)
    if (cut !== null) {
      const added = history.slice(cut)
      const real = added.filter((m) => !isTimeNote(m))
      if (real.some((m) => m.role !== "assistant")) {
        const delta = formatContinuation(added, useTools, ch)
        if (delta) {
          const plan = into(live.open ? `${NOTE_INTERRUPTED}\n\n${delta}` : delta, "continue")
          if (plan) return plan
          return fresh(base, history, body, "full", live.room)
        }
      } else if (!real.length) {
        // Nothing new: the caller asks again (its last answer failed or was
        // cut). The room has the question already; say so and ask again.
        let last = -1
        for (let i = history.length - 1; i >= 0; i--)
          if (history[i].role === "assistant") {
            last = i
            break
          }
        const again = formatContinuation(history.slice(last + 1).filter((m) => m.role !== "system"), useTools, ch)
        if (again) {
          const plan = into(`${NOTE_RETRY}\n\n${again}`, "retry")
          if (plan) return plan
          return fresh(base, history, body, "full", live.room)
        }
      }
    }
    // Compacted: the caller (a context manager such as billion-context) folded
    // older messages into summaries, so the prefix no longer matches — but the
    // room still holds the originals. Send only what follows the last
    // assistant reply (the room's own), exactly as a normal continuation.
    const compacted = compactedTail(history, useTools, ch, live)
    if (compacted) {
      const plan = into(live.open ? `${NOTE_INTERRUPTED}\n\n${compacted}` : compacted, "compacted")
      if (plan) return plan
      return fresh(base, history, body, "full", live.room)
    }
    // Rewritten: the same room, told to start over from the transcript. If
    // the room had client tools and this request has none, say so too: the
    // flattened transcript carries no tool protocol to override the old one.
    const off = !useTools && live.tools ? toolsNote(live.tools, specs, ch, useTools) : ""
    const content = `${off ? `${off}\n\n` : ""}${NOTE_REWRITTEN}\n\n${flatten(history, body)}`
    if (fits(content)) {
      return { ...base, room: live.room, parent: live.parent ?? null, content, chars: (live.chars ?? 0) + content.length, mode: "rewrite" }
    }
    return fresh(base, history, body, "full", live.room)
  }
  return fresh(base, history, body, "new")
}

// compactedTail is what follows the transcript's last assistant message, when
// that reply is the room's own — the message right before it is the last one
// the room was sent (`lane.last`) — and something new follows it (a user
// message or tool result); null otherwise: another conversation, another
// model's turns, or a reply the room never gave, which get the full resend.
// TABBIT_COMPACTION=rewrite turns this off (the old full resend).
function compactedTail(history, useTools, ch, lane) {
  if (process.env.TABBIT_COMPACTION === "rewrite") return null
  let last = -1
  for (let i = history.length - 1; i >= 0; i--)
    if (history[i].role === "assistant") {
      last = i
      break
    }
  if (last < 0) return null
  if (lane?.last && lastKeyOf(history, last) !== lane.last) return null
  const tail = history.slice(last + 1).filter((m) => m.role !== "system")
  if (!tail.some((m) => !isTimeNote(m))) return null
  return formatContinuation(tail, useTools, ch)
}

// fresh is a turn into a new room: the whole transcript. `mode` is "new" for
// a session's first room and "full" when an old room was given enough; then
// `retired` is that old room, archived once the new one has answered.
function fresh(base, history, body, mode, retired = null) {
  const content = flatten(history, body)
  return { ...base, room: null, parent: null, content, chars: content.length, mode, retired }
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? "").length / 4))
}

// Tabbit names a cycle with bare dates ("2026.11.03"), in Beijing time.
function parseCycleDate(value) {
  const m = clean(value).match(/^(\d{4})\.(\d{2})\.(\d{2})$/)
  if (!m) return undefined
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function usageWindow(data) {
  const pct = Number.parseFloat(String(data?.usage_percentage ?? "").replace("%", ""))
  const start = parseCycleDate(data?.current_cycle_start)
  const end = parseCycleDate(data?.current_cycle_end)
  return {
    name: "Cycle usage",
    ...(Number.isFinite(pct) ? { used: Math.max(0, pct) } : {}),
    amount: Number.isFinite(pct) ? pct : 0,
    limit: 100,
    unit: "%",
    display: Number.isFinite(pct) ? `${pct.toFixed(2)}%` : "",
    ...(start ? { startsAt: start } : {}),
    ...(end ? { resetsAt: end } : {}),
  }
}

function freeOnly() {
  try {
    return globalThis.magpie?.option?.(ID, FREE_ONLY) === true
  } catch {
    return false
  }
}

// ---- the wire between magpie and Tabbit ---------------------------------

function chunkLine(model, delta, { finish = null, usage = null } = {}) {
  const chunk = {
    id: `chatcmpl-tabbit-${Date.now().toString(36)}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  }
  if (usage) chunk.usage = usage
  return `data: ${JSON.stringify(chunk)}\n\n`
}

function completionBody(model, text, reasoning, usage, { calls = [] } = {}) {
  const hasCalls = Array.isArray(calls) && calls.length > 0
  return {
    id: `chatcmpl-tabbit-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || (hasCalls ? null : ""),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(hasCalls ? { tool_calls: calls } : {}),
        },
        finish_reason: hasCalls ? "tool_calls" : "stop",
      },
    ],
    ...(usage ? { usage } : {}),
  }
}

// Statuses magpie reads for itself: a 400/404 is the request's fault, a 429
// says wait, 401 marks the account, and 403 with code 492 is a paywall the
// account survives. Anything else is a gateway failure and goes as 502.
const PASS_THROUGH = new Set([400, 401, 403, 404, 429])

// errorResponse carries the sign-in state magpie reads (`X-Magpie-Sign-In:
// expired` on a 401) and Tabbit's `retry-after` on a 429.
function errorResponse(error) {
  const status = Number.isFinite(error?.status) ? error.status : 500
  const headers = { "content-type": "application/json" }
  if (error?.signIn) headers["x-magpie-sign-in"] = error.signIn
  if (error?.retryAfter) headers["retry-after"] = String(error.retryAfter)
  const passthrough = PASS_THROUGH.has(status)
  return new Response(
    JSON.stringify({
      error: {
        message: error?.message ?? String(error),
        type: error?.signIn === "expired" ? "authentication_error" : "tabbit_error",
        ...(error?.code !== undefined ? { code: error.code } : {}),
      },
    }),
    { status: passthrough ? status : 502, headers },
  )
}

// streamTurn writes one joined turn out as OpenAI chunk lines. `onCancel`
// ends the run at Tabbit when the client goes away early: the turn keeps
// producing for a while otherwise, and the account pays for it. `onClose`
// runs once when the stream is over, however it ended.
function streamTurn(response, { model, plan, body, signal, onEnd, onCancel, onClose }) {
  const encoder = new TextEncoder()
  const stopReading = new AbortController()
  let stopped = false
  const stopOnce = () => {
    if (stopped) return
    stopped = true
    try {
      onCancel?.()
    } catch {
      /* stopping is best effort */
    }
  }
  let closed = false
  const closeOnce = () => {
    if (closed) return
    closed = true
    try {
      onClose?.()
    } catch {
      /* bookkeeping only */
    }
  }
  return new ReadableStream({
    async start(controller) {
      const send = (text) => {
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          /* the reader went away */
        }
      }
      // magpie's way of giving up is aborting the request's signal; stop the
      // run then too, not only when the reader is cancelled.
      if (signal) {
        if (signal.aborted) stopOnce()
        else signal.addEventListener("abort", stopOnce, { once: true })
      }
      let text = ""
      const hold = new StreamHold({ enabled: Boolean(plan?.useTools), allowedNames: plan?.allowedNames ?? null })
      try {
        send(chunkLine(model, { role: "assistant", content: "" }))
        for await (const part of turnDeltas(response, {
          signal: signal ? AbortSignal.any([signal, stopReading.signal]) : stopReading.signal,
          onTimeout: stopOnce,
        })) {
          if (part.type === "thinking" && part.value) send(chunkLine(model, { reasoning_content: part.value }))
          else if (part.type === "text" && part.value) {
            text += part.value
            const safe = hold.push(part.value)
            if (safe) send(chunkLine(model, { content: safe }))
          } else if (part.type === "end") {
            if (part.state.failed) throw new TabbitError(`Tabbit's turn failed: ${JSON.stringify(part.state.failed).slice(0, 300)}`)
            if (part.state.truncated) {
              // The turn never finished. An empty or half answer reported as
              // `stop` would be taken as the answer; this says it is not.
              send(`data: ${JSON.stringify({ error: { message: "Tabbit's turn ended without finishing", type: "tabbit_error" } })}\n\n`)
              send("data: [DONE]\n\n")
              return
            }
            const { content: tail, calls } = hold.finish()
            if (tail) send(chunkLine(model, { content: tail }))
            if (calls.length) {
              send(
                chunkLine(model, {
                  tool_calls: calls.map((c, index) => ({ index, id: c.id, type: "function", function: c.function })),
                }),
              )
            }
            const usage = body?.stream_options?.include_usage
              ? {
                  prompt_tokens: estimateTokens(plan.content),
                  completion_tokens: estimateTokens(text),
                  total_tokens: estimateTokens(plan.content) + estimateTokens(text),
                }
              : null
            send(chunkLine(model, {}, { finish: calls.length ? "tool_calls" : "stop", usage }))
            send("data: [DONE]\n\n")
            onEnd?.(part.state)
          }
        }
      } catch (error) {
        // A stream that has already started can't change its status, so the
        // failure goes out as an event and the stream ends.
        send(`data: ${JSON.stringify({ error: { message: error?.message ?? String(error), type: "tabbit_error" } })}\n\n`)
        send("data: [DONE]\n\n")
      } finally {
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        closeOnce()
      }
    },
    async cancel() {
      // Stop reading the stream, then tell Tabbit to end the run: leaving it
      // producing would spend the account's allowance for an answer nobody
      // will read.
      stopReading.abort(new Error("cancelled"))
      stopOnce()
      signal?.removeEventListener?.("abort", stopOnce)
      closeOnce()
    },
  })
}

// ---- the plugin ---------------------------------------------------------

function createPlugin() {
  async function chat(getAuth, request) {
    const body = await request.json()
    const model = stripModel(body?.model)
    if (!model) throw new TabbitError("tabbit: no model was named", { status: 400 })
    const messages = Array.isArray(body?.messages) ? body.messages : []
    if (!messages.length) throw new TabbitError("tabbit: no messages were sent", { status: 400 })

    const auth = await getAuth()
    const creds = credsOf(auth)
    if (!creds) throw Object.assign(new TabbitError("tabbit: not signed in", { status: 401 }), { signIn: "expired" })

    const session = sessionOf(request.headers)
    // The account is part of the key: magpie may send a session's next request
    // on another account, and continuing that account's room would either be
    // refused (403 → marked signed out) or answered by someone else's room.
    // The lane is too: the agent's requests (with client tools) and the side
    // requests of the same session (a title, a summary) keep a room each.
    loadOnce()
    const account = creds.uid || "?"
    const lane = usesTools(body) ? "tools" : "plain"
    const roomKey = session ? `${account}\u0000${session}\u0000${lane}` : ""
    const run = (task) => (roomKey ? serial(locks, roomKey, task) : task(() => {}))
    return await run((release) => turn(release))

    async function turn(release) {
      const plan = planTurn(rooms.get(roomKey), messages, Date.now(), body)

      // A prompt past Tabbit's per-turn cap goes in as several turns of the
      // same room (see src/chunk.mjs). Each earlier part is read to its end:
      // a room takes one run at a time (a part stopped early left the next
      // one refused with 409 "already has an active room run").
      // `lastParent` follows the parts as they are answered, so a turn cut
      // later hangs off the last answer the room really gave.
      let lastParent = plan.parent
      let counted = null
      const start = async (roomId, parentMessageId) => {
        const parts = splitTurn(plan.content)
        let parent = parentMessageId
        lastParent = parent
        // Each part costs its header and the room's "ACK" on top of the text
        // (counted once per content: a second try of the same text doesn't add).
        if (parts.length > 1 && counted !== plan.content) {
          counted = plan.content
          plan.chars += parts.reduce((n, p) => n + p.length, 0) - plan.content.length + (parts.length - 1) * 8
        }
        for (const [i, part] of parts.slice(0, -1).entries()) {
          try {
            await runTurn(creds, roomId, { content: part, model, parentMessageId: parent, signal: request.signal })
          } catch (error) {
            throw Object.assign(error, { partsSent: i })
          }
          try {
            const state = await readTurn(await join(creds, roomId, { signal: request.signal }), {
              signal: request.signal,
              onTimeout: () => stop(creds, roomId),
            })
            if (state?.failed) throw new TabbitError(`Tabbit's turn failed on part of a long prompt: ${JSON.stringify(state.failed).slice(0, 300)}`)
            if (!state?.completed || !state.assistantMessageId) throw new TabbitError("Tabbit's turn was cut before it finished, on part of a long prompt")
            parent = lastParent = state.assistantMessageId
          } catch (error) {
            throw Object.assign(error, { partsSent: i + 1 })
          }
        }
        try {
          await runTurn(creds, roomId, { content: parts[parts.length - 1], model, parentMessageId: parent, signal: request.signal })
        } catch (error) {
          throw Object.assign(error, { partsSent: parts.length - 1 })
        }
        return await join(creds, roomId, { signal: request.signal })
      }
      // Some parts went into the room and the rest didn't: the room now holds
      // half a prompt. Mark its lane so the next turn retires it to a new room
      // instead of sending those parts in again on top of them.
      const broke = (roomId, error) => {
        if (!(error?.partsSent > 0) || !roomKey) return
        stop(creds, roomId).catch(() => {})
        remember(roomKey, { room: roomId, parent: lastParent, history: [], tools: plan.tools, chars: plan.chars, open: true, broken: true })
      }

      let response = null
      if (plan.room) {
        try {
          response = await start(plan.room, plan.parent)
        } catch (error) {
          broke(plan.room, error)
          if (error?.status === 409 && error.partsSent === 0) {
            // The room is still answering something: a turn this plugin gave
            // up on, or one sent from elsewhere. End it and go again once.
            await stop(creds, plan.room)
            await sleep(2000, request.signal)
            try {
              response = await start(plan.room, plan.parent)
            } catch (again) {
              broke(plan.room, again)
              if (![400, 404, 409].includes(again?.status)) throw again
            }
          } else if (![400, 404, 409].includes(error?.status)) throw error
          if (!response) {
            // A room that has been reset, dropped or stays busy is replaced,
            // not reported: the transcript flattens the way a new room needs.
            // Whatever it may still be answering is stopped first.
            stop(creds, plan.room).catch(() => {})
            plan.content = flatten(plan.history, body)
            plan.chars = plan.content.length
            plan.retired = plan.room
            plan.room = null
            plan.parent = null
          }
        }
      }
      let room = plan.room
      if (!room) {
        room = await createRoom(creds, request.signal)
        try {
          response = await start(room, null)
        } catch (error) {
          broke(room, error)
          throw error
        }
      }

      // After a turn the lane is what the room now holds. A turn that went
      // out but whose answer never came back is remembered as `open`: the
      // room has the question and a half answer the caller never saw.
      const keep = (parent, open) => {
        remember(roomKey, { room, parent, history: plan.history, tools: plan.tools, chars: plan.chars, open })
        // The room this session outgrew is archived once the new one has
        // answered, so it stays readable in the sidebar but marked as done.
        if (!open && plan.retired && plan.retired !== room) {
          const old = plan.retired
          plan.retired = null
          archiveRoom(creds, old).catch(() => {})
        }
      }

      if (body?.stream === true) {
        let ended = false
        const stream = streamTurn(response, {
          model,
          plan,
          body,
          signal: request.signal,
          onEnd: (state) => {
            ended = true
            keep(state?.assistantMessageId ?? null, false)
          },
          onCancel: () => stop(creds, room),
          onClose: () => {
            if (!ended) keep(lastParent, true)
            release()
          },
        })
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
        })
      }

      // Not streaming: drain the turn, then answer once.
      let text = ""
      let reasoning = ""
      let assistantId = null
      let ended = false
      try {
        for await (const part of turnDeltas(response, { signal: request.signal, onTimeout: () => stop(creds, room) })) {
          if (part.type === "text") text += part.value
          else if (part.type === "thinking") reasoning += part.value
          else if (part.type === "end") {
            assistantId = part.state.assistantMessageId
            if (part.state.failed) throw new TabbitError(`Tabbit's turn failed: ${JSON.stringify(part.state.failed).slice(0, 300)}`)
            if (part.state.truncated) throw new TabbitError("Tabbit's turn was cut before it finished")
            ended = true
          }
        }
      } finally {
        keep(ended ? assistantId : lastParent, !ended)
        release()
      }
      const parsed = plan.useTools ? parseToolCalls(text, { allowedNames: plan.allowedNames }) : { text, calls: [] }
      return Response.json(
        completionBody(
          model,
          parsed.text,
          reasoning,
          {
            prompt_tokens: estimateTokens(plan.content),
            completion_tokens: estimateTokens(text),
            total_tokens: estimateTokens(plan.content) + estimateTokens(text),
          },
          { calls: parsed.calls },
        ),
      )
    }
  }

  function remember(key, lane) {
    if (!key) return
    pruneRooms()
    rooms.delete(key)
    rooms.set(key, laneOf(lane))
    saveRooms(roomsPath, rooms)
  }


  return {
    async config(cfg) {
      cfg.provider ??= {}
      cfg.provider[ID] ??= {}
      const provider = cfg.provider[ID]
      provider.name ??= NAME
      provider.npm ??= NPM
      provider.api ??= CHAT_BASE
      // The bootstrap rows fill in whatever the user hasn't pinned.
      provider.models = { ...rowsOf(BOOTSTRAP), ...(provider.models ?? {}) }
    },

    // The session id the room is keyed by, when magpie names one.
    "chat.headers": async (input, output) => {
      const providerId = input?.model?.providerID ?? input?.provider?.info?.id
      if (providerId !== ID || !input?.sessionID) return
      output.headers[SESSION] = String(input.sessionID).slice(0, 128)
    },

    provider: {
      id: ID,
      async models(provider, { auth } = {}) {
        const creds = credsOf(auth)
        if (!creds) return provider.models
        let catalog
        try {
          catalog = await listModels(creds)
        } catch (error) {
          if (error?.signIn) throw error
          return provider.models
        }
        const allow = allowedModels()
        const rows = rowsOf(catalog, { freeOnly: freeOnly(), only: allow })
        if (allow) return rows
        return Object.keys(rows).length ? rows : provider.models
      },
    },

    auth: {
      provider: ID,
      maxConcurrency: CONCURRENCY,
      async loader(getAuth) {
        return {
          baseURL: CHAT_BASE,
          apiKey: "",
          async fetch(input, init) {
            const request = new Request(input, init)
            try {
              const path = new URL(request.url).pathname
              if (request.method !== "POST" || !path.endsWith("/chat/completions")) {
                throw new TabbitError(`tabbit: ${request.method} ${path} is not served by this provider`, { status: 404 })
              }
              return await chat(getAuth, request)
            } catch (error) {
              return errorResponse(error)
            }
          },
        }
      },

      options: [
        {
          key: FREE_ONLY,
          label: "Free models only",
          description:
            "Lists only the models Tabbit serves at no credit cost (free_unlimited and free_metered). A premium-only model is left out instead of failing at the turn.",
          labels: { zh: "仅免费模型" },
          descriptions: {
            zh: "只列出 Tabbit 不消耗额度的模型（free_unlimited 与 free_metered）。付费专属的模型直接不出现，而不是等请求时被 403 拒绝。",
          },
          filtersModels: true,
        },
      ],

      methods: [
        {
          type: "oauth",
          label: "Read the Tabbit app's sign-in (macOS)",
          authorize: () => ({
            url: "",
            instructions: "Reads the sign-in the Tabbit app already has on this computer. When macOS asks for Keychain access, click Allow. Nothing is copied by hand.",
            method: "auto",
            callback: async () => {
              try {
                const sign = await desktopSignIn()
                return { type: "success", key: sign.key, accountId: sign.userId, metadata: { userId: sign.userId, source: "desktop", site: sign.site } }
              } catch (error) {
                return { type: "failed", error: String(error?.message ?? error) }
              }
            },
          }),
        },
        {
          type: "api",
          label: "Paste Tabbit token (the browser's `token` cookie)",
          placeholder: "eyJhbGci…",
        },
      ],

      // The daily sign-in: magpie runs it once a day per account while the
      // user has it on, and draws the outcome on the account's card. A throw
      // is a failure magpie retries on its own backoff; a returned "failed"
      // waits for its longer one. Tabbit's sign-in is the desktop pet's
      // activity, and today it is the only scene the service takes.
      async checkin(getAuth) {
        const auth = await getAuth()
        const creds = credsOf(auth)
        if (!creds) return { outcome: "failed", message: "tabbit: not signed in" }
        return await checkinOf(creds)
      },

      async usage(getAuth) {
        const auth = await getAuth()
        const creds = credsOf(auth)
        if (!creds) return { windows: [] }
        try {
          const data = await readUsage(creds)
          const level = clean(data?.member_level)
          return {
            plan: level ? `Tabbit ${level}` : "Tabbit",
            windows: [usageWindow(data)],
            ...(auth?.metadata?.userId || creds.uid ? { accountId: auth?.metadata?.userId || creds.uid } : {}),
            ...(expiresAt(auth) ? { expiresAt: expiresAt(auth) } : {}),
          }
        } catch (error) {
          return { error: error?.message ?? String(error), signIn: error?.signIn, windows: [] }
        }
      },
    },
  }
}

// The plugin function. magpie calls every exported function as a plugin, so
// the internals stay reachable through `_internal` only.
export const TabbitPlugin = async () => createPlugin()

export const _internal = {
  createPlugin,
  planTurn,
  historyOf,
  flatten,
  stripModel,
  contentOf,
  usageWindow,
  parseCycleDate,
  estimateTokens,
  pruneRooms,
  rooms,
  locks,
  formatContinuation,
  CONCURRENCY,
}
