# Local single-player fixture

This fixture initializes a fresh clone with the intentionally fake `1@gmail.com`
playtest account and its `RendzerA` save. The server copies it into the ignored runtime
authority only when that authority does not already exist. Existing local accounts and
saves are never replaced.

Do not add real account identifiers, runtime `Accounts.json`, or live saves here.
