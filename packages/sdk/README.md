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
Both entries are independent of Oxy at runtime and in their emitted types.
The factory accepts only the structural service-client method it uses. The own
integration requires Oxy core7 or newer. Its built artifact is tested against
published core7.1.0 by `tests/server.test.ts`; the SDK test typecheck runs in CI.

Allo0.4 and Homiio0.2 were published before the runtime migrations. The apps now
use the same core7 major, so the temporary independent test installation has
been removed. Doctor checks the one runtime dependency tree.
