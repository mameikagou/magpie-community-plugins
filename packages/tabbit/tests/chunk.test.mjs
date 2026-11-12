// The per-turn cap: a long prompt is cut into parts no longer than the cap,
// and the plugin sends them as consecutive turns of one room.

import test from "node:test"
import assert from "node:assert/strict"
import { splitTurn, partCharsOf, TURN_LIMIT, DEFAULT_PART_CHARS } from "../src/chunk.mjs"
import { TabbitPlugin, _internal } from "../index.mjs"
import { toolSpecOf, typeOf } from "../src/toolcall.mjs"

test("a prompt under the cap is sent as it is", () => {
  assert.deepEqual(splitTurn("hello"), ["hello"])
  const exact = "x".repeat(DEFAULT_PART_CHARS)
  assert.deepEqual(splitTurn(exact), [exact])
})

test("a long prompt is cut into parts that each fit, and lose nothing", () => {
  const paragraphs = Array.from({ length: 900 }, (_, i) => `Paragraph ${i}: ${"lorem ipsum ".repeat(8)}`)
  const text = paragraphs.join("\n\n")
  const parts = splitTurn(text, 18_000)
  assert.ok(parts.length >= 5)
  for (const p of parts) assert.ok(p.length <= 18_000, `part of ${p.length}`)
  const bodies = parts.map((p) => p.slice(p.indexOf("]\n\n") + 3))
  assert.equal(bodies.join(""), text)
  assert.match(parts[0], /^\[Part 1\/\d+ .*"ACK"/)
  assert.match(parts.at(-1), new RegExp(`^\\[Part ${parts.length}/${parts.length} — the message is now complete`))
  // cut on paragraph breaks, not mid-word
  for (const b of bodies.slice(0, -1)) assert.ok(b.endsWith("\n\n"))
})

test("a prompt with no break points is still cut under the cap, never inside a surrogate pair", () => {
  const text = "😀".repeat(30_000)
  const parts = splitTurn(text, 10_000)
  for (const p of parts) {
    assert.ok(p.length <= 10_000)
    assert.doesNotMatch(p, /[\ud800-\udbff]$/)
  }
  assert.equal(parts.map((p) => p.slice(p.indexOf("]\n\n") + 3)).join(""), text)
})

test("TABBIT_PART_CHARS is honoured inside sane bounds", () => {
  assert.equal(partCharsOf({ TABBIT_PART_CHARS: "12000" }), 12000)
  assert.equal(partCharsOf({ TABBIT_PART_CHARS: "50000" }), DEFAULT_PART_CHARS)
  assert.equal(partCharsOf({ TABBIT_PART_CHARS: "nope" }), DEFAULT_PART_CHARS)
  assert.ok(DEFAULT_PART_CHARS < TURN_LIMIT)
})

test("tool arguments are written as a compact signature with every description kept", () => {
  const spec = toolSpecOf({
    type: "function",
    function: {
      name: "bash",
      description: "Run a command.",
      parameters: {
        type: "object",
        $schema: "http://json-schema.org/draft-07/schema#",
        additionalProperties: false,
        properties: {
          command: { type: "string", description: "The command to run." },
          timeoutMs: { type: "number", description: "Timeout in ms.", minimum: 1 },
          mode: { type: "string", enum: ["fast", "slow"], default: "fast" },
          files: { type: "array", items: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
          "odd-key": { type: ["string", "null"] },
        },
        required: ["command"],
      },
    },
  })
  assert.equal(spec.name, "bash")
  assert.match(spec.line, /^## bash\nRun a command\.\nArguments: \{/)
  assert.match(spec.line, /\n {2}command: string \/\/ The command to run\./)
  assert.match(spec.line, /timeoutMs\?: number \/\/ Timeout in ms\.; min 1/)
  assert.match(spec.line, /mode\?: "fast" \| "slow" \/\/ default "fast"/)
  assert.match(spec.line, /files\?: \{\n {4}path: string\n {2}\}\[\]/)
  assert.match(spec.line, /"odd-key"\?: string \| null/)
  assert.doesNotMatch(spec.line, /\$schema|additionalProperties/)
  assert.equal(typeOf({ type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } }), "(string | number)[]")
  assert.equal(typeOf({}), "any")
})

// A Tabbit stub that records each run's content and answers every join with a
// finished turn whose assistant id is numbered, so the parent chain shows.
function installFetch() {
  const runs = []
  let joins = 0
  const original = globalThis.fetch
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url)
    const method = (init.method ?? "GET").toUpperCase()
    if (url.pathname === "/api/v3/chat/rooms" && method === "POST") return Response.json({ room_id: "room-long" })
    if (url.pathname.endsWith("/runs") && method === "POST") {
      const body = JSON.parse(init.body)
      runs.push({ room: url.pathname.split("/")[5], content: body.input_payload.content, parent: body.input_payload.parent_message_id })
      if (body.input_payload.content.length > TURN_LIMIT) return new Response('{"code":492}', { status: 429 })
      return Response.json({ run_id: "run", status: "QUEUED" })
    }
    if (url.pathname.endsWith("/join") && method === "POST") {
      joins += 1
      const id = `a${joins}`
      const last = runs.at(-1).content
      const reply = /— more parts follow/.test(last) ? "ACK" : "done"
      const sse = [
        frame("assistant_message_started", { payload: { run_id: "r", message_id: id } }),
        frame("assistant_message_delta", { payload: { chunk_payload: { content: reply } } }),
        frame("assistant_message_finished", { payload: { message_id: id } }),
        frame("run_completed", { payload: {} }),
      ].join("")
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })
    }
    return new Response("not found", { status: 404 })
  }
  return { runs, restore: () => (globalThis.fetch = original) }
}

test("a request past the cap goes in as consecutive turns of one room, and only the last is answered", async () => {
  const { runs, restore } = installFetch()
  try {
    _internal.rooms.clear()
    const hooks = await TabbitPlugin()
    const loader = await hooks.auth.loader(async () => ({ type: "api", key: "h.eyJzdWIiOiJ1LTEifQ.s", metadata: { userId: "u-1" } }))
    const system = Array.from({ length: 700 }, (_, i) => `Rule ${i}: ${"be careful ".repeat(10)}`).join("\n")
    const res = await loader.fetch(`${loader.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-magpie-tabbit-session": "long" },
      body: JSON.stringify({ model: "Gemini-4-Carbon", stream: false, messages: [{ role: "system", content: system }, { role: "user", content: "hi" }] }),
    })
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.choices[0].message.content, "done")
    assert.ok(runs.length >= 4)
    for (const r of runs) {
      assert.equal(r.room, "room-long")
      assert.ok(r.content.length <= TURN_LIMIT)
    }
    // each part hangs off the previous part's answer
    assert.deepEqual(runs.map((r) => r.parent), [null, ...runs.slice(1).map((_, i) => `a${i + 1}`)])
    // and the follow-up continues the room off the last answer
    const next = await loader.fetch(`${loader.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-magpie-tabbit-session": "long" },
      body: JSON.stringify({
        model: "Gemini-4-Carbon",
        stream: false,
        messages: [{ role: "system", content: system }, { role: "user", content: "hi" }, { role: "assistant", content: "done" }, { role: "user", content: "again" }],
      }),
    })
    assert.equal(next.status, 200)
    assert.equal(runs.at(-1).content, "again")
    assert.equal(runs.at(-1).parent, `a${runs.length - 1}`)
  } finally {
    restore()
  }
})
