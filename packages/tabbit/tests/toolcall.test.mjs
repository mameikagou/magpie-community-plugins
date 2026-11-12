import test from "node:test"
import assert from "node:assert/strict"
import { TabbitPlugin, _internal } from "../index.mjs"
import { heldFrom, parseToolCalls, StreamHold } from "../src/toolcall.mjs"

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const auth = { type: "api", key: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.sig", metadata: { userId: "u-1" } }

const READ_TOOL = {
  type: "function",
  function: {
    name: "read",
    description: "Read a local file",
    parameters: {
      type: "object",
      properties: { file_path: { type: "string" } },
      required: ["file_path"],
    },
  },
}

const BASH_TOOL = {
  type: "function",
  function: {
    name: "bash",
    description: "Execute bash command",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
}

test("parseToolCalls extracts single and parallel <tool_call> blocks and preserves leading prose", () => {
  const raw = [
    "Let me inspect the file first.",
    '<tool_call>{"name":"read","arguments":{"file_path":"/tmp/a.txt"}}</tool_call>',
    '<tool_call>{"name":"bash","arguments":{"command":"ls -la"}}</tool_call>',
  ].join("\n")

  const res = parseToolCalls(raw, {
    allowedNames: new Set(["read", "bash"]),
    newId: (() => {
      let i = 0
      return () => `call_${++i}`
    })(),
  })

  assert.equal(res.text, "Let me inspect the file first.")
  assert.equal(res.calls.length, 2)
  assert.deepEqual(res.calls[0], {
    id: "call_1",
    type: "function",
    function: { name: "read", arguments: '{"file_path":"/tmp/a.txt"}' },
  })
  assert.deepEqual(res.calls[1], {
    id: "call_2",
    type: "function",
    function: { name: "bash", arguments: '{"command":"ls -la"}' },
  })
})

test("parseToolCalls handles GLM <arg_key> format and strips empty markdown fences", () => {
  const raw = '```xml\n<tool_call>read<arg_key>file_path</arg_key><arg_value>/etc/hosts</arg_value></tool_call>\n```'
  const res = parseToolCalls(raw, { allowedNames: new Set(["read"]) })
  assert.equal(res.text, "")
  assert.equal(res.calls.length, 1)
  assert.equal(res.calls[0].function.name, "read")
  assert.equal(res.calls[0].function.arguments, '{"file_path":"/etc/hosts"}')
})

test("StreamHold holds partial <tool_call> tags across tiny chunks without leaking markup", () => {
  const hold = new StreamHold({ enabled: true, allowedNames: new Set(["read"]) })
  const chunks = ["好，我先看一下：", "<tool_", 'call>{"name":"read","argu', 'ments":{"file_path":"README.md"}}</tool_call>']
  let streamed = ""
  for (const ch of chunks) streamed += hold.push(ch)
  assert.equal(streamed, "好，我先看一下：")
  const fin = hold.finish(() => "call_fixed")
  assert.equal(fin.content, "")
  assert.equal(fin.calls.length, 1)
  assert.equal(fin.calls[0].id, "call_fixed")
  assert.equal(fin.calls[0].function.name, "read")
  assert.equal(fin.calls[0].function.arguments, '{"file_path":"README.md"}')
  assert.equal(heldFrom("abc<tool"), 3)
})

test("end-to-end streaming and room continuation across tool execution loop", async () => {
  const runs = []
  let turnCount = 0
  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url)
    const method = (init.method ?? "GET").toUpperCase()
    if (url.pathname === "/api/v3/chat/rooms" && method === "POST") {
      return Response.json({ room_id: "room-tc-1", chat_session_id: "room-tc-1" })
    }
    if (url.pathname.endsWith("/runs") && method === "POST") {
      runs.push(JSON.parse(init.body))
      return Response.json({ run_id: `run-${runs.length}`, status: "QUEUED" })
    }
    if (url.pathname.endsWith("/join") && method === "POST") {
      turnCount++
      const sseBody =
        turnCount === 1
          ? [
              frame("assistant_message_started", { payload: { run_id: "r1", message_id: "msg-a1" } }),
              frame("assistant_message_delta", { payload: { chunk_payload: { content: "先读文件\n<tool_" } } }),
              frame("assistant_message_delta", {
                payload: { chunk_payload: { content: 'call>{"name":"read","arguments":{"file_path":"package.json"}}</tool_call>' } },
              }),
              frame("assistant_message_finished", { payload: { message_id: "msg-a1" } }),
              frame("run_completed", { payload: { status: "COMPLETED" } }),
            ].join("")
          : [
              frame("assistant_message_started", { payload: { run_id: "r2", message_id: "msg-a2" } }),
              frame("assistant_message_delta", { payload: { chunk_payload: { content: "包名是 @magpie-community/opencode-tabbit-auth。" } } }),
              frame("assistant_message_finished", { payload: { message_id: "msg-a2" } }),
              frame("run_completed", { payload: { status: "COMPLETED" } }),
            ].join("")
      const enc = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(sseBody))
            c.close()
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )
    }
    return new Response("not found", { status: 404 })
  }

  try {
    _internal.rooms.clear()
    const hooks = await TabbitPlugin()
    const loader = await hooks.auth.loader(async () => auth)

    // Turn 1: User asks to read package.json with tools attached (streaming)
    const res1 = await loader.fetch(`${loader.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-magpie-tabbit-session": "sess-tool-loop" },
      body: JSON.stringify({
        model: "Gemini-4-Carbon",
        stream: true,
        tools: [READ_TOOL, BASH_TOOL],
        messages: [
          { role: "system", content: "You are DSH." },
          { role: "user", content: "帮我读一下 package.json 的 name" },
        ],
      }),
    })

    const sseText1 = await res1.text()
    assert.doesNotMatch(sseText1, /<tool_call>/, "raw <tool_call> tag must not leak into streamed content")
    assert.match(sseText1, /"tool_calls":\[\{"index":0/)
    assert.match(sseText1, /"finish_reason":"tool_calls"/)
    assert.match(runs[0].input_payload.content, /# Available Client Tools/)
    assert.match(runs[0].input_payload.content, /## read/)

    // Extract generated call id from SSE
    const callChunkLine = sseText1
      .split("\n")
      .find((l) => l.startsWith("data: ") && l.includes('"tool_calls"'))
    const callChunk = JSON.parse(callChunkLine.slice(6))
    const callId = callChunk.choices[0].delta.tool_calls[0].id

    // Turn 2: Caller sends back assistant.tool_calls + role:"tool" result in SAME session
    const res2 = await loader.fetch(`${loader.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-magpie-tabbit-session": "sess-tool-loop" },
      body: JSON.stringify({
        model: "Gemini-4-Carbon",
        stream: false,
        tools: [READ_TOOL, BASH_TOOL],
        messages: [
          { role: "system", content: "You are DSH." },
          { role: "user", content: "帮我读一下 package.json 的 name" },
          {
            role: "assistant",
            content: "先读文件",
            tool_calls: [{ id: callId, type: "function", function: { name: "read", arguments: '{"file_path":"package.json"}' } }],
          },
          {
            role: "tool",
            tool_call_id: callId,
            content: '{"name":"@magpie-community/opencode-tabbit-auth"}',
          },
        ],
      }),
    })

    const json2 = await res2.json()
    assert.equal(json2.choices[0].finish_reason, "stop")
    assert.match(json2.choices[0].message.content, /@magpie-community\/opencode-tabbit-auth/)

    // Verify Turn 2 reused the SAME room (`msg-a1` parent) and sent ONLY the delta tool result!
    assert.equal(runs.length, 2)
    assert.equal(runs[1].input_payload.parent_message_id, "msg-a1")
    assert.doesNotMatch(runs[1].input_payload.content, /# Available Client Tools/, "continuation turn must not resend full tool catalog")
    assert.match(runs[1].input_payload.content, /\[tool result of read/)
  } finally {
    globalThis.fetch = original
    _internal.rooms.clear()
  }
})
