require("dotenv").config();
const express = require("express"), path = require("path"), crypto = require("crypto"), fs = require("fs");
const { ethers } = require("ethers");

let deployed;
try { deployed = require("./contract.json"); }
catch { console.error("backend/contract.json not found. Start the chain (npm run chain) and run: npm run deploy"); process.exit(1); }
const { address, abi } = deployed;

// Default key is Hardhat's public local account #0. Local demo only, never holds real funds.
const KEY = process.env.PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/alch_eX5hWKnv-hTC1R7CgyJT7");
const wallet = new ethers.Wallet(KEY, provider);
const contract = new ethers.Contract(address, abi, wallet);
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const FIELDS = ["name", "course", "grade", "issuer"];
const OPTIONAL = ["date"];
const MAX_LEN = 120;

// Revoke keys: only a hash of each key is stored on the server, never personal data.
const KEYFILE = path.join(__dirname, "revoke-keys.json");
let keys = {};
try { keys = JSON.parse(fs.readFileSync(KEYFILE, "utf8")); } catch {}
const saveKeys = () => fs.writeFileSync(KEYFILE, JSON.stringify(keys));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "../frontend")));
const wrap = f => (q, r) => f(q, r).catch(e => r.status(400).json({ error: e.shortMessage || e.message }));

// Serialise transactions so concurrent requests never reuse a nonce.
let queue = Promise.resolve();
const serial = fn => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

const blockTimes = new Map();
async function blockTime(n) {
  if (!blockTimes.has(n)) blockTimes.set(n, (await provider.getBlock(n)).timestamp);
  return blockTimes.get(n);
}

async function ledger() {
  const [issued, revoked] = await Promise.all([contract.queryFilter(contract.filters.Issued()), contract.queryFilter(contract.filters.Revoked())]);
  const rev = new Map(revoked.map(e => [e.args.root, e]));
  const rows = await Promise.all(issued.map(async e => ({
    root: e.args.root.slice(2), issuer: e.args.issuer, block: e.blockNumber, txHash: e.transactionHash,
    issuedAt: await blockTime(e.blockNumber), revoked: rev.has(e.args.root),
    revokedBlock: rev.has(e.args.root) ? rev.get(e.args.root).blockNumber : null,
  })));
  return rows.reverse(); // newest first
}

function makeFields(body) {
  return [...FIELDS, ...OPTIONAL].flatMap(k => {
    const v = String(body[k] || "").trim();
    if (!v) { if (FIELDS.includes(k)) throw new Error("Missing field: " + k); return []; }
    if (v.length > MAX_LEN) throw new Error(`Field "${k}" is too long (max ${MAX_LEN} characters)`);
    const s = crypto.randomBytes(6).toString("hex");
    return [{ k, v, s, h: sha(`${s}:${k}:${v}`) }];
  });
}

async function issueOne(body) {
  const fields = makeFields(body);
  const root = sha(fields.map(f => f.h).join(""));
  const revokeKey = crypto.randomBytes(16).toString("hex");
  const { tx, rc } = await serial(async () => { const tx = await contract.issue("0x" + root); return { tx, rc: await tx.wait() }; });
  keys[root] = sha(revokeKey); saveKeys();
  return { root, fields, revokeKey, txHash: tx.hash, block: rc.blockNumber };
}

app.get("/api/info", wrap(async (q, r) => {
  const [n, block, rows] = await Promise.all([provider.getNetwork(), provider.getBlockNumber(), ledger()]);
  r.json({
    network: "chain " + n.chainId, block, address,
    total: rows.length, revoked: rows.filter(x => x.revoked).length,
    issuers: new Set(rows.map(x => x.issuer)).size,
    certs: rows.map(x => ({ root: x.root, block: x.block })),
  });
}));

app.get("/api/certs", wrap(async (q, r) => r.json(await ledger())));

app.get("/api/lookup/:root", wrap(async (q, r) => {
  if (!/^[0-9a-f]{64}$/.test(q.params.root)) throw new Error("Invalid certificate fingerprint");
  const [exists, revoked, issuer, issuedAt] = await contract.verify("0x" + q.params.root);
  r.json({ status: !exists ? "notfound" : revoked ? "revoked" : "valid", issuer, issuedAt: Number(issuedAt) });
}));

app.post("/api/issue", wrap(async (q, r) => r.json(await issueOne(q.body))));

app.post("/api/batch", wrap(async (q, r) => {
  const rows = q.body.rows;
  if (!Array.isArray(rows) || !rows.length) throw new Error("No rows to issue");
  if (rows.length > 50) throw new Error("Batch limit is 50 certificates at a time");
  rows.forEach((row, i) => { try { makeFields(row); } catch (e) { throw new Error(`Row ${i + 1}: ${e.message}`); } });
  const results = [];
  for (const row of rows) results.push(await issueOne(row));
  r.json({ results });
}));

app.post("/api/verify", wrap(async (q, r) => {
  let p;
  try { p = JSON.parse(q.body.pkg); if (!Array.isArray(p.fields) || typeof p.root !== "string") throw 0; }
  catch { throw new Error("That does not look like a share package."); }
  const shown = [], hiddenKeys = [];
  const hs = p.fields.map(x => {
    if (x.s !== undefined) { shown.push([x.k, x.v]); return sha(`${x.s}:${x.k}:${x.v}`); }
    hiddenKeys.push(x.k); return x.h;
  });
  const root = sha(hs.join(""));
  if (root !== p.root) return r.json({ status: "altered" });
  const [exists, revoked, issuer, issuedAt] = await contract.verify("0x" + root);
  r.json({ status: !exists ? "notfound" : revoked ? "revoked" : "valid", root, issuer, issuedAt: Number(issuedAt), shown, hidden: hiddenKeys.length, hiddenKeys });
}));

app.post("/api/revoke", wrap(async (q, r) => {
  const { root, revokeKey } = q.body;
  if (!/^[0-9a-f]{64}$/.test(root || "")) throw new Error("Invalid certificate fingerprint");
  if (!keys[root] || keys[root] !== sha(String(revokeKey || ""))) throw new Error("Wrong revoke key for this certificate");
  const tx = await serial(async () => { const tx = await contract.revoke("0x" + root); await tx.wait(); return tx; });
  r.json({ txHash: tx.hash });
}));

app.listen(process.env.PORT || 3000, () => console.log("CertiChain running at http://localhost:" + (process.env.PORT || 3000)));
