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
integration requires Oxy core7 or newer; its built artifact is tested against
published core7.0.0 in `tests/sdk-transport`, with its own frozen lockfile.

This SDK release precedes the backend migrations in Allo and Homiio, so neither
backend depends on an unpublished sibling SDK. Existing applications remain on
core6.14/contracts5.7/protocol1.5.0. Doctor continues to verify their runtime
dependency tree without conflating it with the independent integration test.
