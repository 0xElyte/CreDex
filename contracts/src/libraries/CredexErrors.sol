// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library CredexErrors {
    // Indicates the borrower already has an active loan.
    error ActiveLoanExists();

    // Indicates no active loan exists for the requested operation.
    error NoActiveLoan();

    // Indicates the referenced loan does not exist.
    error LoanNotFound();

    // Indicates the loan is not in the required lifecycle state.
    error InvalidLoanStatus();

    // Indicates the referenced loan has already been settled.
    error LoanAlreadyClosed();

    // Indicates the referenced loan is not yet in default status.
    error LoanNotDefaulted();

    // Indicates the referenced loan is not yet eligible for default.
    error LoanNotPastGracePeriod();

    // Indicates the requested borrow amount is invalid.
    error InvalidBorrowAmount();

    // Indicates the supplied collateral amount is invalid.
    error InvalidCollateralAmount();

    // Indicates the supplied collateral does not meet tier requirements.
    error InsufficientCollateral();

    // Indicates the pool lacks enough available liquidity.
    error PoolInsufficientLiquidity();

    // Indicates the requested asset is not supported by the protocol.
    error UnsupportedAsset();

    // Indicates the configured tier parameters are invalid.
    error InvalidTierConfig();

    // Indicates the repayment amount is below the amount due.
    error RepaymentAmountTooLow();

    // Indicates the loan is past due for the attempted repayment path.
    error LoanPastDue();

    // Indicates the collateral cannot be released or has already been handled.
    error CollateralUnavailable();

    // Indicates liquidation is not yet permitted under protocol rules.
    error LiquidationNotAllowed();

    // Indicates the submitted proof is invalid.
    error InvalidProof();

    // Indicates the submitted proof has expired.
    error ProofExpired();

    // Indicates the proof has already been consumed.
    error ProofAlreadyConsumed();

    // Indicates the proof is not bound to the expected borrower.
    error ProofBorrowerMismatch();

    // Indicates the requested amount exceeds proof authorization.
    error ProofAmountExceeded();

    // Indicates the requested tier does not match proof authorization.
    error ProofTierMismatch();

    // Indicates the proof source or circuit version is unsupported.
    error UnsupportedProofSource();

    // Indicates the caller is not authorized to execute the action.
    error UnauthorizedCaller();

    // Indicates a required address argument is the zero address.
    error ZeroAddressNotAllowed();

    // Indicates the borrower already owns a soulbound token.
    error BorrowerAlreadyHasSBT();

    // Indicates transfer of the soulbound token is forbidden.
    error SoulboundTransferForbidden();

    // Indicates approval of the soulbound token is forbidden.
    error SoulboundApprovalForbidden();

    // Indicates the referenced SBT token does not exist.
    error TokenDoesNotExist();

    // Indicates the caller is not allowed to mint or mutate SBT metadata.
    error UnauthorizedSBTUpdater();
}
