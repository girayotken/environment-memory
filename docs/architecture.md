# Architecture

The React mobile UI captures useful views from either the procedural Three.js
workshop or a browser camera. Saved frames have content hashes and capture dates.

Fastify serves the UI and compact memory endpoints. Zod validates inputs. SQLite
stores captures, observation history, provisional identity links, semantic user
edits and undo revisions. Raw runtime evidence remains in the local workspace,
never in the source distribution.

The provider receives pixels, selected historical evidence and scoped graph
context. It proposes observations and match decisions. Application code validates
source bindings, relationships, revisions and budgets before applying updates.
Simulation object IDs, transforms and controls are evaluation-only information.

Object identity is probabilistic. A later sighting may support a reversible
same-object link. It does not erase a prior observation. `inside` relationships
are separate from surface support: an item resting on a shelf is not inside it.
Hidden contents are not re-observed simply because their container is seen.

A unique, exact saved name can be resolved locally. Other queries and natural
language edits use the configured interpreter. Structured edits and undo are
code-owned; no model call is needed merely to read a record or apply a valid command.

## Source map

- `src/client`: mobile UI, camera capture, procedural scene and guided views.
- `src/domain`: contracts, memory transitions, matching and graph behavior.
- `src/server`: Fastify routes, SQLite stores, provider transports and budgets.
- `src/client/evaluation`: reusable evaluation helpers; no local trial outputs included.
- `scripts`: build/start commands, compact MCP bridge and small required helpers.
- `tests`: offline tests using synthetic data and mocked providers.

The Meta adapter uses an OpenAI-compatible SDK against `api.meta.ai`, not the
OpenAI service. Provider choice is not yet a universal plug-and-play setting.
Local agent relays are available but require an operator and a separate model.
