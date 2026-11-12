import test from "node:test"
import assert from "node:assert/strict"
import { runTurn, uniqueUuid } from "../src/api.mjs"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

for (const site of ["https://web.tabbit.ai", "https://web.tabbit.com"]) {
  test(`runs on ${site} carries unique-uuid`, async () => {
    const seen = [], original = globalThis.fetch
    globalThis.fetch = async (input, init = {}) => { seen.push(new Headers(init.headers ?? {})); return Response.json({ run_id: "r", status: "QUEUED" }) }
    try {
      const creds = { token: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1LTEifQ.sig", header: "token=[REDACTED_VALUE]", site }
      await runTurn(creds, "room-1", { content: "hi", model: "Default" })
      await runTurn(creds, "room-1", { content: "hi", model: "Default" })
      assert.match(seen[0].get("unique-uuid") ?? "", UUID)
      assert.notEqual(seen[0].get("unique-uuid"), seen[1].get("unique-uuid"))
    } finally { globalThis.fetch = original }
  })
}

test("unique-uuid never claims Tabbit is the default browser", () => {
  // Position 5 is the web app's default-browser marker; "1" means "set".
  for (let i = 0; i < 2000; i++) assert.notEqual(uniqueUuid().replace(/-/g, "")[5], "1")
  // Even when the random source lands on the marker's own digit.
  const id = uniqueUuid(Date.now(), () => 1 / 16).replace(/-/g, "")
  assert.notEqual(id[5], "1")
})

test("unique-uuid carries the time the way the web app does", () => {
  const now = 0x6734abcd * 1000
  const id = uniqueUuid(now).replace(/-/g, "")
  const time = [2, 7, 11, 14, 18, 21, 25, 28].map((p) => id[p]).join("")
  assert.equal(time, "6734abcd")
})
