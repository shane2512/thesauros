// Deterministic injection heuristics (SECURITY §3 L5, SERV_REASONING §4.4). These run first and a
// hit alone is enough to flag: the SERV classifier may only ADD signals, never clear them.

export type HeuristicHit = { signal: string; detail?: string };

export type HeuristicResult = { hit: boolean; signals: string[] };

/** Address / destination shapes. A 40-hex string is never legitimate in a memo we show a model (I4). */
const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;
const ENS = /\b[a-z0-9-]{3,}\.(eth|xyz|crypto|lens)\b/i;
const URL = /\b(https?:\/\/|www\.)\S+/i;

const OVERRIDE =
  /\b(ignore|disregard|forget|override|bypass|skip)\b[^.]{0,40}\b(previous|prior|earlier|above|all|any|the)\b[^.]{0,20}\b(instruction|instructions|rule|rules|prompt|policy|directive|constraint|restriction|guardrail)/i;
const ROLE_CLAIM =
  /\b(you are now|from now on|new instructions?|updated instructions?|your (real|true|actual) (task|goal|purpose)|act as|pretend to be|roleplay|jailbreak|dan mode|developer mode)\b/i;
const AI_ADDRESSED =
  /\b(as an? (ai|assistant|agent|language model)|dear (ai|agent|assistant)|system prompt|your system prompt|hey (ai|agent|assistant))\b/i;
const SECRECY =
  /\b(do not|don'?t|never)\b[^.]{0,20}\b(tell|inform|notify|alert|mention|log|report)\b/i;
const ROLE_MARKER =
  /(<\|?im_(start|end)\|?>|<\/?(system|assistant|user|tool|function|untrusted_data|instructions?)[ >]|\[\/?INST\]|\[\/?SYS\]|(?:^|[\s("[{·])(system|assistant|developer|tool_call)\s*:|###\s*(instruction|system)|\{\{|«system»)/im;

/** Instructions aimed at Thesauros's own machinery rather than at the money (found by corpus A04). */
const DISABLE_CONTROL =
  /\b(skip|bypass|disable|turn off|ignore|no need for|already (passed|checked|approved|verified))\b[^.]{0,40}\b(verifier|verification|shadow|check|checks|review|approval|screening|classifier|policy|limit|limits|rule|rules|guardrail)/i;

const VALUE_VERB =
  /\b(send|transfer|pay|approve|withdraw|migrate|forward|route|sweep|redirect|wire)\b/i;
const TOTALITY =
  /\b(all|entire|everything|every (cent|dollar|token)|max|maximum|full balance|whole balance|10x|100x|1000x|as much as possible)\b/i;
const AUTHORITY =
  /\b(ceo|cfo|founder|owner here|board|legal|compliance|security team|support team|admin|thesauros (team|support)|official)\b/i;
const URGENCY =
  /\b(urgent|urgently|immediately|asap|right away|before (the )?(audit|deadline|close)|last chance|within \d+ (minutes?|hours?)|emergency)\b/i;
const NEW_DESTINATION =
  /\b(new|updated|changed|different|backup|alternate|migration|treasury migration)\b[^.]{0,30}\b(wallet|address|account|recipient|destination|vault|custodian)\b/i;

const BASE64 = /\b[A-Za-z0-9+/]{40,}={0,2}\b/;
const LONG_HEX = /\b(0x)?[0-9a-fA-F]{60,}\b/;
const MORSE = /(?:[.\-/]{2,}\s+){4,}/;
/** Two or more digit/symbol substitutions inside one word AND a leet-spelled money/command word. */
const LEET_WORD = /[a-z0134@$]*[0134@$][a-z0134@$]*[0134@$][a-z0134@$]*/i;
const LEET_TERM = /(1gn0r3|d1sr3g4rd|s3nd|tr4nsf3r|w1thdr4w|4ll|w4ll3t|p4y|fund5|m0n3y|urg3nt)/i;
const CYRILLIC_OR_GREEK = /[Ѐ-ӿͰ-Ͽ]/;
const LATIN = /[A-Za-z]/;
const MARKDOWN_IMG = /!\[[^\]]*\]\([^)]*\)|<img\b|<script\b|<iframe\b|<!--/i;

/** Same intent, other languages (a translation wrapper is a classic bypass). */
const MULTILINGUAL =
  /\b(ignora|ignorez|ignoriere|negeer|игнорируй|忽略|無視|تجاهل|envía todo|envoyez tout|sende alles|отправь все|转账全部|全額送金|أرسل كل|instrucciones previas|instructions précédentes|vorherige anweisungen|предыдущие инструкции|以前の指示|上述指令)\b/i;

type Rule = { signal: string; test: (t: string) => boolean };

const RULES: readonly Rule[] = [
  // The sanitizer may already have replaced the address with its placeholder; both are the signal.
  { signal: 'address_like', test: (t) => ADDRESS.test(t) || t.includes('[redacted-address]') },
  { signal: 'ens_or_domain_name', test: (t) => ENS.test(t) },
  { signal: 'url', test: (t) => URL.test(t) },
  { signal: 'instruction_override', test: (t) => OVERRIDE.test(t) },
  { signal: 'role_reassignment', test: (t) => ROLE_CLAIM.test(t) },
  { signal: 'addresses_the_model', test: (t) => AI_ADDRESSED.test(t) },
  { signal: 'requests_secrecy', test: (t) => SECRECY.test(t) },
  { signal: 'fake_role_marker', test: (t) => ROLE_MARKER.test(t) },
  { signal: 'disable_control', test: (t) => DISABLE_CONTROL.test(t) },
  { signal: 'value_move_totality', test: (t) => VALUE_VERB.test(t) && TOTALITY.test(t) },
  { signal: 'new_destination', test: (t) => NEW_DESTINATION.test(t) },
  {
    signal: 'authority_claim',
    test: (t) => AUTHORITY.test(t) && (VALUE_VERB.test(t) || URGENCY.test(t)),
  },
  { signal: 'urgency_pressure', test: (t) => URGENCY.test(t) && VALUE_VERB.test(t) },
  { signal: 'base64_blob', test: (t) => BASE64.test(t) },
  { signal: 'long_hex_blob', test: (t) => LONG_HEX.test(t) },
  { signal: 'morse_code', test: (t) => MORSE.test(t) },
  { signal: 'leetspeak', test: (t) => LEET_WORD.test(t) && LEET_TERM.test(t) },
  { signal: 'mixed_script_homoglyph', test: (t) => CYRILLIC_OR_GREEK.test(t) && LATIN.test(t) },
  { signal: 'markup_injection', test: (t) => MARKDOWN_IMG.test(t) },
  { signal: 'multilingual_override', test: (t) => MULTILINGUAL.test(t) },
];

const rot13 = (t: string) =>
  t.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });

/** Decode obvious encodings so the same rules can run on the payload, not just the wrapper. */
function decodings(text: string): { how: string; text: string }[] {
  const out: { how: string; text: string }[] = [];
  const b64 = BASE64.exec(text)?.[0];
  if (b64) {
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      // Only useful if it decoded to readable text rather than binary noise.
      if (/^[\x20-\x7E\s]{8,}$/.test(decoded)) out.push({ how: 'base64', text: decoded });
    } catch {
      /* not base64 after all */
    }
  }
  const un13 = rot13(text);
  if (un13 !== text) out.push({ how: 'rot13', text: un13 });
  const reversed = [...text].reverse().join('');
  out.push({ how: 'reversed', text: reversed });
  return out;
}

/**
 * Screen one piece of untrusted text. `extraSignals` carries what the sanitizer already had to
 * remove (zero-width characters, markup) — evidence that survives the cleaning.
 */
export function screenText(text: string, extraSignals: readonly string[] = []): HeuristicResult {
  const signals = new Set<string>();
  for (const s of extraSignals) {
    if (s === 'address_redacted') signals.add('address_like');
    if (s === 'opaque_token_redacted') signals.add('base64_blob');
    if (s === 'invisible_chars_removed') signals.add('zero_width_chars');
    if (s === 'markup_escaped') signals.add('markup_injection');
    // `normalized` is deliberately NOT a signal: NFKC also rewrites innocent things (a non-breaking
    // space, an "fi" ligature) and flagging those would cost benign memos for no security gain.
    // Homoglyph attacks survive NFKC as mixed scripts and are caught by their own rule.
  }
  for (const r of RULES) if (r.test(text)) signals.add(r.signal);
  for (const d of decodings(text)) {
    for (const r of RULES) {
      // The wrapper rules (blob shapes) would trivially re-fire on the decoded form.
      if (r.signal.endsWith('_blob') || r.signal === 'mixed_script_homoglyph') continue;
      if (r.test(d.text)) signals.add(`${r.signal}_via_${d.how}`);
    }
  }
  return { hit: signals.size > 0, signals: [...signals].sort() };
}

/** Screen a whole context's untrusted block. Signals are prefixed with the item id for the audit. */
export function screenItems(
  items: readonly { id: string; text: string; signals?: readonly string[] }[],
): HeuristicResult {
  const all: string[] = [];
  for (const item of items) {
    const r = screenText(item.text, item.signals ?? []);
    for (const s of r.signals) all.push(`${item.id}:${s}`);
  }
  return { hit: all.length > 0, signals: all };
}
