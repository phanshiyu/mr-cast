# Review: Password reset tokens

Claude's review of `feature/password-reset` against `main`. Each finding is an opinion, checked against the code before it was written down.

## Bugs

- `src/reset.js:21` Deletes by user id, so a used token still works
  - Evidence: resetTokens is keyed by token, so delete(row.userId) removes nothing; redeeming the same token twice succeeds (ran it).

## Risks

- `src/routes.js:14` The reset token is written to the log
  - Evidence: console.log prints the full token; anyone who reads the logs can reset that user's password for 15 minutes.

## Nits

- `src/password.js:4` validPassword returns an error message, not a boolean
  - Evidence: It returns null for a good password and a string for a bad one, so `if (validPassword(p))` reads backwards.
