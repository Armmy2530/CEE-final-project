import type { RequestHandler } from './$types';
import { answerOffline, askClaude, askOpenRouter, type ChatMessage } from '$lib/server/chat';
import { jsonFail, jsonOk, readJsonBody } from '$lib/server/http';

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) return jsonFail(401, 'Not signed in');

  let body: { message?: unknown; history?: unknown };
  try {
    body = await readJsonBody(request);
  } catch (e) {
    const err = e as { code?: number; message?: string };
    return jsonFail(err.code || 400, err.message || 'bad json');
  }

  const { message, history } = body;
  if (typeof message !== 'string' || !message.trim() || message.length > 500) {
    return jsonFail(400, 'Message must be 1-500 characters.');
  }

  const rt = locals.runtime;
  if (!rt.chatLimit.take(`chat:${locals.user.member_id}`)) {
    return jsonFail(429, 'Slow down a little.');
  }

  const hist: ChatMessage[] = (Array.isArray(history) ? history : [])
    .filter(
      (h): h is ChatMessage =>
        Boolean(h) &&
        typeof h === 'object' &&
        ((h as ChatMessage).role === 'user' || (h as ChatMessage).role === 'assistant') &&
        typeof (h as ChatMessage).content === 'string'
    )
    .slice(-6)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 1000) }));

  const dash = await rt.getDashboard(false);
  if (rt.env.OPENROUTER_API_KEY) {
    try {
      return jsonOk({
        reply: await askOpenRouter({ env: rt.env, dash, message: message.trim(), history: hist }),
        mode: 'ai'
      });
    } catch (e) {
      console.error('chat (openrouter):', (e as Error).message);
    }
  } else if (rt.env.ANTHROPIC_API_KEY) {
    try {
      return jsonOk({
        reply: await askClaude({ env: rt.env, dash, message: message.trim(), history: hist }),
        mode: 'ai'
      });
    } catch (e) {
      console.error('chat (anthropic):', (e as Error).message);
    }
  }

  return jsonOk({ reply: answerOffline(message, dash), mode: 'offline' });
};
