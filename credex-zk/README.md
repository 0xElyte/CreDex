# credex-zk

Starknet (Cairo) smart contract that records a **time-bounded credit tier verification** for a wallet address.

This repository currently implements *tier/threshold validation and attestation storage*; it does **not** yet verify a real zero-knowledge proof onchain (the `proof_nonce` argument is accepted but not persisted/validated).

## What it does

- Exposes an interface `ICreditProofVerifier` with:
  - `verify_credit_proof(wallet, score, threshold, requested_tier, proof_nonce) -> bool`
  - `check_proof_valid(wallet) -> (bool, u8)`
  - `get_tier_threshold(tier) -> u32`
- Stores the verification timestamp and selected tier for each wallet.
- Treats a verification as **valid for 1 hour** (3600 seconds) from the stored timestamp.
- Emits events for accepted/rejected verifications.

## Contract overview

- Contract module: `CreditProofVerifier` in `src/lib.cairo`
- Storage:
  - `verified_wallets: Map<ContractAddress, u64>` (timestamp of last verification)
  - `wallet_tier: Map<ContractAddress, u8>` (tier recorded at verification)
- Events:
  - `ProofVerified(wallet, tier, timestamp)`
  - `ProofRejected(wallet, reason)`

Tier rules (hard-coded):

| Tier | Label     | Minimum score |
|------|-----------|---------------|
| 4    | Platinum  | 850           |
| 3    | Gold      | 700           |
| 2    | Silver    | 550           |
| 1    | Bronze    | 400           |

## Repository layout

- `Scarb.toml` / `Scarb.lock`: Scarb package configuration
- `snfoundry.toml`: Starknet Foundry configuration (snforge/sncast profiles)
- `src/lib.cairo`: Contract + interface
- `src/tests.cairo`: `snforge` tests

## Prerequisites

- Scarb (Cairo package manager)
- Starknet Foundry (`snforge`, `sncast`)

## Build and test

Build:

```bash
scarb build
```

Run tests:

```bash
snforge test
```

## Deployment (high level)

This is a standard Starknet contract package (see `[[target.starknet-contract]]` in `Scarb.toml`). Deployment is typically done by declaring and deploying via Starknet Foundry (`sncast`) using the profile in `snfoundry.toml`.

Before using `sncast`, review `snfoundry.toml` and ensure the RPC URL/account settings are correct for your environment.

## Security & limitations (read before production use)

- **No ZK proof verification yet:** `score`, `threshold`, and `requested_tier` are provided as plain inputs and trusted; `proof_nonce` is not checked or stored.
- **Replay/overwrites:** A wallet can call `verify_credit_proof` repeatedly and overwrite its stored tier/timestamp.
- **Timestamp trust model:** Validity depends on `get_block_timestamp()` (sequencer-provided time).
- **Hard-coded policy:** Thresholds and validity window are hard-coded; there is no admin/governance mechanism.

If you intend to open-source or deploy publicly, consider adding:

- Onchain proof verification (or verifiable offchain attestation scheme)
- Nonce/commitment storage to prevent replay
- Access control / authorized verifiers
- Configurable thresholds and expiry policy

## Contributing

Issues and PRs welcome. Keep changes focused and include `snforge` tests for behavior changes.

## License

No license file is currently included. Add a license before distributing or deploying this code beyond private use.

