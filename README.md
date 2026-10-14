# CertiChain: full-stack certificate verification on a blockchain

- `contracts/CertiChain.sol`: Solidity smart contract (stores certificate fingerprints, supports revoke)
- `backend/server.js`: Express API that signs transactions with ethers.js and serves the site
- `frontend/index.html`: Apple-style website with a live 3D chain

## Features
- **Issue** a certificate (optional completion date). Only a salted fingerprint goes on-chain.
- **Certificate sheet** with QR code, **print / save as PDF**, copy verify link, download package.
- **Selective disclosure**: toggle which fields a verifier can see; hidden fields are still proven genuine.
- **Batch issue** from a CSV (up to 50 rows) with a downloadable template and bulk package download.
- **Verify** by pasting, dropping a `.json` file, opening a verification link / scanning the QR, or checking a bare fingerprint.
- **My certificates**: live status of everything you issued in this browser, and revoke.
- **Revoke keys**: each certificate gets a secret key at issue time; revoking requires it (the server stores only its hash).
- **Public ledger explorer**: search, filter by status, copy fingerprints.
- Live stats (certificates, block, issuers, revoked) that refresh every 10 seconds, dark mode, mobile layout.

## Run locally (3 terminals, about 2 minutes)
1. `npm install`
2. Terminal 1: `npm run chain` (starts a local blockchain with funded test accounts)
3. Terminal 2: `npm run deploy` then `npm start`
4. Open http://localhost:3000

Restarting the local chain wipes it, so run `npm run deploy` again afterwards (and delete `backend/revoke-keys.json`).

## Public testnet (optional)
1. Copy `.env.example` to `.env`, add a Sepolia RPC URL and a throwaway wallet key (fund it with test ETH from a faucet).
2. `npx hardhat run scripts/deploy.js --network sepolia`
3. `npm start` (the backend reads the same `.env`)

## API
`GET /api/info`, `GET /api/certs`, `GET /api/lookup/:root`, `POST /api/issue`, `POST /api/batch`, `POST /api/verify`, `POST /api/revoke` (needs `revokeKey`).

## How privacy works
Only a SHA-256 fingerprint of salted per-field hashes goes on-chain. The holder picks which fields to reveal in a share package, and the verifier recomputes the fingerprint and checks it against the contract.
