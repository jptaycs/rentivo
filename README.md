This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Environment setup

The real env files are never in git. Each one is kept whole in the Notes field of a
Bitwarden **secure note** named `rentivo / <path>`:

| Bitwarden note | File |
|---|---|
| `rentivo / .env.local` | `.env.local` |
| `rentivo / outreach/.env` | `outreach/.env` |

On a new machine:

```bash
brew install bitwarden-cli jq          # Windows: winget install Bitwarden.CLI and jqlang.jq, then use Git Bash
bw login                               # once per machine
export BW_SESSION="$(bw unlock --raw)"
npm run env:pull
bw lock
```

The script asks before replacing an existing file and keeps the old one as
`<file>.bak-<timestamp>`. After changing a value, update the note too. The
`.env.example` files list every key and where to get it.
