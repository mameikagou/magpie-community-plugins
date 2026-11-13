import test from "node:test"
import assert from "node:assert/strict"
import { runTurn, uniqueUuid, isDefaultBrowser } from "../src/api.mjs"

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

test("unique-uuid says not-default when Tabbit is not the default browser", () => {
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

test("unique-uuid says default when Tabbit is the default browser, as the app does", () => {
  for (let i = 0; i < 50; i++) assert.equal(uniqueUuid(Date.now(), Math.random, true).replace(/-/g, "")[5], "1")
})

test("TABBIT_DEFAULT_BROWSER overrides what the system says", () => {
  assert.equal(isDefaultBrowser({ TABBIT_DEFAULT_BROWSER: "1" }), true)
  assert.equal(isDefaultBrowser({ TABBIT_DEFAULT_BROWSER: "0" }), false)
})

test("macOS LSHandlers with nested LSHandlerPreferredVersions are read whole", async () => {
  const { defaultInHandlers } = await import("../src/api.mjs")
  const h = (scheme, id) => `    {\n        LSHandlerPreferredVersions =         {\n            LSHandlerRoleAll = "-";\n        };\n        LSHandlerRoleAll = "${id}";\n        LSHandlerURLScheme = ${scheme};\n    }`
  assert.equal(defaultInHandlers(`(\n${h("http", "com.google.chrome")},\n${h("https", "ai.tabbit.browser")}\n)`), true)
  assert.equal(defaultInHandlers(`(\n${h("https", "com.google.chrome")},\n${h("mailto", "ai.tabbit.browser")}\n)`), false)
})
