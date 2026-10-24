# Own team transport rollout

Oxy ADR 0049 separates workload identity from user and resource authorization.
The team capability protocol remains the domain boundary: adding an own service
bearer never grants ownership or membership and never replaces the capability.

Publish the SDK-only releases first: `@oxy.so/allo-sdk` 0.4.0 and
`@oxy.so/homiio-sdk` 0.2.0. Both `/server` factories require core7. Then adopt
those packages in the application branches. Deploy Homiio before Allo, so the
Homiio receiver already declares its canonical audience when Allo starts
sending its workload bearer. The frontend linked socket getter and deferred
Files calls additionally require the core7.1/API follow-up before their cutover.

| Caller | Receiver route | Resource authorization | Rolling compatibility |
| --- | --- | --- | --- |
| Homiio | Allo `POST /v1/team-access/snapshot` | Opaque team capability, live conversation lookup | Route is before global session/instance auth in old and new Allo. The new bearer does not replace the capability. |
| Allo | Homiio `POST /api/v1/team-chat/operations/read` | HMAC operation capability, live operation and encrypted team reference | Old core6.14 optional auth refuses the new audience but continues anonymously; the capability still authorizes this published read. New Homiio accepts its canonical workload audience. |

Mutations remain separate. Homiio creates operations only for the actual case
owner. Allo checks the returned owner and team-reference hash against the
acting account and local conversation, and preserves instance signatures,
membership and epoch checks. Neither bearer nor public read confers mutation
rights.

## Verified compatibility

On 2026-10-24 the published core6.14.0 middleware was composed with the actual
Homiio `readChatOperation` controller and a throwaway database migrated by the
normal Homiio migrator. The published core7.0.0 caller used the new SDK factory
and temporary workload provider against a local signed issuer fixture.

- Valid capability: read succeeds and returns the original owner/reference.
- Invalid capability and another operation: rejected.
- Another actor attempting `beginTeamOperation`: rejected as not found.
- Existing capability read without a bearer: still succeeds.
- The old optional middleware reports audience refusal without fabricating a
  user or making the domain read depend on bearer acceptance.

The issuer was a test fixture, not production attestation. This evidence tests
the actual HTTP receiver and domain authorization; it does not claim a live
production deployment. Local evidence and reproducible runner are in
`~/Oxy/.scratch/commerce/legacy-receiver/{matrix.ts,package.json,bun.lock}` and
`~/Oxy/.scratch/commerce/legacy-receiver-matrix.log`. The temporary database was
dropped after the run.
