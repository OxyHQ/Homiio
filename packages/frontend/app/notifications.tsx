import { Redirect } from 'expo-router';

/**
 * Backward-compatibility redirect for the legacy `/notifications` route.
 *
 * The user-facing screen was renamed to "Mailbox" and lives at `/mailbox`.
 * Older app builds and previously-issued push-notification payloads may still
 * hardcode the `/notifications` path (or a `screen: 'notifications'` data
 * field), so we keep this route as a permanent redirect to avoid dead links.
 */
export default function NotificationsRedirect() {
  return <Redirect href="/mailbox" />;
}
