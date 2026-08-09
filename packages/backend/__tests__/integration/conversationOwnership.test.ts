/**
 * The Sindi conversation surface, through the REAL routers, against the REAL
 * Postgres this worker owns.
 *
 * Two things are under test and they are different:
 *
 *  1. **Ownership.** Every `/api/ai/conversations*` handler scopes by
 *     `oxy_user_id` IN THE PREDICATE, so user B must not be able to read,
 *     rename, append to, share or delete user A's transcript — and must get the
 *     same 404 as for a conversation that does not exist, since a 403 would
 *     confirm the id is real.
 *  2. **That the surface WORKS AT ALL.** It did not. `routes/ai.ts` wrote
 *     `profileId`, which `ConversationSchema` does not declare, so mongoose
 *     strict mode dropped it and `required: true` on `oxyUserId` failed every
 *     save; the reads filtered on the same phantom field and returned `[]`.
 *     Production holds zero conversations for that reason. A test that only
 *     checked the IDOR would have passed against the broken version too, so the
 *     happy paths below are load-bearing rather than decoration.
 *
 * ## Why the ownership cases re-read the TABLE
 *
 * A handler that answered 404 while still performing the write would satisfy
 * every assertion made on its RESPONSE — the 404 is the thing being tested, so
 * trusting it to also prove the row is untouched is a check that cannot tell
 * success from failure. Each case therefore reads the row back.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';

import aiRouter from '../../routes/ai';
import publicRoutes from '../../routes/public';
import { getDb } from '../../db/postgres';
import { conversationMessages, conversations } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { expireShareLinks } from '../../db/conversations/conversationRepository';

/** The AI router, behind a fake session for `oxyUserId`. */
function buildApp(oxyUserId: string | null): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    next();
  });
  app.use('/ai', aiRouter());
  app.use(errorHandler);
  return app;
}

/** The public router, with no session at all — the share-link reader. */
function buildPublicApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/', publicRoutes());
  app.use(errorHandler);
  return app;
}

const owner = (): string => `oxy-${uuidv7()}`;

async function findConversation(id: string) {
  const [row] = await getDb().select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return row;
}

async function messagesOf(id: string) {
  return getDb()
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, id));
}

/** Create a conversation through the real handler and return its id. */
async function createFor(oxyUserId: string, body: Record<string, unknown> = {}): Promise<string> {
  const res = await request(buildApp(oxyUserId)).post('/ai/conversations').send(body);
  expect(res.status).toBe(200);
  return String(res.body.conversation.id);
}

beforeEach(async () => {
  await getDb().delete(conversations);
});

describe('POST /ai/conversations — the write path that never worked', () => {
  it('stores a conversation owned by the SESSION user', async () => {
    const oxyUserId = owner();
    const res = await request(buildApp(oxyUserId))
      .post('/ai/conversations')
      .send({ title: 'Rent increase', initialMessage: 'Can they raise it mid-contract?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.conversation.title).toBe('Rent increase');
    expect(res.body.conversation.messages).toHaveLength(1);
    expect(res.body.conversation.messages[0]).toMatchObject({
      role: 'user',
      content: 'Can they raise it mid-contract?',
    });

    // The row really exists, and its owner is the session's Oxy id rather than
    // any profile id — the exact thing the Mongo version got wrong.
    const stored = await findConversation(res.body.conversation.id);
    expect(stored?.oxyUserId).toBe(oxyUserId);
    expect(stored?.status).toBe('active');
    expect(await messagesOf(res.body.conversation.id)).toHaveLength(1);
  });

  it('does not need a profile row to exist first', async () => {
    // The Mongo handler resolved a `Profile` and 404'd without one, which
    // refused a chat to anybody who had never opened the profile screen.
    const res = await request(buildApp(owner()))
      .post('/ai/conversations')
      .send({ initialMessage: 'hello' });
    expect(res.status).toBe(200);
  });

  it('accepts a whole opening transcript and numbers it from zero', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, {
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
      ],
    });

    const stored = await messagesOf(id);
    expect(stored.map((row) => row.position).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('drops a turn with an undeclared role rather than storing it', async () => {
    // `conversation_messages_role_check` would answer `23514`, which reaches the
    // client as a 500 for input it could simply be told about.
    const id = await createFor(owner(), {
      messages: [
        { role: 'user', content: 'kept' },
        { role: 'moderator', content: 'dropped' },
        { role: 'assistant', content: 'kept too' },
      ],
    });
    const stored = await messagesOf(id);
    expect(stored.map((row) => row.content).sort()).toEqual(['kept', 'kept too']);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await request(buildApp(null)).post('/ai/conversations').send({ title: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('/ai/stream — creation has exactly ONE owner', () => {
  it('creates NOTHING when the caller supplies no conversationId', async () => {
    // `useSindiConversation` sends `conversationId: undefined` for a chat it has
    // not persisted yet, and `conversationStore.saveConversation` separately
    // POSTs `/ai/conversations` with the whole transcript. If `/stream` also
    // created one, every new Sindi chat would appear TWICE in the user's list,
    // one copy of which they could not recognise or clean up.
    //
    // The stream itself needs a live model, so this asserts the SIDE EFFECT
    // rather than the response: after the request, the user still owns nothing.
    const oxyUserId = owner();
    await request(buildApp(oxyUserId))
      .post('/ai/stream')
      .send({ messages: [{ role: 'user', content: 'hello' }] });

    const rows = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.oxyUserId, oxyUserId));
    expect(rows).toHaveLength(0);
  });

  it('does not adopt or write into somebody else\'s conversation', async () => {
    const victim = owner();
    const id = await createFor(victim, { initialMessage: 'private' });

    await request(buildApp(owner()))
      .post('/ai/stream')
      .send({ conversationId: id, messages: [{ role: 'user', content: 'injected' }] });

    // The lookup is scoped to the caller, so a stranger's id resolves to
    // nothing and the turn is dropped rather than appended.
    expect(await messagesOf(id)).toHaveLength(1);
  });
});

describe('GET /ai/conversations — the list, and the two derived figures', () => {
  it('returns only the caller\'s own conversations', async () => {
    const a = owner();
    const b = owner();
    await createFor(a, { title: 'A owns this' });
    await createFor(b, { title: 'B owns this' });

    const res = await request(buildApp(a)).get('/ai/conversations');
    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
    expect(res.body.conversations[0].title).toBe('A owns this');
  });

  it('reports messageCount and lastMessage without storing either', async () => {
    const oxyUserId = owner();
    await createFor(oxyUserId, {
      messages: [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
      ],
    });

    const res = await request(buildApp(oxyUserId)).get('/ai/conversations');
    expect(res.body.conversations[0].messageCount).toBe(2);
    expect(res.body.conversations[0].lastMessage).toMatchObject({
      role: 'assistant',
      content: 'two',
    });
  });
});

describe('GET /ai/conversations/:id — ownership', () => {
  it('lets the owner read their own transcript', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { initialMessage: 'mine' });

    const res = await request(buildApp(oxyUserId)).get(`/ai/conversations/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.conversation.id).toBe(id);
    expect(res.body.conversation.messages[0].content).toBe('mine');
  });

  it('404s a stranger, indistinguishably from a conversation that does not exist', async () => {
    const id = await createFor(owner(), { initialMessage: 'private' });

    const stranger = await request(buildApp(owner())).get(`/ai/conversations/${id}`);
    const missing = await request(buildApp(owner())).get(`/ai/conversations/${uuidv7()}`);
    expect(stranger.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(stranger.body).toEqual(missing.body);
  });

  it('404s a malformed id instead of 400ing it', async () => {
    // The `mongoose.Types.ObjectId.isValid` guard that used to 400 here is
    // DELETED, not widened: post-cutover it answers `false` for every uuid v7,
    // so it would have rejected every conversation created from the cutover on.
    // A `text` column takes any string and the lookup simply finds nothing.
    const res = await request(buildApp(owner())).get('/ai/conversations/not-an-id-at-all');
    expect(res.status).toBe(404);
  });

  it('accepts a uuid v7 id, which the deleted guard would have refused', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId);
    expect(id).toMatch(/^[0-9a-f]{8}-/);

    const res = await request(buildApp(oxyUserId)).get(`/ai/conversations/${id}`);
    expect(res.status).toBe(200);
  });
});

describe('PUT /ai/conversations/:id — ownership and transcript replacement', () => {
  it('renames, restatuses and replaces the transcript for the owner', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { initialMessage: 'original' });

    const res = await request(buildApp(oxyUserId))
      .put(`/ai/conversations/${id}`)
      .send({
        title: 'Renamed',
        status: 'archived',
        messages: [
          { role: 'user', content: 'replaced' },
          { role: 'assistant', content: 'and answered' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.conversation.title).toBe('Renamed');
    expect(res.body.conversation.status).toBe('archived');
    expect(res.body.conversation.messages.map((m: { content: string }) => m.content)).toEqual([
      'replaced',
      'and answered',
    ]);

    // Re-numbered from zero, as assigning the embedded array did in Mongo.
    const stored = await messagesOf(id);
    expect(stored.map((row) => row.position).sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('refuses an undeclared status rather than storing it', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId);
    const res = await request(buildApp(oxyUserId))
      .put(`/ai/conversations/${id}`)
      .send({ status: 'shredded' });

    expect(res.status).toBe(200);
    expect((await findConversation(id))?.status).toBe('active');
  });

  it('404s a stranger AND leaves the conversation untouched', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { title: 'Untouched', initialMessage: 'still here' });

    const res = await request(buildApp(owner()))
      .put(`/ai/conversations/${id}`)
      .send({ title: 'Hijacked', messages: [] });

    expect(res.status).toBe(404);
    expect((await findConversation(id))?.title).toBe('Untouched');
    expect(await messagesOf(id)).toHaveLength(1);
  });
});

describe('POST /ai/conversations/:id/messages — ownership', () => {
  it('appends for the owner and returns the stored message', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { initialMessage: 'q' });

    const res = await request(buildApp(oxyUserId))
      .post(`/ai/conversations/${id}/messages`)
      .send({ role: 'assistant', content: 'a', attachments: [{ type: 'image', name: 'x.png' }] });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ role: 'assistant', content: 'a' });
    expect(res.body.message.attachments).toHaveLength(1);
    expect(res.body.conversation.messages).toHaveLength(2);
    expect(await messagesOf(id)).toHaveLength(2);
  });

  it('400s a role the CHECK would refuse', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId);
    const res = await request(buildApp(oxyUserId))
      .post(`/ai/conversations/${id}/messages`)
      .send({ role: 'moderator', content: 'x' });
    expect(res.status).toBe(400);
    expect(await messagesOf(id)).toHaveLength(0);
  });

  it('404s a stranger AND writes nothing', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { initialMessage: 'only mine' });

    const res = await request(buildApp(owner()))
      .post(`/ai/conversations/${id}/messages`)
      .send({ role: 'user', content: 'injected' });

    expect(res.status).toBe(404);
    expect(await messagesOf(id)).toHaveLength(1);
  });
});

describe('DELETE /ai/conversations/:id — ownership and cascade', () => {
  it('deletes the conversation and its messages for the owner', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { initialMessage: 'bye' });

    const res = await request(buildApp(oxyUserId)).delete(`/ai/conversations/${id}`);
    expect(res.status).toBe(200);
    expect(await findConversation(id)).toBeUndefined();
    // `conversation_messages.conversation_id` is ON DELETE CASCADE.
    expect(await messagesOf(id)).toHaveLength(0);
  });

  it('404s a stranger AND leaves the conversation in place', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { initialMessage: 'survives' });

    const res = await request(buildApp(owner())).delete(`/ai/conversations/${id}`);
    expect(res.status).toBe(404);
    expect(await findConversation(id)).toBeDefined();
    expect(await messagesOf(id)).toHaveLength(1);
  });
});

describe('sharing — the link expires, the conversation does not', () => {
  it('mints a link the owner can share and a stranger can follow', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { title: 'Shared', initialMessage: 'read me' });

    const share = await request(buildApp(oxyUserId)).post(`/ai/conversations/${id}/share`);
    expect(share.status).toBe(200);
    expect(share.body.shareToken).toMatch(/^[0-9a-f]{64}$/);
    expect(share.body.shareUrl).toBe(`/shared/${share.body.shareToken}`);

    // All four `sharing_*` columns move together —
    // `conversations_sharing_coherent_check` accepts nothing else.
    const stored = await findConversation(id);
    expect(stored?.sharingIsShared).toBe(true);
    expect(stored?.sharingShareToken).toBe(share.body.shareToken);
    expect(stored?.sharingSharedAt).toBeInstanceOf(Date);
    expect(stored?.sharingExpiresAt).toBeInstanceOf(Date);

    const followed = await request(buildPublicApp()).get(`/ai/shared/${share.body.shareToken}`);
    expect(followed.status).toBe(200);
    expect(followed.body.conversation.title).toBe('Shared');
    expect(followed.body.conversation.messages[0].content).toBe('read me');
  });

  it('never discloses the owner or the token to whoever follows the link', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { initialMessage: 'public read' });
    const share = await request(buildApp(oxyUserId)).post(`/ai/conversations/${id}/share`);

    const followed = await request(buildPublicApp()).get(`/ai/shared/${share.body.shareToken}`);
    const serialized = JSON.stringify(followed.body);
    expect(serialized).not.toContain(oxyUserId);
    expect(serialized).not.toContain(share.body.shareToken);
    expect(followed.body.conversation).not.toHaveProperty('oxyUserId');
    expect(followed.body.conversation).not.toHaveProperty('sharing');
  });

  it('404s a stranger asking to share somebody else\'s conversation, and mints nothing', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { initialMessage: 'not yours' });

    const res = await request(buildApp(owner())).post(`/ai/conversations/${id}/share`);
    expect(res.status).toBe(404);
    expect((await findConversation(id))?.sharingIsShared).toBe(false);
    expect((await findConversation(id))?.sharingShareToken).toBeNull();
  });

  it('refuses an expired token WITHOUT depending on the sweep having run', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { initialMessage: 'stale link' });
    const share = await request(buildApp(oxyUserId)).post(`/ai/conversations/${id}/share`);

    // Push the deadline into the past, leaving the row otherwise untouched. The
    // coherence CHECK still holds: all four columns are still set.
    await getDb()
      .update(conversations)
      .set({ sharingExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(conversations.id, id));

    const followed = await request(buildPublicApp()).get(`/ai/shared/${share.body.shareToken}`);
    expect(followed.status).toBe(404);
  });

  it('CLEARS an expired link and keeps the conversation — Mongo deleted the row', async () => {
    // This is the single most important assertion in the file. Mongo carried
    // `{ 'sharing.expiresAt': 1 }, { expireAfterSeconds: 0 }`, and
    // `generateShareToken` set that deadline to +24h — so every conversation
    // anybody ever shared was destroyed a day later, with its transcript.
    // `db/expiry.ts` names the column in `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE`;
    // this proves the replacement clears four columns rather than reaping a row.
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { title: 'Survives its own link', initialMessage: 'kept' });
    await request(buildApp(oxyUserId)).post(`/ai/conversations/${id}/share`);
    await getDb()
      .update(conversations)
      .set({ sharingExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(conversations.id, id));

    const cleared = await expireShareLinks(getDb());
    expect(cleared).toBe(1);

    const stored = await findConversation(id);
    expect(stored).toBeDefined();
    expect(stored?.title).toBe('Survives its own link');
    expect(await messagesOf(id)).toHaveLength(1);
    expect(stored?.sharingIsShared).toBe(false);
    expect(stored?.sharingShareToken).toBeNull();
    expect(stored?.sharingSharedAt).toBeNull();
    expect(stored?.sharingExpiresAt).toBeNull();
  });

  it('leaves a live link alone and rewrites nothing on a second sweep', async () => {
    const oxyUserId = owner();
    const id = await createFor(oxyUserId, { initialMessage: 'live' });
    await request(buildApp(oxyUserId)).post(`/ai/conversations/${id}/share`);

    expect(await expireShareLinks(getDb())).toBe(0);
    expect((await findConversation(id))?.sharingIsShared).toBe(true);

    // An already-cleared conversation is not swept again: the predicate names
    // `is_shared`, so `updated_at` (which carries drizzle's `$onUpdate`) cannot
    // be restamped on a row nobody edited.
    await getDb()
      .update(conversations)
      .set({ sharingExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(conversations.id, id));
    expect(await expireShareLinks(getDb())).toBe(1);
    const afterFirst = await findConversation(id);
    expect(await expireShareLinks(getDb())).toBe(0);
    expect((await findConversation(id))?.updatedAt).toEqual(afterFirst?.updatedAt);
  });
});
