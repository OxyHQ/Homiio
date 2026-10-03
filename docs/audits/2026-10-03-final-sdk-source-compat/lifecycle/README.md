# Sindi linked-client and stream lifecycle

The StrictMode replay disposed the memoized linked client, so the second setup could no longer authenticate. The real HTTP regression failed with `AUTH_REQUIRED`. Clients are now acquired by an effect, disposed once by that effect, and associated with the provider/session owner. A retained callback from A refuses after B replaces it.

The existing conversation hook also left a delivered AI stream open on unmount and retained A's text after switching to B. Two real useChat/HTTP regressions recorded both failures. Cleanup now aborts the stream, discards deferred navigation, clears turn/text/data/actions on owner change, and suppresses stale promotion and attachment completion callbacks. The SDK remains responsible for auth before delivery; the app owns the stream afterwards.

Validation: 4 focal suites / 28 tests and the full frontend's 76 suites / 953 tests pass. TypeScript passes. The exact previous source and final scoped ESLint each report the same existing 1 error and 7 warnings; the synchronous local reset has a narrowly documented exemption because it accompanies the external AI SDK cache reset before painting the next owner. This is not a clean full-lint claim.

Tests use real React StrictMode, SDK linked clients, useChat and loopback HTTP. Only context/external domain/UI dependencies and the platform transport boundary are mocked. This does not prove native Expo runtime or revalidate the whole persisted conversation cache. The final unused-import/comment edit is non-runtime; types were checked afterwards.

Candidate dependency files remain local and uncommitted; final SDK registry adoption and native/runtime acceptance remain separate. `proof.json` records sources and all relevant RED, GREEN and setup/baseline logs.
