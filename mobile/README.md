# BrainIA Mobile Shell

This package is a thin native client shell for BrainIA.

## What it does

- reads backend metrics
- runs inspect queries against the backend
- sends quick capture events for notes, email, notifications, and wallet activity

## Environment

Set `EXPO_PUBLIC_BRAINIA_API_BASE_URL` to the backend base URL.

If unset, the shell defaults to `http://localhost:3000`.

## Scripts

- `npm install`
- `npm run start`
- `npm run android`
- `npm run ios`
- `npm run web`

## Scope

This shell stays thin on purpose. Business logic remains in the backend.
