import { createHash } from 'crypto';

export type IntentLabel =
  | 'action_item'
  | 'decision'
  | 'open_question'
  | 'reference'
  | 'none';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const VALID_LABELS: IntentLabel[] = [
  'action_item',
  'decision',
  'open_question',
  'reference',
  'none',
];

// ─── SHA-256 cache (text hash → intent) ──────────────────────────────────────
const cache = new Map<string, IntentLabel>();

// ─── Regex classifier ─────────────────────────────────────────────────────────

const TODO_RE = /^(todo|action item|task)\s*[:]/i;
const IMPERATIVE_RE =
  /^(fix|add|update|remove|create|write|review|implement|deploy|check|test|make|send|schedule|complete|finish|set up|setup|prepare|define|discuss|decide|clarify|confirm|follow up)\b/i;
const QUESTION_RE = /\?\s*$/;
const DECISION_RE =
  /\b(decided|we('ll| will) go with|agreed|going with|decision:|will use|we('ll| will) use|we('re| are) going with|we('re| are) using)\b/i;
const REFERENCE_RE = /https?:\/\/\S+|\[ref\]/i;

function regexClassify(text: string): IntentLabel | null {
  if (TODO_RE.test(text) || IMPERATIVE_RE.test(text)) return 'action_item';
  if (QUESTION_RE.test(text)) return 'open_question';
  if (DECISION_RE.test(text)) return 'decision';
  if (REFERENCE_RE.test(text)) return 'reference';
  return null; // ambiguous — let Groq decide
}

// ─── Groq classifier ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You classify sticky note text from a collaborative whiteboard session.
Respond with EXACTLY ONE of these labels — nothing else, no punctuation, no explanation:
action_item   (a task, to-do, or action)
decision      (a resolved choice or agreement)
open_question (a question that needs answering)
reference     (a URL, link, or citation)
none          (everything else)`;

async function groqClassify(text: string): Promise<IntentLabel> {
  const apiKey = process.env['GROQ_API_KEY'];
  if (!apiKey) {
    console.warn('[classifier] GROQ_API_KEY not set — defaulting to none');
    return 'none';
  }

  let res: Response;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, 500) },
        ],
        temperature: 0,
        max_tokens: 10,
      }),
    });
  } catch (err) {
    console.error('[classifier] Groq fetch error:', err);
    return 'none';
  }

  if (!res.ok) {
    console.error(`[classifier] Groq HTTP ${res.status}:`, await res.text());
    return 'none';
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = json.choices[0]?.message.content.trim().toLowerCase() ?? '';
  return VALID_LABELS.includes(raw as IntentLabel)
    ? (raw as IntentLabel)
    : 'none';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a piece of text as an intent label.
 * Regex runs first (instant, free). Groq is called only for ambiguous text.
 * Results are cached by SHA-256(text) to skip repeated API calls.
 */
export async function classify(text: string): Promise<IntentLabel> {
  const trimmed = text.trim();
  if (!trimmed) return 'none';

  const hash = createHash('sha256').update(trimmed).digest('hex');
  const hit = cache.get(hash);
  if (hit !== undefined) return hit;

  const intent = regexClassify(trimmed) ?? (await groqClassify(trimmed));

  cache.set(hash, intent);
  return intent;
}
