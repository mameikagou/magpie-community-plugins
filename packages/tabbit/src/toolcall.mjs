// Prompt-based client tool calling for Tabbit rooms.
//
// Tabbit's /api/v3/chat/rooms/<room>/runs endpoint accepts a single `content`
// string and has no native `tools` parameter. When a caller (DSH, Codex,
// Claude Code, OpenCode) declares `tools`, we serialize the schemas into the
// room's opening prompt, instruct the model to emit
// `<tool_call>{"name": "<tool>", "arguments": {...}}</tool_call>` blocks when
// invoking tools, and parse those blocks back into standard OpenAI `tool_calls`
// (both streamed and non-streamed).

export const OPEN = "<tool_call>"
export const CLOSE = "</tool_call>"

export function partText(content) {
  if (content == null) return ""
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return typeof content === "object" ? JSON.stringify(content) : String(content)
  const parts = []
  for (const part of content) {
    if (typeof part === "string") parts.push(part)
    else if (part?.type === "text" || part?.type === "input_text" || typeof part?.text === "string") parts.push(part.text ?? "")
    else if (part?.type === "image_url" || part?.type === "input_image" || part?.type === "image") parts.push("[image]")
    else if (part?.type === "file" || part?.type === "input_file") parts.push("[file]")
  }
  return parts.join("\n")
}

// Tool arguments are written as a TypeScript-like signature, not the raw JSON
// Schema: a turn is capped at 20,000 characters (see chunk.mjs), and an
// agent's few dozen schemas, stringified, are most of a first request. The
// signature keeps what the model needs to call a tool — names, types,
// optionality, enums, defaults and every description — and drops the JSON
// punctuation and the schema keywords that carry nothing for it.
const IDENT = /^[A-Za-z_$][\w$]*$/
const keyOf = (k) => (IDENT.test(k) ? k : JSON.stringify(k))
const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").trim()

export function typeOf(schema, depth = 0, indent = 0) {
  if (schema === true || schema == null) return "any"
  if (schema === false) return "never"
  if (typeof schema !== "object") return "any"
  if (depth > 8) return "any"
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(" | ") || "never"
  const union = schema.oneOf ?? schema.anyOf
  if (Array.isArray(union)) return union.map((s) => typeOf(s, depth + 1, indent)).join(" | ") || "any"
  if (Array.isArray(schema.allOf)) return schema.allOf.map((s) => typeOf(s, depth + 1, indent)).join(" & ") || "any"
  const t = schema.type
  if (Array.isArray(t)) return t.map((one) => typeOf({ ...schema, type: one }, depth + 1, indent)).join(" | ")
  if (t === "array" || (!t && schema.items)) {
    const inner = typeOf(schema.items, depth + 1, indent)
    return /[|&\s]/.test(inner) && !inner.startsWith("{") ? `(${inner})[]` : `${inner}[]`
  }
  if (t === "object" || (!t && schema.properties)) return objectOf(schema, depth, indent)
  if (t === "integer") return "integer"
  if (t === "string" || t === "number" || t === "boolean" || t === "null") return t
  return "any"
}

function objectOf(schema, depth, indent) {
  const props = schema.properties && typeof schema.properties === "object" ? schema.properties : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const fields = Object.entries(props).map(([k, s]) => {
    const notes = []
    const desc = oneLine(s?.description)
    if (desc) notes.push(desc)
    if (s && typeof s === "object" && s.default !== undefined) notes.push(`default ${JSON.stringify(s.default)}`)
    for (const [kw, label] of [["minimum", "min"], ["maximum", "max"], ["minLength", "minLength"], ["maxLength", "maxLength"], ["minItems", "minItems"], ["maxItems", "maxItems"], ["pattern", "pattern"], ["format", "format"]]) {
      if (s && typeof s === "object" && s[kw] !== undefined) notes.push(`${label} ${typeof s[kw] === "string" ? s[kw] : JSON.stringify(s[kw])}`)
    }
    return `${keyOf(k)}${required.has(k) ? "" : "?"}: ${typeOf(s, depth + 1, indent + 1)}${notes.length ? ` // ${notes.join("; ")}` : ""}`
  })
  const extra = schema.additionalProperties
  if (extra && typeof extra === "object") fields.push(`[key: string]: ${typeOf(extra, depth + 1, indent + 1)}`)
  else if (extra === true && !fields.length) fields.push("[key: string]: any")
  if (!fields.length) return "{}"
  const pad = "  ".repeat(indent + 1)
  return `{\n${fields.map((f) => pad + f).join("\n")}\n${"  ".repeat(indent)}}`
}

export function toolSpecOf(tool) {
  const fn = tool?.function ?? tool
  const name = typeof fn?.name === "string" ? fn.name.trim() : ""
  if (!name) return null
  const desc = String(fn.description ?? "").trim()
  const params = fn.parameters ?? fn.input_schema ?? { type: "object", properties: {} }
  const line = `## ${name}\n${desc ? `${desc}\n` : ""}Arguments: ${typeOf(params)}`
  return { name, line }
}

export function toolsOf(body) {
  return (Array.isArray(body?.tools) ? body.tools : []).map(toolSpecOf).filter(Boolean)
}

export function choiceOf(body, names = []) {
  const c = body?.tool_choice
  if (c === "none" || c?.type === "none") return { off: true }
  if (c === "required" || c?.type === "any" || c?.type === "required") return { must: true }
  const name = c?.function?.name ?? c?.name
  if (name && (!names.length || names.includes(name))) return { must: true, only: name }
  return {}
}

export function toolsKeyOf(body) {
  const specs = toolsOf(body)
  const ch = choiceOf(body, specs.map((t) => t.name))
  if (!specs.length || ch.off) return ""
  return JSON.stringify(specs.map((t) => t.line))
}

export function callText(call) {
  const fn = call?.function ?? call
  const name = fn?.name ?? ""
  let args = fn?.arguments ?? {}
  if (typeof args === "string") {
    try {
      args = JSON.parse(args || "{}")
    } catch {
      /* keep raw string if unparseable */
    }
  }
  return `${OPEN}${JSON.stringify({ name, arguments: args })}${CLOSE}`
}

export function choiceDirective(ch) {
  if (ch?.only) return `\n\n[tool_choice: You MUST call the tool "${ch.only}" in this turn using ${OPEN}...${CLOSE}.]`
  if (ch?.must) return `\n\n[tool_choice: You MUST call at least one tool in this turn using ${OPEN}...${CLOSE}.]`
  return ""
}

export function toolPreamble(specs, ch = {}) {
  const namesList = specs.map((s) => `\`${s.name}\``).join(", ")
  const lines = [
    "[CRITICAL HARNESS PROTOCOL — TEXT-BRIDGED CLIENT TOOLS]",
    "You are serving an external local coding/agent harness over a text-stream RPC bridge. Even though your native platform environment only registers server-side browser/widget tools (`web_fetch`, `browser_control`, `show_widget`, etc.), the caller's local machine runs a proxy that intercepts literal `<tool_call>...</tool_call>` XML tags from your text reply, executes those client tools (`bash`, `read`, `edit`, `write`, `glob`, `grep`, etc.) locally on the user's computer, and returns `[tool result ...]` in the next message.",
    `1. NEVER refuse a client tool (${namesList}) by claiming it is missing from your native toolset, and NEVER invoke your native platform tools unless explicitly asked.`,
    `2. To invoke any client tool listed below, write literal plain-text ${OPEN}...${CLOSE} block(s) at the very end of your text response using valid JSON (properly escape quotes and newlines inside strings):\n${OPEN}{"name": "<tool_name>", "arguments": { ... }}${CLOSE}`,
    `3. You may emit multiple ${OPEN}...${CLOSE} blocks in one turn for parallel calls, with NO markdown code fences (\`\`\`) and NO text after the last ${CLOSE}. Stop immediately and wait for the caller's \`[tool result ...]\` turn — NEVER guess or fabricate tool output. When no tool is needed, reply normally without ${OPEN}.`,
  ]
  if (ch?.only) lines.push(`IMPORTANT: For this turn you MUST emit a ${OPEN}...${CLOSE} block calling "${ch.only}".`)
  else if (ch?.must) lines.push(`IMPORTANT: For this turn you MUST emit at least one ${OPEN}...${CLOSE} block.`)
  lines.push(`# Available Client Tools\n\nEach tool's arguments are written as a TypeScript-style object type: \`?\` marks an optional field, \`//\` starts that field's description. Send them as a JSON object.\n\n${specs.map((s) => s.line).join("\n\n")}`)
  return lines.join("\n\n")
}

// heldFrom returns the index in `text` from which streaming output must be
// held back: either the start of the first `<tool_call>` (or fenced
// ````xml\n<tool_call>`) or a trailing partial prefix of `<tool_call>`.
export function heldFrom(text) {
  const fenced = text.search(/```(?:xml|json|tool_call)?\s*<tool_call>/i)
  if (fenced >= 0) return fenced
  const at = text.indexOf(OPEN)
  if (at >= 0) return at
  // Also hold trailing partial markdown fence or `<tool_call` prefix
  const fenceTail = text.match(/```(?:xml|json|tool_call)?\s*<[a-z_]*$/i)
  if (fenceTail) return fenceTail.index
  for (let n = Math.min(OPEN.length - 1, text.length); n > 0; n--) {
    if (OPEN.startsWith(text.slice(-n))) return text.length - n
  }
  return text.length
}

function repairLooseJSON(str) {
  // Handle common minor LLM JSON slips such as trailing commas before } or ]
  return str.replace(/,\s*([}\]])/g, "$1")
}

export function parseCall(raw, allowedNames = null) {
  let s = String(raw ?? "")
    .trim()
    .replace(/^```(?:json|xml|tool_call)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
  if (!s) return null

  // Support GLM-style <tool_call>name<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>
  if (!s.startsWith("{") && !s.startsWith("[") && s.includes("<arg_key>")) {
    const firstTag = s.indexOf("<arg_key>")
    const glmName = s.slice(0, firstTag).trim()
    if (glmName && (!allowedNames || allowedNames.has(glmName))) {
      const argsObj = {}
      const re = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g
      let m
      while ((m = re.exec(s)) !== null) {
        const k = m[1].trim()
        const rawVal = m[2].trim()
        try {
          argsObj[k] = JSON.parse(rawVal)
        } catch {
          argsObj[k] = rawVal
        }
      }
      return { name: glmName, arguments: JSON.stringify(argsObj) }
    }
  }

  let v = null
  for (const candidate of [s, repairLooseJSON(s)]) {
    try {
      v = JSON.parse(candidate)
      break
    } catch {
      /* try next */
    }
  }
  if (!v) return null
  if (Array.isArray(v)) {
    const list = v.map((item) => parseCallObject(item, allowedNames)).filter(Boolean)
    return list.length ? list : null
  }
  return parseCallObject(v, allowedNames)
}

function parseCallObject(v, allowedNames) {
  if (!v || typeof v !== "object") return null
  const name = v.name ?? v.function?.name ?? v.tool ?? v.tool_name
  if (typeof name !== "string" || !name.trim()) return null
  const cleanName = name.trim()
  if (allowedNames && allowedNames.size > 0 && !allowedNames.has(cleanName)) return null
  let args = v.arguments ?? v.parameters ?? v.input ?? v.args ?? v.function?.arguments ?? {}
  if (typeof args === "string") {
    try {
      args = JSON.parse(args)
    } catch {
      /* keep string */
    }
  }
  return {
    name: cleanName,
    arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
  }
}

// parseToolCalls splits a finished assistant text into visible `text` and
// OpenAI `calls`. Unparseable or unknown-tool `<tool_call>` blocks stay intact
// in `text` so nothing written by the model is silently lost.
export function parseToolCalls(
  text,
  {
    allowedNames = null,
    newId = () => `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
  } = {},
) {
  const src = String(text ?? "")
  const calls = []
  let rest = ""
  let i = 0
  while (i < src.length) {
    const at = src.indexOf(OPEN, i)
    if (at < 0) {
      rest += src.slice(i)
      break
    }
    rest += src.slice(i, at)
    const closeAt = src.indexOf(CLOSE, at + OPEN.length)
    // Also tolerate DeepSeek DSML accidental close tags if </tool_call> was omitted
    const dsmlClose = closeAt < 0 ? src.search(/<\/[|｜]+DSML[|｜]+invoke>?/) : -1
    const end = closeAt >= 0 ? closeAt : dsmlClose >= 0 ? dsmlClose : src.length
    const afterEnd =
      closeAt >= 0
        ? closeAt + CLOSE.length
        : dsmlClose >= 0
          ? dsmlClose + (src.slice(dsmlClose).match(/^<\/[|｜]+DSML[|｜]+invoke>?/)?.[0]?.length ?? 0)
          : src.length
    const raw = src.slice(at + OPEN.length, end)
    const parsed = parseCall(raw, allowedNames)
    if (parsed) {
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const fn of items) {
        calls.push({ id: newId(), type: "function", function: fn })
      }
    } else {
      rest += src.slice(at, afterEnd)
    }
    i = afterEnd
  }
  const cleaned = calls.length ? rest.replace(/```(?:xml|json|tool_call)?\s*```/gi, "") : rest
  return {
    text: calls.length ? cleaned.trim() : rest,
    raw: cleaned,
    calls,
  }
}

// StreamHold buffers streaming text from the first `<tool_call>` (or partial
// tag suffix) onward, emitting safe text deltas immediately and converting
// held `<tool_call>` blocks into OpenAI `tool_calls` chunks at turn end.
export class StreamHold {
  constructor({ enabled = false, allowedNames = null } = {}) {
    this.enabled = enabled
    this.allowedNames = allowedNames
    this.text = ""
    this.shown = 0
  }

  push(delta) {
    this.text += delta
    if (!this.enabled) {
      this.shown = this.text.length
      return delta
    }
    const upto = heldFrom(this.text)
    if (upto > this.shown) {
      const out = this.text.slice(this.shown, upto)
      this.shown = upto
      return out
    }
    return ""
  }

  finish(newId) {
    if (!this.enabled) {
      return { content: this.text.slice(this.shown), calls: [] }
    }
    const parsed = parseToolCalls(this.text, { allowedNames: this.allowedNames, newId })
    const alreadyShown = this.text.slice(0, this.shown)
    let tail = parsed.raw.startsWith(alreadyShown) ? parsed.raw.slice(alreadyShown.length) : ""
    if (parsed.calls.length) {
      tail = tail.trim() ? tail.trimEnd() : ""
    }
    return { content: tail, calls: parsed.calls }
  }
}
