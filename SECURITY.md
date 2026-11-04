# Security and private data

This prototype is a local tool, not an authenticated public service. Keep its
server bound to localhost. Do not expose it using a public tunnel without adding
and auditing authentication, authorization and transport protections.

Do not place API keys in client code or VITE_ environment variables. `.env` stays
local and is ignored. Live inference sends selected images and relevant saved
history to the configured service; confirm its terms before using private material.

Do not attach personal photos, API responses, credentials, database files or
budget ledgers to issues. Use synthetic reproductions. If a key is exposed,
revoke it at the provider; deleting a file does not erase Git history.

There is no private reporting address configured. Use GitHub private vulnerability
reporting if the repository owner enables it. Do not post secret details publicly.
