# Lendr Protocol

**On-chain credit scoring → single-use Starknet proof → tier-adjusted DeFi lending on EVM**

Lendr replaces the credit bureau with a borrower's wallet history. A Python scoring engine reads six on-chain signals from Alchemy and produces a deterministic 0–1000 credit score. A Go backend calls a Cairo circuit on Starknet Sepolia, which issues a signed proof context. The backend relays that proof to a registry contract on Ethereum Sepolia, where it is stored keyed by a unique nonce. The borrower then calls the lending contract directly from their wallet, passing the nonce as calldata — the contract consumes the proof once, checks tier constraints, locks collateral, and disburses the stablecoin in a single atomic transaction.

**Live app:** [lendr-protocol.vercel.app](https://lendr-protocol.vercel.app)  
**Network:** Ethereum Sepolia · Chain ID `11155111`

> **Recommended RPC:** `https://eth-sepolia.g.alchemy.com/v2/<YOUR_KEY>`  
> Tenderly's free Sepolia gateway has aggressive rate limits that break transaction polling. Change it in MetaMask → Settings → Networks → Ethereum Sepolia before using the app.

---

## Table of contents

1. [System architecture](#1-system-architecture)
2. [Credit scoring engine](#2-credit-scoring-engine)
3. [Proof relay pipeline](#3-proof-relay-pipeline)
4. [Smart contracts](#4-smart-contracts)
5. [Interest accrual model](#5-interest-accrual-model)
6. [Soulbound credit token](#6-soulbound-credit-token)
7. [Loan lifecycle](#7-loan-lifecycle)
8. [Pool accounting](#8-pool-accounting)
9. [Contract methods](#9-contract-methods)
10. [Events](#10-events)
11. [Custom errors](#11-custom-errors)
12. [Backend API](#12-backend-api)
13. [Deployed contracts](#13-deployed-contracts)
14. [Running locally](#14-running-locally)
15. [Environment variables](#15-environment-variables)
16. [Project structure](#16-project-structure)
17. [Security model](#17-security-model)
18. [Tech stack](#18-tech-stack)

---

## 1. System architecture

Lendr is composed of four independent services that communicate in a strict pipeline. No service holds user funds. All fund movement happens in user-signed on-chain transactions.

**The four services:**

- **Scoring engine** — a stateless Python/FastAPI service running on port 8001. It accepts a wallet address, queries Alchemy for the wallet's on-chain history, computes six signals, and returns a score between 0 and 1000 along with a credit tier and loan terms. It has no database and holds no state between requests.

- **Go backend** — a REST API running on port 8000. It calls the scoring engine, then calls the Cairo CreditVerifier on Starknet Sepolia, converts the result into an EVM-compatible proof context struct, and submits it to the `RelayedCreditVerifier` contract on Ethereum Sepolia. It returns the proof identifier to the frontend.

- **RelayedCreditVerifier** — an EVM contract that acts as an on-chain proof registry. The Go backend's relayer wallet is the only address authorised to write to it. It stores proof contexts keyed by a 32-byte identifier. `CredexLending` reads from it (view call) to validate a borrower before originating a loan.

- **CredexLending** — the core EVM contract that handles all fund movement: lender deposits, loan origination, repayment, default, and liquidation. It calls `RelayedCreditVerifier` internally to validate the proof, marks the proof consumed on success, and never accepts the same proof twice.

**Transaction count per borrow:** three on-chain transactions total. Two are signed by the user's wallet (ERC-20 approval for collateral, then `requestLoan`). One is submitted by the backend's relayer wallet (`relay` on `RelayedCreditVerifier`) before the user signs anything.

**Transaction count per repay:** two on-chain transactions signed by the user's wallet — ERC-20 approval for the repayment amount (principal plus accrued interest), then `repayLoan`. Collateral is returned to the borrower atomically in the same `repayLoan` transaction.

---

## 2. Credit scoring engine

The scoring engine is a stateless FastAPI service. On every request it fetches raw on-chain data from Alchemy and derives a score from six independent signals. There is no database, no caching, and no concept of registered users — the wallet address is the only input.

### 2.1 Signals

| Signal | Max points | Data source |
|---|---|---|
| Wallet age | 150 | Timestamp of the wallet's first ever outbound transaction |
| DeFi repayment history | 300 | Count of outbound transactions to tracked protocol addresses with a known repayment method selector |
| Liquidation penalty | −200 | `LiquidationCall` and `AbsorbCollateral` event logs emitted by tracked protocols |
| Volume consistency | 200 | Coefficient of variation of monthly USD transaction volume across the last 1 000 transactions |
| Protocol diversity | 150 | Number of distinct DeFi protocols the wallet has interacted with, capped at five |
| World ID bonus | 100 | Wallet address present in the `WORLD_ID_VERIFIED` environment list |

The raw total before the liquidation penalty is 900 points. The final score is clamped to the range 0–1000. Wallets that score below 400 are promoted to 400 (the Bronze floor) on Sepolia so that test wallets with no DeFi history are still able to borrow.

### 2.2 Signal computation

**Wallet age** scores linearly up to a two-year maximum. A wallet active for one year earns 75 points; a wallet active for two or more years earns the full 150. Wallets with no transaction history receive 0.

**Repayment history** counts outbound calls to the following protocol addresses where the 4-byte method selector matches a known repayment function: `0x573ade81` (Aave repay), `0x69328dec` (Aave repayWithPermit), `0xdb006a75` (Compound repayBorrow), `0x4e4d9fea` (cToken repayBorrowBehalf), `0x2e1a7d4d` (WETH withdraw used as repay). Each qualifying repayment adds 30 points, up to the 300-point ceiling.

**Liquidation penalty** scans event logs from a rolling 500 000-block window (approximately 69 days on Sepolia at 12-second block times) against two event topic hashes that identify liquidation events on Aave V3 and Compound V3. Each liquidation deducts 100 points, up to the 200-point cap. The rolling window is used because Alchemy rejects unbounded `eth_getLogs` range queries on Sepolia.

**Volume consistency** groups all transactions by calendar month and computes the coefficient of variation (standard deviation divided by mean) of the USD volume across those months. A CV of 0 — perfectly consistent monthly volume — yields 200 points. A CV of 1 or above yields 0. The intermediate score scales linearly between those bounds.

**Protocol diversity** awards 30 points per unique DeFi protocol interacted with, capped at 150 points (five protocols). The tracked protocol list covers Aave V3, Compound V3, Compound V2, Uniswap V2, Uniswap V3, SushiSwap, Lido, the ETH2 deposit contract, and their Sepolia equivalents.

**World ID bonus** is a flat 100-point addition for wallets whose address appears in the `WORLD_ID_VERIFIED` environment variable. This is a comma-separated list maintained by the operator.

### 2.3 Tier mapping

| Tier | Score range | Max borrow | Interest APR | Minimum collateral |
|---|---|---|---|---|
| Bronze | 400 – 549 | 500 USDC | 22% | 65% of loan value |
| Silver | 550 – 699 | 2,000 USDC | 14% | 50% of loan value |
| Gold | 700 – 849 | 5,000 USDC | 8% | 35% of loan value |
| Platinum | 850 – 1000 | 10,000 USDC | 4% | 20% of loan value |

These values are stored on-chain in `CredexLending` as basis-point integers. The owner can update any tier's parameters without redeploying the contract.

---

## 3. Proof relay pipeline

The proof pipeline connects the off-chain scoring result to an on-chain permission that only the intended borrower can consume, exactly once.

**Step 1 — Score request.** When the user initiates a borrow, the frontend calls the Go backend's loan request endpoint. The backend calls the scoring engine, which returns the wallet's tier and score.

**Step 2 — Starknet circuit call.** The backend makes a JSON-RPC `starknet_call` to the Cairo CreditVerifier contract on Starknet Sepolia. The contract returns four `felt252` values: a proof identifier, the approved credit tier, the maximum borrow amount, and an expiry timestamp. The Go backend converts these from Starknet's native 252-bit field elements into standard EVM types: a 32-byte proof ID, an 8-bit tier enum, a big integer for the amount, and a 64-bit Unix timestamp.

**Step 3 — On-chain relay.** The backend's relayer wallet submits a `relay` transaction to `RelayedCreditVerifier` on Ethereum Sepolia. This writes the full proof context struct (borrower address, tier, max amount, expiry, proof ID) into the contract's storage, keyed by the 32-byte proof ID. The contract emits a `ProofRelayed` event.

**Step 4 — Proof ID returned to frontend.** The backend responds to the frontend with the proof ID, the approved tier, and the maximum borrow amount. The frontend renders the ZK proof modal showing the pipeline steps and waits for the user to confirm.

**Step 5 — Loan origination.** The user's wallet calls `CredexLending.requestLoan`, passing the ABI-encoded proof ID as calldata. Internally the lending contract calls `RelayedCreditVerifier.verifyProof`, which decodes the proof ID, looks it up in storage, and validates: the borrower address matches, the expiry has not passed, and the proof status is `Unused`. If all checks pass, `CredexLending` marks the proof consumed (setting `consumedProofs[proofId] = true`), locks the collateral, and disburses the principal to the borrower. The proof ID cannot be reused.

### 3.1 Fallback behaviour

If `STARKNET_RPC_URL` or `STARKNET_VERIFIER_ADDRESS` are not set in the backend's environment, the Go backend constructs the proof context locally from the scoring engine output rather than calling Starknet. The relay step to `RelayedCreditVerifier` on Ethereum Sepolia still happens — so the loan flow remains fully on-chain even when the Starknet bridge is not configured.

---

## 4. Smart contracts

All contracts are compiled with Foundry against Solidity 0.8.24. OpenZeppelin v5 provides the base implementations for ownership, reentrancy protection, safe ERC-20 transfers, ERC-721, and overflow-safe arithmetic.

### 4.1 CredexLending

`CredexLending` is the single contract that holds all user funds. It manages four categories of state: the pool (lender deposits and available liquidity), loans (one active loan per borrower at a time), borrower profiles (credit history, streak, flags), and tier configurations.

**Storage structure.** Loans are stored in a mapping from a sequential integer loan ID to a `Loan` struct (22 fields including principal, collateral, interest rate, credit tier, start timestamp, due timestamp, grace period end, and proof ID). Borrower profiles are stored in a mapping from wallet address to a `BorrowerProfile` struct tracking whether a loan is active, total loans repaid, repayment streak, defaults, and a permanent flag. Tier configurations are stored in a mapping from the `CreditTier` enum to a `TierConfig` struct with the collateral ratio, interest rate, maximum loan amount, and active flag. Lender deposits are tracked as a simple mapping from address to deposited amount.

**Immutable parameters.** The debt asset address (mUSDC), collateral asset address (mCOLL), loan duration, grace period, and liquidation delay are all set at deploy time and cannot be changed without redeployment. The current deployment uses 365-day loan duration and 30-day grace period.

**Loan origination flow.** The contract first checks that the borrower has no active loan and has not been permanently flagged. It then calls `verifyProof` on `RelayedCreditVerifier` to obtain the proof context, validates the context (borrower match, expiry, unused status, amount cap), looks up the tier configuration for the approved tier, computes the required collateral as `ceil(principal × minCollateralRatioBps / 10 000)`, and verifies the submitted collateral meets that threshold. If all checks pass, it pulls the collateral from the borrower's wallet, creates the loan record, marks the proof consumed, updates the borrower profile, updates pool state, pushes the principal to the borrower, and mints or updates the SBT. Every step uses `SafeERC20` and a `nonReentrant` modifier.

### 4.2 RelayedCreditVerifier

`RelayedCreditVerifier` implements the `ICreditVerifier` interface and acts as a write-then-read bridge between the Go backend and `CredexLending`. The backend's relayer wallet is the only address allowed to call `relay`. The `verifyProof` function is a view function callable by anyone — `CredexLending` calls it as part of loan origination.

The `sourceChainId` field in relayed proof contexts is set to zero, which makes the verifier accept the proof on any EVM chain. This means the same `RelayedCreditVerifier` deployment could serve multiple EVM chains from a single Starknet proof source.

### 4.3 CredexSBT

`CredexSBT` is an ERC-721 contract where each borrower can hold at most one token. The token acts as an immutable on-chain record of a borrower's credit history. It stores: the current tier, total loans repaid, repayment streak, a default flag, and timestamps for issuance and last update.

Only addresses in the `authorizedUpdaters` mapping can mint or update tokens. `CredexLending` is granted this permission at deploy time. The SBT is minted automatically on the borrower's first loan and updated on every loan event (repay, default, liquidation). The `defaultFlag` field, once set to `true` through a default event, is stored permanently on-chain.

### 4.4 Type library

All shared types are defined in `CredexTypes`. `LoanStatus` has five states: `None`, `Active`, `Repaid`, `Defaulted`, `Liquidated`. `CreditTier` has five values: `None`, `Bronze`, `Silver`, `Gold`, `Platinum`. `ProofStatus` has four values: `Unused`, `Consumed`, `Expired`, `Revoked`. These enums are used in storage, events, and error conditions throughout the protocol.

---

## 5. Interest accrual model

Interest accrues continuously from the moment the loan is originated. Accrual is per-second, based on the annual interest rate stored in the loan record at origination time.

**Accrual period.** Interest accrues from `startTimestamp` to `min(current block timestamp, dueTimestamp)`. Once the loan is past its due date, accrual stops — there is no penalty interest, and the amount due does not grow further. A borrower who repays after the due date but within the grace period pays the same amount as one who repaid exactly at the due date.

**Calculation.** The amount due is computed as: `principal + (principal × interestRateBps × elapsed) / (10 000 × seconds per year)`. The intermediate multiplication uses OpenZeppelin's 512-bit `Math.mulDiv` to prevent overflow on large principal values.

**Collateral ratio check.** The required collateral for origination is computed with ceiling rounding: `ceil(principal × minCollateralRatioBps / 10 000)`. Ceiling rounding closes the sub-unit dust gap that could otherwise allow slightly undercollateralised positions.

**Approval buffer.** Because Sepolia block times vary between 12 and 48 seconds and interest accrues every second, the frontend reads the amount due via a view call and then approves 1% more plus 50 000 base units (0.05 USDC at 6 decimals). This buffer ensures the on-chain approval is sufficient even if one or two blocks pass between the read and the execution.

**Example — Bronze tier, 500 USDC, repaid after 30 days.** At 22% APR, 30 days of accrual on 500 USDC yields approximately 9.04 USDC in interest. The total amount due is approximately 509.04 USDC. The approval would be set to approximately 514.09 USDC including the 1% buffer.

---

## 6. Soulbound credit token

Each borrower holds exactly one `CredexSBT` token, minted automatically on their first loan. The token is not economically valuable — it has no transfer restrictions at the contract level — but its data is authoritative: only `CredexLending` can update it, and every update is triggered by a real on-chain loan event.

**What gets recorded on each event:**

| Event | Fields updated |
|---|---|
| First `requestLoan` | Token minted. Current tier and issuance timestamp set. |
| Subsequent `requestLoan` | Current tier updated. |
| `repayLoan` repaid on time (before due date) | Total loans repaid incremented. Repayment streak incremented. Best streak updated if exceeded. |
| `repayLoan` repaid late (after due date, within grace period) | Total loans repaid incremented. Repayment streak reset to zero. |
| `markDefault` | Default flag set to true. Repayment streak reset to zero. Borrower permanently flagged. |
| `liquidateLoan` | Default flag already set. No additional change. |

**Permanent blacklisting.** When `markDefault` is called, the `permanentlyFlagged` field on the borrower's profile is set to `true` on-chain. Every future `requestLoan` call from that wallet reverts with `UnauthorizedCaller`. There is no owner override — the blacklist is enforced at the contract level.

---

## 7. Loan lifecycle

Every loan begins in the `None` state (no record exists) and transitions through a defined set of states. The transition rules are enforced by the contract — no transition can be skipped or reversed.

**None → Active.** Triggered by `requestLoan`. Requires a valid unused proof, sufficient collateral, available liquidity, and no existing active loan. The loan record is created and the borrower profile is updated.

**Active → Repaid.** Triggered by `repayLoan`. The borrower must call this before `gracePeriodEndsAt`. The contract pulls the amount due from the borrower's wallet and simultaneously returns the locked collateral. If repayment occurs before `dueTimestamp`, the repayment streak increments; if it occurs after `dueTimestamp` but within the grace period, the streak resets to zero.

**Active → Defaulted.** Triggered by `markDefault`, which is permissionless — any address can call it once `block.timestamp` exceeds `gracePeriodEndsAt`. The borrower profile's `totalDefaults` count increments and `permanentlyFlagged` is set to true.

**Defaulted → Liquidated.** Triggered by `liquidateLoan`, also permissionless. The call is only accepted once a delay period (equal to `liquidationDelaySeconds`, currently 30 days) has elapsed after the due timestamp. On liquidation, the locked collateral is transferred to the contract owner.

**One active loan at a time.** The `hasActiveLoan` flag on the borrower profile prevents a second `requestLoan` until the existing loan reaches a terminal state.

---

## 8. Pool accounting

`CredexLending` maintains eight running pool totals, updated atomically on every state transition. There is no separate pool contract — accounting is internal to `CredexLending`.

**The eight totals:**

| Field | Meaning |
|---|---|
| `totalLiquidity` | All USDC ever deposited by lenders or received as repayment interest |
| `availableLiquidity` | USDC the contract can lend right now |
| `totalPrincipalOutstanding` | USDC currently outstanding in active loans |
| `totalCollateralLocked` | mCOLL currently held as collateral across all active loans |
| `totalInterestCollected` | Cumulative interest received from all repayments |
| `totalDefaults` | Count of loans that have been marked defaulted |
| `totalLiquidations` | Count of loans that have been liquidated |
| `totalSeizedCollateral` | Cumulative mCOLL transferred to the owner through liquidations |

**How each operation moves the totals:**

| Operation | `availableLiquidity` | `totalPrincipalOutstanding` | `totalCollateralLocked` |
|---|---|---|---|
| Lender deposit | Increases by deposit amount | No change | No change |
| Lender withdrawal | Decreases by withdrawal amount | No change | No change |
| `requestLoan` | Decreases by principal | Increases by principal | Increases by collateral |
| `repayLoan` | Increases by full amount due | Decreases by principal | Decreases by collateral |
| `liquidateLoan` | No change | Decreases by principal | Decreases by collateral |

When a loan is repaid, `totalLiquidity` also increases by the interest portion — this is how yield accrues to the pool. Lenders earn a proportional share of the pool based on their `lenderDeposits` balance relative to `totalLiquidity`.

---

## 9. Contract methods

### CredexLending — public and external functions

| Method | Type | Description |
|---|---|---|
| `requestLoan(principal, collateral, proofData)` | Write | Originate a loan. Proof consumed, collateral locked, principal disbursed. |
| `repayLoan(loanId)` | Write | Repay an active loan within the grace period. Returns collateral. |
| `markDefault(loanId)` | Write (permissionless) | Transition an overdue loan to Defaulted. |
| `liquidateLoan(loanId)` | Write (permissionless) | Seize collateral from a Defaulted loan after delay. |
| `deposit(amount)` | Write | Lender deposits mUSDC into the pool. |
| `withdraw(amount)` | Write | Lender withdraws their deposited mUSDC. |
| `getAmountDue(loanId)` | View | Current repayment amount including accrued interest. |
| `getBorrowerProfile(address)` | View | Full borrower profile: tier, streak, flags, active loan. |
| `getLoan(loanId)` | View | Full loan record. |
| `getPoolState()` | View | All eight pool accounting totals. |
| `getTierConfig(tier)` | View | Collateral ratio, interest rate, max amount for a tier. |
| `previewRequiredCollateral(tier, principal)` | View | Compute required collateral for a given tier and amount. |
| `setTierConfig(...)` | Write (owner) | Update rate and ratio parameters for a tier. |
| `setVerifier(address)` | Write (owner) | Update the proof verifier contract address. |
| `supplyLiquidity(amount)` | Write (owner) | Seed the pool with initial liquidity. |
| `withdrawLiquidity(amount, to)` | Write (owner) | Remove owner-supplied liquidity. |

### RelayedCreditVerifier — public and external functions

| Method | Type | Description |
|---|---|---|
| `relay(ProofContext)` | Write (relayer) | Store a proof context on-chain by its proof ID. |
| `verifyProof(borrower, proofData)` | View | Decode proof ID from calldata and return the stored context. Reverts if invalid. |
| `isProofConsumed(proofId)` | View | Check whether a specific proof has already been used. |
| `getProofStatus(proofId)` | View | Return the current `ProofStatus` for a proof ID. |
| `setAuthorizedRelayer(address, bool)` | Write (owner) | Grant or revoke relay permission. |

### CredexSBT — public and external functions

| Method | Type | Description |
|---|---|---|
| `mintForBorrower(address, tier)` | Write (updater) | Mint the SBT for a first-time borrower. |
| `updateBorrowerState(address, tier, repaid, streak, flagged)` | Write (updater) | Update metadata after a loan event. |
| `getMetadata(tokenId)` | View | Full SBT metadata struct for a token. |
| `tokenIdOf(address)` | View | Token ID for a given borrower address. Returns 0 if none. |
| `hasToken(address)` | View | Whether a borrower already has an SBT. |
| `setAuthorizedUpdater(address, bool)` | Write (owner) | Grant or revoke SBT write permission. |

---

## 10. Events

All events are defined in `CredexEvents.sol` and emitted by `CredexLending`, `CredexSBT`, and `RelayedCreditVerifier`.

| Event | Emitted by | Indexed fields |
|---|---|---|
| `LoanApproved(loanId, borrower, principal, collateral, tier, timestamp)` | CredexLending | loanId, borrower |
| `LoanRepaid(loanId, borrower, repaymentAmount, timestamp)` | CredexLending | loanId, borrower |
| `LoanDefaulted(loanId, borrower, timestamp)` | CredexLending | loanId, borrower |
| `LoanLiquidated(loanId, borrower, seizedCollateral, timestamp)` | CredexLending | loanId, borrower |
| `CollateralDeposited(loanId, borrower, asset, amount)` | CredexLending | loanId, borrower, asset |
| `CollateralReleased(loanId, borrower, asset, amount)` | CredexLending | loanId, borrower, asset |
| `CollateralSeized(loanId, borrower, asset, amount)` | CredexLending | loanId, borrower, asset |
| `BorrowerProfileUpdated(borrower, tier, hasActiveLoan, activeLoanId, timestamp)` | CredexLending | borrower |
| `BorrowerFlagged(borrower, permanentlyFlagged, timestamp)` | CredexLending | borrower |
| `TierConfigUpdated(tier, collateralBps, interestBps, maxLoan, active)` | CredexLending | tier |
| `VerifierUpdated(newVerifier)` | CredexLending | newVerifier |
| `LenderDeposited(lender, amount)` | CredexLending | — |
| `LenderWithdrawn(lender, amount)` | CredexLending | — |
| `CreditSBTMinted(tokenId, borrower, timestamp)` | CredexSBT | tokenId, borrower |
| `CreditSBTUpdated(tokenId, borrower, tier, streak, totalRepaid, defaultFlag, timestamp)` | CredexSBT | tokenId, borrower |
| `ProofRelayed(proofId, borrower, tier)` | RelayedCreditVerifier | proofId, borrower |
| `RelayerSet(relayer, authorized)` | RelayedCreditVerifier | relayer |

---

## 11. Custom errors

Every revert path uses a typed custom error from `CredexErrors.sol`. There are no string-based `require` messages anywhere in the protocol.

| Error | Trigger condition |
|---|---|
| `ActiveLoanExists` | `requestLoan` called when `hasActiveLoan` is true |
| `NoActiveLoan` | Operation requires an active loan but none exists |
| `LoanNotFound` | The provided loan ID has no record in storage |
| `InvalidLoanStatus` | Operation requires a different `LoanStatus` than the current one |
| `LoanNotDefaulted` | `liquidateLoan` called before `markDefault` has been called |
| `LoanNotPastGracePeriod` | `markDefault` called before `gracePeriodEndsAt` has passed |
| `LoanPastDue` | `repayLoan` called after `gracePeriodEndsAt` |
| `LiquidationNotAllowed` | `liquidateLoan` called before the delay period has elapsed |
| `InvalidBorrowAmount` | Principal is zero, or exceeds the tier's maximum loan amount |
| `InvalidCollateralAmount` | Collateral argument is zero |
| `InsufficientCollateral` | Submitted collateral is less than the tier's required minimum |
| `PoolInsufficientLiquidity` | Available liquidity is less than the requested principal |
| `InvalidTierConfig` | Tier is inactive, or a constructor constraint is violated |
| `InvalidProof` | Proof ID is the zero bytes32 value, or proof status is Revoked |
| `ProofExpired` | `validUntil` is non-zero and is in the past |
| `ProofAlreadyConsumed` | Proof ID has been used in a prior `requestLoan` |
| `ProofBorrowerMismatch` | The proof's stored borrower address does not match `msg.sender` |
| `ProofAmountExceeded` | Requested principal exceeds the proof's `maxBorrowAmount` |
| `ProofTierMismatch` | The approved tier is `CreditTier.None` |
| `UnsupportedProofSource` | Proof has a non-zero `sourceChainId` that does not match the current chain |
| `UnauthorizedCaller` | A non-relayer calls `relay`, or a permanently-flagged borrower calls `requestLoan` |
| `ZeroAddressNotAllowed` | Any address argument equals the zero address |
| `UnauthorizedSBTUpdater` | SBT write attempted from an address not in `authorizedUpdaters` |
| `BorrowerAlreadyHasSBT` | `mintForBorrower` called for a wallet that already has a token |
| `TokenDoesNotExist` | `updateBorrowerState` called for a wallet with no SBT |

---

## 12. Backend API

The Go backend coordinates scoring, proof relay, and record-keeping. It does not hold any user funds directly — all fund movement requires a signature from the user's wallet.

### Score and identity

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Service and dependency status check |
| POST | `/api/v1/wallet/register` | Register a wallet address; returns existing record if already known |
| GET | `/api/v1/score/:wallet` | Full credit score, tier, signal breakdown, and loan terms for a wallet |

### Lending

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/loan/request` | Score the wallet, relay a proof to `RelayedCreditVerifier`, return the proof ID and tier |
| POST | `/api/v1/loan/confirm` | Store the mapping between the backend's loan record and the on-chain loan ID after `requestLoan` confirms |
| POST | `/api/v1/loan/repay` | Mark a loan as repaid in the backend store after the on-chain `repayLoan` transaction confirms |
| GET | `/api/v1/loan/status/:wallet` | Active loans and loan history for a wallet |

### Lending pool

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/deposit` | Record a lender deposit in the backend store |
| GET | `/api/v1/deposit/:wallet` | Lender's current position |

### Scoring engine API (internal, port 8001)

| Method | Path | Request body | Description |
|---|---|---|---|
| GET | `/health` | — | Engine readiness check |
| POST | `/score` | `wallet_address` (string), `chain_id` (integer) | Returns the full score response |

The score response contains: the wallet address, the numeric score, the credit tier, a signals object (all six signal scores, total transactions, repayment count, liquidation count, unique protocols, wallet age in days, World ID boolean), a loan terms object (eligible boolean, collateral percentage, APR, max loan amount), and degraded-mode flags that indicate if any Alchemy call failed partially and which signals are missing.

---

## 13. Deployed contracts

All contracts are deployed on Ethereum Sepolia, chain ID `11155111`.

| Contract | Address | Etherscan |
|---|---|---|
| CredexLending | `0x7e9A18f269de75D0b4Cd497d9100eBE6C7Ef1c2E` | [View](https://sepolia.etherscan.io/address/0x7e9A18f269de75D0b4Cd497d9100eBE6C7Ef1c2E) |
| CredexSBT | `0x7E24E3E7cBb442E954Cf580d70dC84381F32ccDf` | [View](https://sepolia.etherscan.io/address/0x7E24E3E7cBb442E954Cf580d70dC84381F32ccDf) |
| RelayedCreditVerifier | `0x9280972165D77a710AbBBAE7a6476ED61DaFDf80` | [View](https://sepolia.etherscan.io/address/0x9280972165D77a710AbBBAE7a6476ED61DaFDf80) |
| mUSDC (debt asset, 6 decimals) | `0x0ed7269d9Cc82b16E9E6D0f40c3bbF64c6Be17c2` | [View](https://sepolia.etherscan.io/address/0x0ed7269d9Cc82b16E9E6D0f40c3bbF64c6Be17c2) |
| mCOLL (collateral, 6 decimals) | `0x2858Cb1D9C7b2e0420d04A0E988c4C425eF50964` | [View](https://sepolia.etherscan.io/address/0x2858Cb1D9C7b2e0420d04A0E988c4C425eF50964) |

**CredexLending deploy parameters:** loan duration 365 days, grace period 30 days, liquidation delay 30 days post-due. Pool seeded with 10,000 mUSDC at deploy time.

**Relayer wallet:** `0x9D9033Ffa946D73B1A9530A47386Fe206CDb4Da0`

---

## 14. Running locally

### Prerequisites

| Tool | Minimum version |
|---|---|
| Node.js | 18 |
| Go | 1.22 |
| Python | 3.10 |
| Foundry (`forge`, `cast`) | latest |
| MetaMask | any — configured for Ethereum Sepolia |

### Step 1 — Clone the repository

Clone the repo and navigate into it.

### Step 2 — Start the scoring engine

Copy `scoring/.env.example` to `scoring/.env` and fill in your Alchemy API key. Install Python dependencies from `scoring/requirements.txt` and start the FastAPI server with `python main.py`. It runs on port 8001.

### Step 3 — Start the backend

Copy `backend/.env.example` to `backend/.env`. Provide your Alchemy API key, the contract addresses from the deployed contracts table above, and a relayer private key (a funded Sepolia wallet). Run the server with `go run .` from the `backend/` directory. It runs on port 8000.

The backend starts cleanly without Starknet, Filecoin, or FHE configured. Each optional dependency logs a startup warning and falls back to a stub. The borrow and repay flows work fully on Sepolia without them.

### Step 4 — Start the frontend

Run `npm install` then `npm run dev` from the `credex-app/` directory. It runs on port 3000. The frontend talks to the backend at `localhost:8000` by default.

### Step 5 — Deploy contracts (only if not using the live deployment)

Copy `contracts/.env.example` to `contracts/.env` with your private key and RPC URL. Run `forge install` then `forge build`. For a full deployment run the `DeployCredexProtocol` Foundry script. To redeploy only the lending contract while keeping the existing SBT and verifier, run `RedeployLending`. Update the contract addresses in `backend/.env` after any deployment.

---

## 15. Environment variables

### backend/.env

| Variable | Description |
|---|---|
| `PORT` | HTTP port for the Gin server (default: 8000) |
| `GIN_MODE` | `debug` or `release` |
| `SCORING_ENGINE_URL` | Full URL of the scoring engine (default: `http://localhost:8001`) |
| `ALCHEMY_API_KEY` | Alchemy API key used by the backend for chain reads |
| `EVM_RPC_URL` | Ethereum Sepolia RPC endpoint |
| `LENDING_CONTRACT_ADDRESS` | `CredexLending` deployed address |
| `SBT_CONTRACT_ADDRESS` | `CredexSBT` deployed address |
| `RELAYED_VERIFIER_ADDRESS` | `RelayedCreditVerifier` deployed address |
| `RELAYER_PRIVATE_KEY` | Private key of the relayer wallet (never commit this) |
| `RELAYER_ADDRESS` | Public address of the relayer wallet |
| `DEBT_ASSET_ADDRESS` | mUSDC token address |
| `COLLATERAL_ASSET_ADDRESS` | mCOLL token address |
| `STARKNET_RPC_URL` | Starknet Sepolia JSON-RPC endpoint (optional) |
| `STARKNET_VERIFIER_ADDRESS` | Cairo CreditVerifier contract address (optional) |

### scoring/.env

| Variable | Description |
|---|---|
| `ALCHEMY_API_KEY` | Alchemy API key for on-chain signal reads |
| `CHAIN_ID` | Chain to score against (default: `11155111` for Sepolia) |
| `PORT` | HTTP port for the FastAPI server (default: 8001) |
| `WORLD_ID_VERIFIED` | Comma-separated wallet addresses that receive the +100 World ID bonus |

### contracts/.env

| Variable | Description |
|---|---|
| `PRIVATE_KEY` | Deployer private key |
| `RPC_URL` | Ethereum Sepolia RPC endpoint |
| `CREDIT_VERIFIER` | `RelayedCreditVerifier` address (used by RedeployLending script) |
| `DEBT_ASSET` | mUSDC address (used by RedeployLending script) |
| `COLLATERAL_ASSET` | mCOLL address (used by RedeployLending script) |

---

## 16. Project structure

**contracts/** contains all Solidity source files, interfaces, libraries, type definitions, and Foundry deploy scripts. Core contracts are in `src/core/`. Shared enums and structs are in `src/types/CredexTypes.sol`. All custom errors are in `src/libraries/CredexErrors.sol`. All events are in `src/libraries/CredexEvents.sol`. Test token contracts (mUSDC and mCOLL) are in `src/mocks/`.

**backend/** is a Go module structured around Gin. The `handlers/` package contains one file per route group (score, loan, deposit, wallet). The `chain/` package contains the EVM relayer (transaction signer using go-ethereum), the lending caller (submits `requestLoan` on-chain from the relayer wallet), and a Filecoin storage stub. The `relayer/` package contains the Starknet JSON-RPC client and proof context construction. The `store/` package holds an in-memory store for loan and deposit records. The `fhe/` package is an extensible stub for future FHE integration.

**scoring/** is a three-file Python package. `scorer.py` contains the `AlchemyFetcher` class (all Alchemy API calls) and the `CreditScorer` class (six signal functions, score assembly). `models.py` contains all Pydantic v2 request and response types with full validation. `main.py` is the FastAPI entry point with a single `/score` endpoint.

**credex-app/** is a Next.js 15 application. Pages live under `app/app/` and correspond to the four user-facing routes: hub (borrow/lend mode selector), borrow, lend, and portfolio. `lib/api.ts` contains every on-chain call — approvals, `requestLoan`, `repayLoan`, `getAmountDue`, `getBorrowerProfile`, and the transaction receipt polling loop with exponential backoff. `lib/backendApi.ts` is the REST client for the Go backend. State is managed through Redux slices (wallet, finance, toasts) combined with TanStack Query for server-side data fetching.

---

## 17. Security model

### Smart contracts

Every state-mutating function in `CredexLending` is protected by OpenZeppelin's `ReentrancyGuard`. All ERC-20 transfers use `SafeERC20`, which reverts on tokens that return false or no return value instead of silently passing. All arithmetic uses `Math.mulDiv`, which computes `(a × b) / denominator` using a 512-bit intermediate value — overflow is impossible regardless of token amounts. Collateral requirements are computed with ceiling rounding to prevent dust-amount exploits.

Proofs are single-use. The `consumedProofs` mapping is written before any external calls in `requestLoan`, so a proof ID can never be replayed even if the contract were called reentrantly. Permanently flagged borrowers are blocked at the smart contract level — no owner action can unblock a defaulted wallet.

`markDefault` and `liquidateLoan` are permissionless by design. Any address can trigger them once the time conditions are met. This prevents the protocol from being held hostage by an inactive owner.

### Proof relay trust model

Only addresses in `authorizedRelayers` can write to `RelayedCreditVerifier`. The owner can rotate the relayer key at any time. Setting `sourceChainId` to zero in relayed proofs means the same verifier can serve multiple EVM chains without modification.

### Backend

The backend never holds user funds and has no keys with more privilege than the relayer wallet (which can only call `relay`). The relayer private key is environment-only and is never logged or returned in any API response. All `.env` files are gitignored; `.env.example` files contain only placeholder values.

### Scoring engine

The engine is fully stateless. It stores no wallet data between requests. Pydantic v2 validates every incoming wallet address: must be 42 characters, start with `0x`, contain only hex characters, and not be the zero address. The chain ID is validated against a fixed allowlist of supported networks.

---

## 18. Tech stack

| Layer | Technology |
|---|---|
| Smart contracts | Solidity 0.8.24, Foundry, OpenZeppelin v5 |
| Backend | Go 1.22, Gin, go-ethereum |
| Scoring engine | Python 3.10, FastAPI, Pydantic v2, httpx |
| Frontend | Next.js 15, TypeScript, Tailwind CSS v4, Redux Toolkit, TanStack Query, GSAP, Recharts |
| Network | Ethereum Sepolia (chain ID 11155111) |
| On-chain data | Alchemy (asset transfers, event logs, block number) |
| Cross-chain proof source | Starknet Sepolia — Cairo CreditVerifier (optional) |

---

## License

MIT
