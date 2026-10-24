# Homiio SDK

The public resource capability API remains compatible. Own Oxy backends can
use the `/server` export with their process's shared `OxyServer`:

```ts
import { homiioTeamForOxyService } from '@oxy.so/homiio-sdk/server';

const team = homiioTeamForOxyService(oxy);
```

The factory uses Oxy's shared workload transport and the registered Homiio
audience. It adds no API key, internal scopes or app consent. Team capabilities,
membership and operation checks remain the resource authorization contract.
The root SDK import does not load Oxy; only the optional server entry requires
`@oxy.so/core >=7 <8`.

This SDK release precedes the backend migrations in Allo and Homiio, so neither
backend depends on an unpublished sibling SDK. The SDK's development core7 and
contracts6 dependencies are isolated from the applications' existing major
versions. The applications adopt the new majors in their separate migration.

The release removes global core/contracts/protocol overrides. Existing app
core6.14/contracts5.7 remain pinned; protocol1.5.1 is selected explicitly for
the SDK7 transport instead of forcing an incompatible older protocol. The lock
keeps compatible existing application resolutions alongside the new SDK.
