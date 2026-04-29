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

// ─── Groq classifier ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You classify sticky note text from a collaborative whiteboard session.
Respond with EXACTLY ONE of these labels — nothing else, no punctuation, no explanation:
action_item   (a task, to-do, or action that needs to be done)
decision      (a resolved choice, agreement, or conclusion)
open_question (an unresolved question or something that needs an answer)
reference     (a URL, link, citation, or external resource)
none          (everything else — general notes, observations, brainstorming)`;

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
 * Classify a piece of text as an intent label using Groq (Llama 3.1 8B).
 * Results are cached by SHA-256(text) to skip repeated API calls.
 */
export async function classify(text: string): Promise<IntentLabel> {
  const trimmed = text.trim();
  if (!trimmed) return 'none';

  const hash = createHash('sha256').update(trimmed).digest('hex');
  const hit = cache.get(hash);
  if (hit !== undefined) return hit;

  const intent = await groqClassify(trimmed);

  cache.set(hash, intent);
  return intent;
}
