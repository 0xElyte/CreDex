# Architecture

This document describes the current onchain architecture of **credex-zk** and the intended extension points for integrating real zero-knowledge proof verification.

## Goals

- Provide a minimal Starknet contract that can:
  - Validate a requested credit tier against a score-based policy
  - Record a wallet’s verification timestamp and tier
  - Allow other contracts/apps to check whether a wallet currently has a valid verification

## Non-goals (current implementation)

- Onchain verification of a ZK proof (the contract does not verify cryptographic proofs today).
- Privacy (the score is provided directly as input).
- Governance, access control, or admin-managed configuration.

## High-level components

### 1) Public interface: `ICreditProofVerifier`

Defined in `src/lib.cairo` as a Starknet interface trait.

- `verify_credit_proof(ref self, wallet, score, threshold, requested_tier, proof_nonce) -> bool`
- `check_proof_valid(self, wallet) -> (bool, u8)`
- `get_tier_threshold(self, tier) -> u32`

The interface is intended to be consumed by:

- Frontends that need to attest a wallet’s credit tier
- Other Starknet contracts that need to gate actions based on an active tier verification

### 2) Contract module: `CreditProofVerifier`

Implements the interface and contains:

- Storage maps for wallet verification state
- Events for auditability
- Internal tier validation logic

## Data model

Storage lives under `CreditProofVerifier::Storage`:

- `verified_wallets: Map<ContractAddress, u64>`
  - Meaning: timestamp (seconds) of the most recent successful verification
  - `0` indicates “no verification recorded”
- `wallet_tier: Map<ContractAddress, u8>`
  - Meaning: tier recorded for the wallet at verification time

The contract currently treats a verification as valid for:

- `current_time - proof_time < 3600` (1 hour)

## Policy model

Tiers and thresholds are hard-coded:

- Tier 4 (Platinum): score ≥ 850
- Tier 3 (Gold): score ≥ 700
- Tier 2 (Silver): score ≥ 550
- Tier 1 (Bronze): score ≥ 400

The helper `get_tier_threshold(tier)` returns the threshold used by this policy.

## Main flows

### `verify_credit_proof(...)`

Purpose: validate inputs and, on success, write attestation state for `wallet`.

Flow (simplified):

1. Validate that `score` satisfies the minimum for `requested_tier`
   - Internal: `_validate_tier(score, requested_tier)`
   - On failure: emit `ProofRejected(wallet, 'INVALID_TIER')`, return `false`
2. Validate that `score >= threshold` (caller-provided threshold)
   - On failure: emit `ProofRejected(wallet, 'BELOW_THRESHOLD')`, return `false`
3. Record verification:
   - `timestamp = get_block_timestamp()`
   - `verified_wallets[wallet] = timestamp`
   - `wallet_tier[wallet] = requested_tier`
   - emit `ProofVerified(wallet, tier, timestamp)`
4. Return `true`

Notes:

- `proof_nonce` is accepted but currently unused (not stored, not validated).
- `threshold` is caller-provided; the contract does not require it to match `get_tier_threshold(requested_tier)`.

### `check_proof_valid(wallet)`

Purpose: allow read-only verification status checks.

Flow:

1. Read `proof_time = verified_wallets[wallet]`
   - If `proof_time == 0`: return `(false, 0)`
2. Read `current_time = get_block_timestamp()`
3. Compute `is_valid = (current_time - proof_time) < 3600`
4. Read `tier = wallet_tier[wallet]`
5. Return `(is_valid, tier)`

### Events

Events are emitted for observability and offchain indexing:

- `ProofVerified(wallet, tier, timestamp)` on successful verification
- `ProofRejected(wallet, reason)` on rejected verification attempt

## Testing architecture

Tests are implemented in `src/tests.cairo` using `snforge_std`.

- Deployment pattern: each test declares and deploys a fresh contract instance.
- Time-sensitive behavior: uses Starknet Foundry cheatcodes to set block timestamp.
  - `start_cheat_block_timestamp(...)` / `stop_cheat_block_timestamp(...)`
- Coverage:
  - Approvals for Platinum and Gold
  - Rejections for invalid tier claims and low scores
  - Expiration after > 1 hour
  - Default state for wallets with no prior verification

## Trust boundaries & security considerations

Current trust model:

- The contract trusts the caller to provide a truthful `score`.
- The contract does not authenticate “verifier” identities; any caller can write state for any `wallet`.

Key risks:

- **Forged attestations:** anyone can call `verify_credit_proof` for a victim wallet and store an arbitrary tier (as long as they pass the simple checks).
- **Threshold mismatch:** because `threshold` is caller-supplied, callers can pass a lower value than the tier’s policy threshold.
- **Nonce replay not prevented:** `proof_nonce` is not enforced; repeated calls overwrite state.
- **Time manipulation:** validity depends on `get_block_timestamp()` which is not a trusted wall-clock.

## Extension points (recommended next steps)

To evolve this into a real “zk credit proof” verifier, consider:

1. **Replace `score` inputs with proof verification**
   - Verify a proof and extract a public output (e.g., “tier >= X” or “score >= threshold”).
   - Persist a proof commitment/hash and enforce uniqueness to prevent replay.
2. **Add authorization**
   - Restrict who can write attestations (e.g., allowlisted verifiers, signatures from issuer, or account abstraction validation).
3. **Unify policy**
   - Remove caller-provided `threshold` or enforce `threshold == get_tier_threshold(requested_tier)`.
   - Make thresholds and expiry configurable (with governance and/or immutable parameters).
4. **Strengthen attestation semantics**
   - Bind attestations to the proving wallet (require the wallet to call, or verify wallet signatures).
   - Consider storing `verified_at` and `expires_at` explicitly.

## Operational notes

- `snfoundry.toml` is used for `sncast` profiles. Avoid committing API keys or production credentials in repository config; prefer environment-specific configuration for RPC URLs and accounts.
