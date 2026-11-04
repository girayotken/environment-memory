# Third-party notices

Dependencies are installed from npm, pinned in package-lock.json, and excluded
from source control. Installed packages retain their license texts; include these
when redistributing their code as required.

| Direct dependency | Version | License | Source |
|---|---|---|---|
| React / React DOM | 19.3.1 | MIT | https://github.com/facebook/react |
| Lucide React | 1.66.0 | ISC | https://github.com/lucide-icons/lucide |
| Three.js | 0.186.1 | MIT | https://github.com/mrdoob/three.js |
| Fastify | 5.12.7 | MIT | https://github.com/fastify/fastify |
| Zod | 4.6.7 | MIT | https://github.com/colinhacks/zod |
| OpenAI-compatible JS SDK | 7.45.0 | Apache-2.0 | https://github.com/openai/openai-node |
| Meta-SAM parser | 0.1.0 | SAM License (dependency retains its license) | https://github.com/meta-models/meta-sam |
| MCP server / client (client is test-only) | 2.4.0 | Apache-2.0 | https://github.com/modelcontextprotocol/typescript-sdk |
| pngjs | 7.0.0 | MIT | https://github.com/pngjs/pngjs |

Build/test tools: Vite 8.3.5 (MIT), React Vite plugin 6.1.2 (MIT), TypeScript 7.0.2
(Apache-2.0), tsx 4.23.15 (MIT), pinned DefinitelyTyped definitions (MIT). Node.js
24 and Python 3.10+ have their own licenses. Review the full tree and required
notices before publishing compiled distributions; this is not a completed audit.

Workshop geometry and procedural materials are authored in this project. Three.js
helpers retain the MIT license. No external 3D assets, photographs, fonts, speech
models or model weights are bundled.

Meta Model API and optional local model tools are external services/components
with their own terms. Source licensing does not grant a model-service license.
