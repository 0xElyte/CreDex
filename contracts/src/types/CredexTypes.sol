// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library CredexTypes {
    // Represents the lifecycle state of a loan.
    enum LoanStatus {
        // Indicates no loan exists for the referenced id.
        None,
        // Indicates the loan has been originated and is currently outstanding.
        Active,
        // Indicates the loan has been fully repaid and closed.
        Repaid,
        // Indicates the loan passed its grace period without repayment.
        Defaulted,
        // Indicates the defaulted loan has been finalized through collateral seizure.
        Liquidated
    }

    // Represents the borrower credit tier used for lending rules.
    enum CreditTier {
        // Indicates no tier has been assigned.
        None,
        // Indicates the lowest eligible lending tier.
        Bronze,
        // Indicates the mid-low lending tier.
        Silver,
        // Indicates the mid-high lending tier.
        Gold,
        // Indicates the highest lending tier.
        Platinum
    }

    // Represents the validity state of an eligibility proof.
    enum ProofStatus {
        // Indicates the proof has not been consumed yet.
        Unused,
        // Indicates the proof has already been used for origination.
        Consumed,
        // Indicates the proof is no longer valid due to time expiry.
        Expired,
        // Indicates the proof was explicitly invalidated.
        Revoked
    }

    // Represents one enforceable borrowing position.
    struct Loan {
        // Unique protocol identifier for the loan.
        uint256 loanId;
        // Wallet that owns and is responsible for the loan.
        address borrower;
        // Principal amount disbursed to the borrower.
        uint256 principalAmount;
        // Collateral amount locked against the loan.
        uint256 collateralAmount;
        // Annual interest rate fixed at origination in basis points.
        uint256 interestRateBps;
        // Minimum collateral ratio fixed at origination in basis points.
        uint256 collateralRatioBps;
        // Credit tier approved for this loan.
        CreditTier creditTier;
        // Timestamp when the loan became active.
        uint256 startTimestamp;
        // Timestamp when the scheduled repayment is due.
        uint256 dueTimestamp;
        // Timestamp after which the loan can be marked defaulted.
        uint256 gracePeriodEndsAt;
        // Timestamp when the loan was fully repaid.
        uint256 repaidTimestamp;
        // Timestamp when collateral seizure finalized the loan.
        uint256 liquidatedTimestamp;
        // Current lifecycle state of the loan.
        LoanStatus status;
        // ERC20 asset address used as collateral.
        address collateralAsset;
        // ERC20 asset address used as the borrowed debt asset.
        address debtAsset;
        // Unique identifier for the proof consumed at origination.
        bytes32 proofId;
        // Timestamp associated with proof issuance or consumption.
        uint256 proofTimestamp;
        // Reference to encrypted score metadata without revealing plaintext score.
        bytes32 scoreReference;
    }

    // Represents long-lived borrower protocol state across loans.
    struct BorrowerProfile {
        // Borrower wallet tracked by the protocol.
        address wallet;
        // Soulbound token id linked to this borrower.
        uint256 sbtTokenId;
        // Most recent tier known for the borrower.
        CreditTier currentTier;
        // Indicates whether the borrower currently has an active loan.
        bool hasActiveLoan;
        // Identifier of the borrower’s current active loan.
        uint256 activeLoanId;
        // Total number of loans originated for this borrower.
        uint256 totalLoansOriginated;
        // Total number of loans fully repaid by this borrower.
        uint256 totalLoansRepaid;
        // Total number of defaults recorded for this borrower.
        uint256 totalDefaults;
        // Current streak of consecutive successful repayments.
        uint256 currentRepaymentStreak;
        // Best repayment streak achieved by this borrower.
        uint256 bestRepaymentStreak;
        // Indicates whether the borrower is permanently barred from borrowing.
        bool permanentlyFlagged;
        // Timestamp of the last borrower score-related update.
        uint256 lastScoreUpdateAt;
        // Timestamp when the borrower last closed a loan.
        uint256 lastLoanClosedAt;
    }

    // Represents borrower reputation metadata stored in the SBT.
    struct SBTMetadata {
        // Unique soulbound token identifier.
        uint256 tokenId;
        // Wallet that owns the soulbound credit token.
        address owner;
        // Current tier reflected by the SBT.
        CreditTier currentTier;
        // Total number of loans repaid by the borrower.
        uint256 totalLoansRepaid;
        // Current repayment streak reflected in the SBT.
        uint256 repaymentStreak;
        // Indicates whether the borrower has a default flag.
        bool defaultFlag;
        // Timestamp when the SBT was first minted.
        uint256 issuedAt;
        // Timestamp when the SBT metadata was last updated.
        uint256 updatedAt;
        // Schema version for SBT metadata evolution.
        uint256 metadataVersion;
    }

    // Represents protocol lending rules for a specific credit tier.
    struct TierConfig {
        // Tier that this configuration governs.
        CreditTier tier;
        // Lower score bound for the tier.
        uint256 minScore;
        // Upper score bound for the tier.
        uint256 maxScore;
        // Minimum collateral ratio required for the tier in basis points.
        uint256 minCollateralRatioBps;
        // Annual interest rate applied to the tier in basis points.
        uint256 annualInterestRateBps;
        // Maximum principal that can be borrowed in this tier.
        uint256 maxLoanAmount;
        // Indicates whether this tier is currently enabled.
        bool active;
    }

    // Represents the normalized verifier output consumed by lending logic.
    struct ProofContext {
        // Unique identifier for replay protection.
        bytes32 proofId;
        // Borrower wallet that the proof is bound to.
        address borrower;
        // Tier approved by the verifier.
        CreditTier approvedTier;
        // Maximum amount this proof authorizes the borrower to request.
        uint256 maxBorrowAmount;
        // Timestamp after which the proof must be rejected.
        uint256 validUntil;
        // Timestamp when the proof was issued.
        uint256 issuedAt;
        // Source chain identifier the proof is bound to.
        uint256 sourceChainId;
        // Current status of the proof.
        ProofStatus status;
        // Reference to encrypted score metadata tied to the proof.
        bytes32 scoreReference;
    }

    // Represents aggregate liquidity and performance metrics for the pool.
    struct PoolState {
        // Total liquidity ever deposited into the protocol pool.
        uint256 totalLiquidity;
        // Liquidity currently available for new loans.
        uint256 availableLiquidity;
        // Total principal amount currently outstanding across active loans.
        uint256 totalPrincipalOutstanding;
        // Total collateral amount currently locked by the protocol.
        uint256 totalCollateralLocked;
        // Total interest collected from repayments.
        uint256 totalInterestCollected;
        // Total number of defaults recorded by the pool.
        uint256 totalDefaults;
        // Total number of liquidations executed by the pool.
        uint256 totalLiquidations;
        // Total collateral seized by the protocol.
        uint256 totalSeizedCollateral;
    }
}
