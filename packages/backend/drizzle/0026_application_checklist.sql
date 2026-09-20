-- oxy:deploy-phase=pre
--
-- The application checklist: requirements, uploads and VERIFICATION as three
-- separate facts (#518 §7.4, #519 §7.4).
--
-- §7.4 asks that the checklist "refleje estados verdaderos de requisitos,
-- upload y verificación" and says plainly that "pulsar un botón no convierte
-- localmente un documento en verificado". Homiio had none of the three: no
-- requirement list anywhere, and no column in which a landlord's judgement of a
-- document could be recorded. There was no checklist component either, so there
-- was nothing to correct — only something absent.
--
-- PRE: five added columns, all nullable or defaulted, and four CHECKs over
-- them. An old image writes none of them and is unaffected; a row it inserts
-- lands `pending` with no verifier, which every CHECK here permits.
--
-- THE TWO-WAY CHECKS ARE THE POINT. A `verified` row with no verifier is a tick
-- nobody stands behind; a verifier on a `pending` row is a decision the status
-- denies; a rejection with no reason is a dead end that turns a five-minute fix
-- into an abandoned application. Each is wrong in a way a screen renders
-- confidently, so each is refused by the database rather than by whichever
-- caller remembers.
--
-- `application_required_documents` defaults to the empty array, which is the
-- honest reading of every row written before the column existed: silence is not
-- a demand. A listing with no requirements still shows whatever an applicant
-- volunteered — the checklist just has nothing to call missing.

ALTER TABLE "properties" ADD COLUMN "application_required_documents" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_application_documents" ADD COLUMN "verification_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_application_documents" ADD COLUMN "verified_by_oxy_user_id" text;--> statement-breakpoint
ALTER TABLE "tenant_application_documents" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_application_documents" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_application_required_documents_check" CHECK ("properties"."application_required_documents" <@ array['id', 'income', 'reference', 'other']::text[]);--> statement-breakpoint
ALTER TABLE "tenant_application_documents" ADD CONSTRAINT "tenant_application_documents_verification_status_check" CHECK ("tenant_application_documents"."verification_status" in ('pending', 'verified', 'rejected'));--> statement-breakpoint
ALTER TABLE "tenant_application_documents" ADD CONSTRAINT "tenant_application_documents_decided_check" CHECK (("tenant_application_documents"."verification_status" <> 'pending') = ("tenant_application_documents"."verified_by_oxy_user_id" is not null and "tenant_application_documents"."verified_at" is not null));--> statement-breakpoint
ALTER TABLE "tenant_application_documents" ADD CONSTRAINT "tenant_application_documents_rejection_reason_check" CHECK (("tenant_application_documents"."verification_status" = 'rejected') = ("tenant_application_documents"."rejection_reason" is not null));