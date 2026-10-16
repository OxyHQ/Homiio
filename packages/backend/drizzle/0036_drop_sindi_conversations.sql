-- oxy:deploy-phase=post
-- Homiio's own Sindi chat is gone (Alia ADR 0020): conversations live in Alia
-- now, and existing Homiio conversations are deleted, not migrated. `post`
-- because the previous image still reads and writes these tables until no old
-- task is serving. Children first; no CASCADE, so a dependency nobody knew
-- about fails this migration instead of being dropped silently.
DROP TABLE IF EXISTS "conversation_message_attachments";--> statement-breakpoint
DROP TABLE IF EXISTS "conversation_messages";--> statement-breakpoint
DROP TABLE IF EXISTS "conversations";--> statement-breakpoint
DROP TABLE IF EXISTS "profile_chat_messages";
