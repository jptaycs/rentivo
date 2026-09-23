@AGENTS.md

## Env files and Bitwarden

Real env files live in Bitwarden secure notes (whole file in the Notes field), never in git:

| Note | File |
|---|---|
| `rentivo / .env.local` | `.env.local` |
| `rentivo / outreach/.env` | `outreach/.env` |

- Restore on another machine: `brew install bitwarden-cli` (Windows: `winget install
  Bitwarden.CLI`, then Git Bash), `bw login`, `export BW_SESSION="$(bw unlock --raw)"`,
  `npm run env:pull`, `bw lock`. Or copy the note's Notes field into the file by hand.
- Never commit an env file, and never print, echo or quote a value from one: refer to
  key names only, and check values by length or last 4 characters.
- `bw login` / `bw unlock` prompt for the master password, so the user runs them in their
  own Terminal window (`!` commands can't answer prompts). To hand Claude a session they
  run `(umask 077; bw unlock --raw > <scratchpad>/bw_session)`; `bw lock` and deleting the
  file end it. Claude isn't permitted to write to the vault: give the user a script to run.
- When a value changes, update both the local file and its note.
- Don't run `npm run env:pull` in a working checkout without the user's go-ahead: it can replace
  live env files.
