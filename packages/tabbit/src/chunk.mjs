// Tabbit refuses a turn whose `content` is longer than 20,000 characters.
//
// The web app checks it before sending (`plainText.length > 2e4` → "too-long"),
// and the server enforces the same line: on web.tabbit.ai a turn of 19,970
// characters is queued and one of 20,900 comes back as HTTP 429 code 492
// ("Welcome to Tabbit Browser…"), the same answer its sign-in gate gives. The
// cap counts characters, not bytes: 19,800 CJK characters (≈59 KB of JSON)
// were accepted. An agent's first request — system prompt plus a few dozen
// tool definitions — is far past it.
//
// A longer prompt is therefore sent as several turns in the same room: every
// part but the last asks the model to only acknowledge it, and the last part
// asks for the answer. Measured: three parts of ~18k characters in one room,
// and the last turn answered with facts that were only in parts 1 and 2.

export const TURN_LIMIT = 20_000
// Room under the cap for the part header and for any counting difference
// between the server and String#length (surrogate pairs, line endings).
export const DEFAULT_PART_CHARS = 18_000

export function partCharsOf(env = process.env) {
  const n = Number(env?.TABBIT_PART_CHARS)
  if (Number.isFinite(n) && n >= 2_000 && n <= TURN_LIMIT - 500) return Math.floor(n)
  return DEFAULT_PART_CHARS
}

const headOf = (i, n) =>
  i < n
    ? `[Part ${i}/${n} of one long message — more parts follow. Do not act on it yet; reply with only "ACK".]\n\n`
    : `[Part ${n}/${n} — the message is now complete. Act on all ${n} parts together as one message.]\n\n`

// cutAt finds where to end a piece of at most `max` characters: the last
// paragraph break in its second half, else the last line break, else the last
// space, else `max` itself (never inside a surrogate pair).
function cutAt(text, max) {
  if (text.length <= max) return text.length
  const floor = Math.floor(max / 2)
  for (const sep of ["\n\n", "\n", " "]) {
    const at = text.lastIndexOf(sep, max - sep.length)
    if (at >= floor) return at + sep.length
  }
  let at = max
  const code = text.charCodeAt(at - 1)
  if (code >= 0xd800 && code <= 0xdbff) at -= 1
  return at
}

// splitTurn cuts `content` into turns no longer than `max` characters each,
// headers included. A content that fits is returned as is, without a header.
export function splitTurn(content, max = partCharsOf()) {
  const text = String(content ?? "")
  if (text.length <= max) return [text]
  // The header's length depends on the part count, so cut with room for the
  // longest header the count could need, and recount if the count grows.
  let n = Math.ceil(text.length / max) + 1
  for (;;) {
    const budget = max - Math.max(headOf(1, n).length, headOf(n, n).length)
    const pieces = []
    let rest = text
    while (rest.length) {
      const at = cutAt(rest, budget)
      pieces.push(rest.slice(0, at))
      rest = rest.slice(at)
    }
    if (pieces.length <= n) {
      const total = pieces.length
      return pieces.map((piece, i) => headOf(i + 1, total) + piece)
    }
    n = pieces.length
  }
}
