/**
 * The notification tools: the person's own mailbox and nobody else's.
 *
 * Every read and write carries the recipient in the repository query, so
 * somebody else's notification answers not-found. There is deliberately no
 * create tool (`capabilities/routeCoverage/notifications.ts`): notifications are
 * written only by `notificationDispatchService`.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import { HOMIIO_CAPABILITY_CATALOG } from '../../capabilities/homiio.catalog';
import { getDb } from '../../db/postgres';
import { notifications } from '../../db/schema';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { callTool } from '../helpers/capabilityHarness';

const SUITE = uuidv7().slice(-8);
const ME = `oxy-notif-me-${SUITE}`;
const OTHER = `oxy-notif-other-${SUITE}`;

async function notify(recipient: string, title = 'Viewing approved'): Promise<string> {
  const row = await notificationDispatchService.createForUser(recipient, {
    type: 'property',
    title,
    message: 'Your viewing request was approved.',
    priority: 'medium',
    data: {},
  });
  if (!row) throw new Error('dispatch fixture failed');
  return row.id;
}

beforeEach(async () => {
  await getDb().delete(notifications);
});

it('offers no tool that composes a notification', () => {
  const names = HOMIIO_CAPABILITY_CATALOG.tools.map((tool) => tool.name);
  expect(names).not.toContain('createNotification');
  expect(names).not.toContain('updateNotification');
});

it('lists, reads, marks read and deletes the person’s own notifications', async () => {
  const id = await notify(ME);

  const listed = await callTool('listMyNotifications', ME, { unreadOnly: true });
  expect(listed.structuredContent).toMatchObject({ total: 1, unreadCount: 1 });

  expect((await callTool('getNotification', ME, { notificationId: id })).isError).toBe(false);
  const read = await callTool('markNotificationRead', ME, { notificationId: id });
  expect(read.structuredContent.data).toMatchObject({ read: true });

  expect((await callTool('deleteNotification', ME, { notificationId: id })).isError).toBe(false);
  expect(await getDb().select().from(notifications)).toHaveLength(0);
});

it('answers somebody else’s notification not-found, and changes nothing', async () => {
  const id = await notify(OTHER);
  for (const tool of ['getNotification', 'markNotificationRead', 'deleteNotification']) {
    const result = await callTool(tool, ME, { notificationId: id });
    expect(result.error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  }
  const [row] = await getDb().select().from(notifications).where(eq(notifications.id, id));
  expect(row.read).toBe(false);
});

it('marks all read and clears all — only the person’s own', async () => {
  await notify(ME);
  await notify(ME, 'Second');
  await notify(OTHER);

  const marked = await callTool('markAllNotificationsRead', ME);
  expect(marked.structuredContent.data).toEqual({ modifiedCount: 2 });
  const cleared = await callTool('clearAllNotifications', ME);
  expect(cleared.structuredContent.data).toEqual({ deletedCount: 2 });

  const left = await getDb().select().from(notifications);
  expect(left.map((row) => row.recipientOxyUserId)).toEqual([OTHER]);
});
