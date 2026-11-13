// Images: an image part becomes a marker in the text, is uploaded the way the
// web app uploads one, and goes with the turn as an `image` reference.

import test from "node:test"
import assert from "node:assert/strict"
import { TabbitPlugin, _internal } from "../index.mjs"
import { sourceOf, keyOf, marked, bytesOf, nameOf, imageLimitOf, collector } from "../src/images.mjs"
import { partText } from "../src/toolcall.mjs"

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const TURN = (id) =>
  [
    frame("assistant_message_started", { payload: { run_id: "r1", message_id: id } }),
    frame("assistant_message_delta", { payload: { chunk_payload: { content: "看到了" } } }),
    frame("assistant_message_finished", { payload: { message_id: id } }),
    frame("run_completed", { payload: { status: "COMPLETED" } }),
  ].join("")

const PNG = "data:image/png;base64," + Buffer.from("fake-png-bytes").toString("base64")
const auth = { type: "api", key: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.sig", metadata: { userId: "u-img" } }

function installFetch() {
  const calls = []
  const original = globalThis.fetch
  let uploads = 0
  let turns = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url)
    const method = (init.method ?? "GET").toUpperCase()
    calls.push({ method, host: url.host, path: url.pathname, headers: new Headers(init.headers ?? {}), body: init.body })
    if (url.pathname === "/api/v3/chat/rooms" && method === "POST") return Response.json({ room_id: "room-img" })
    if (url.pathname === "/proxy/v0/cos/presigned-upload-url") {
      uploads++
      return Response.json({ url: `https://bucket.example/put/${uploads}`, file_id: `f-${uploads}`, download_url: `https://bucket.example/get/${uploads}` })
    }
    if (url.host === "bucket.example" && method === "PUT") return new Response("", { status: 200 })
    if (url.pathname === "/api/v0/cos/complete-upload") return Response.json({ ok: true })
    if (url.pathname.endsWith("/runs")) return Response.json({ run_id: "run-1" })
    if (url.pathname.endsWith("/join")) {
      turns++
      return new Response(TURN(`a${turns}`), { status: 200, headers: { "content-type": "text/event-stream" } })
    }
    return new Response("not found", { status: 404 })
  }
  return { calls, restore: () => (globalThis.fetch = original) }
}

test("sourceOf reads the image part shapes callers send", () => {
  assert.equal(sourceOf({ type: "image_url", image_url: { url: PNG } }), PNG)
  assert.equal(sourceOf({ type: "image_url", image_url: "https://x.test/a.png" }), "https://x.test/a.png")
  assert.equal(sourceOf({ type: "input_image", image_url: PNG }), PNG)
  assert.equal(sourceOf({ type: "image", image: "QUJD", mediaType: "image/jpeg" }), "data:image/jpeg;base64,QUJD")
  assert.equal(sourceOf({ type: "image_url" }), null)
})

test("an image part is a stable marker; without a collector it stays [image]", () => {
  const images = new Map()
  const content = [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: PNG } }]
  const a = partText(content, collector(images))
  const b = partText(content, collector(new Map()))
  assert.equal(a, b)
  assert.equal(a, `看图\n[image ${keyOf(PNG)}]`)
  assert.equal(images.get(keyOf(PNG)), PNG)
  assert.deepEqual(marked(`${a} again ${a}`), [keyOf(PNG)])
  assert.equal(partText(content), "看图\n[image]")
})

test("bytesOf decodes a data: URL", async () => {
  const { bytes, mime } = await bytesOf(PNG)
  assert.equal(mime, "image/png")
  assert.equal(Buffer.from(bytes).toString(), "fake-png-bytes")
  assert.equal(nameOf("img-abc", "image/jpeg"), "img-abc.jpg")
})

test("TABBIT_IMAGES sets how many images go with a turn", () => {
  assert.equal(imageLimitOf({}), 8)
  assert.equal(imageLimitOf({ TABBIT_IMAGES: "0" }), 0)
  assert.equal(imageLimitOf({ TABBIT_IMAGES: "99" }), 8)
})

test("an image is uploaded once and sent as the turn's image reference", async () => {
  const { calls, restore } = installFetch()
  try {
    const hooks = await TabbitPlugin()
    _internal.rooms.clear()
    const loader = await hooks.auth.loader(async () => auth)
    const send = (messages) =>
      loader.fetch(`${loader.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-magpie-tabbit-session": "s-img" },
        body: JSON.stringify({ model: "Gemini-4-Carbon", messages, stream: false }),
      })
    const first = [{ role: "user", content: [{ type: "text", text: "这是什么？" }, { type: "image_url", image_url: { url: PNG } }] }]
    const res = await send(first)
    assert.equal(res.status, 200)

    const presign = calls.filter((c) => c.path === "/proxy/v0/cos/presigned-upload-url")
    assert.equal(presign.length, 1)
    const slot = JSON.parse(presign[0].body)
    assert.equal(slot.file_category, "image")
    assert.equal(slot.content_type, "image/png")
    const put = calls.find((c) => c.host === "bucket.example")
    assert.equal(put.method, "PUT")
    assert.equal(put.headers.get("cookie"), null)
    const done = calls.find((c) => c.path === "/api/v0/cos/complete-upload")
    assert.deepEqual(JSON.parse(done.body), { file_id: "f-1", session_id: "room-img" })

    const runs = calls.filter((c) => c.path.endsWith("/runs"))
    const turn = JSON.parse(runs[0].body).input_payload
    assert.equal(turn.references.length, 1)
    assert.deepEqual(turn.references[0], { type: "image", title: `${keyOf(PNG)}.png`, content: "https://bucket.example/get/1", metadata: { file_id: "f-1" } })
    assert.match(turn.content, /^\[Attached image, in order: img-/)
    assert.match(turn.content, new RegExp(`\\[image ${keyOf(PNG)}\\]`))

    // A follow-up continues the room: the old image is not sent or uploaded again.
    await send([...first, { role: "assistant", content: "看到了" }, { role: "user", content: "颜色呢？" }])
    const runs2 = calls.filter((c) => c.path.endsWith("/runs"))
    const next = JSON.parse(runs2[1].body).input_payload
    assert.equal(next.content, "颜色呢？")
    assert.deepEqual(next.references, [])
    assert.equal(calls.filter((c) => c.path === "/proxy/v0/cos/presigned-upload-url").length, 1)
  } finally {
    restore()
    _internal.rooms.clear()
  }
})
