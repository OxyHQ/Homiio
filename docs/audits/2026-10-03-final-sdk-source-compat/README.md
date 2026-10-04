# Homiio candidate dependency compatibility

Base `c73042291f25de400d33022f0c59f398c1c89d55` retains the accepted published
Peable SDK verifier seam and corrected housing parity documentation. No runtime
source changed. [proof.json](proof.json) pins the local candidate inputs and
all logs; this checkpoint awaits root review.

Candidate Oxy packages come from `f364fe58a41aab6913cf92ec01a9a9c1ea489120`,
which predates the next native fixes. Bloom is registry 6.2.1, satisfying the
Services maintenance peer. Keyboard-controller is aligned upward to 1.21.6
with `expo.install.exclude`. The complete files of installed candidate packages
and Bloom match their archives. Actual package manifests and lock remain local
candidate modifications; copies here are evidence, not registry adoption.

The frontend passes 73 suites / 940 tests, strict typecheck and Expo web export.
Backend typecheck/build and listing-provider build pass. The backend PostgreSQL
suite was not rerun because this checkpoint changes no runtime source; the
previous verifier proof remains independent. Builds do not establish native
rendering or live Oxy login. Existing renderer/act and Metro warnings are kept
in the logs.

Homiio's domain API already calls `createLinkedClient` and preserves its own
`normalizeEnvelope` bridge. The Sindi streaming hook remains an existing
explicit repository exception: it reads the SDK session bearer and selects
browser fetch / native `expo/fetch`, including multipart requests. The new SDK
raw-response helper accepts string bodies, so this checkpoint does not replace
that broader contract blindly or claim it migrated. No housing query, ownership,
Pay rent configuration, provider rail or Peable ingress mount changed.

Pending: final registry publication and integrity, actual manifest/lock commit,
applicable final CI and coordinated runtime/rollout acceptance. No production
or shared native fixture was touched.
