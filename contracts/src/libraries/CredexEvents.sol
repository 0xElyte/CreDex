// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CredexTypes} from "../types/CredexTypes.sol";

library CredexEvents {
    // Emitted when a new loan is originated.
    event LoanApproved(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principalAmount,
        uint256 collateralAmount,
        CredexTypes.CreditTier creditTier,
        uint256 timestamp
    );

    // Emitted when an active loan is fully repaid.
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 repaymentAmount, uint256 timestamp);

    // Emitted when a loan transitions into default.
    event LoanDefaulted(uint256 indexed loanId, address indexed borrower, uint256 timestamp);

    // Emitted when a defaulted loan is liquidated.
    event LoanLiquidated(
        uint256 indexed loanId, address indexed borrower, uint256 seizedCollateralAmount, uint256 timestamp
    );

    // Emitted when collateral is locked for a loan.
    event CollateralDeposited(
        uint256 indexed loanId, address indexed borrower, address indexed collateralAsset, uint256 collateralAmount
    );

    // Emitted when collateral is returned to the borrower.
    event CollateralReleased(
        uint256 indexed loanId, address indexed borrower, address indexed collateralAsset, uint256 collateralAmount
    );

    // Emitted when collateral is seized after liquidation.
    event CollateralSeized(
        uint256 indexed loanId, address indexed borrower, address indexed collateralAsset, uint256 collateralAmount
    );

    // Emitted when borrower profile state changes.
    event BorrowerProfileUpdated(
        address indexed borrower,
        CredexTypes.CreditTier currentTier,
        bool hasActiveLoan,
        uint256 activeLoanId,
        uint256 timestamp
    );

    // Emitted when a borrower receives a protocol flag.
    event BorrowerFlagged(address indexed borrower, bool permanentlyFlagged, uint256 timestamp);

    // Emitted when a soulbound credit token is minted.
    event CreditSBTMinted(uint256 indexed tokenId, address indexed borrower, uint256 timestamp);

    // Emitted when soulbound credit metadata is updated.
    event CreditSBTUpdated(
        uint256 indexed tokenId,
        address indexed borrower,
        CredexTypes.CreditTier currentTier,
        uint256 repaymentStreak,
        uint256 totalLoansRepaid,
        bool defaultFlag,
        uint256 timestamp
    );

    // Emitted when tier rules are updated.
    event TierConfigUpdated(
        CredexTypes.CreditTier indexed tier,
        uint256 minCollateralRatioBps,
        uint256 annualInterestRateBps,
        uint256 maxLoanAmount,
        bool active
    );

    // Emitted when the verifier contract address is updated.
    event VerifierUpdated(address indexed verifier);

    // Emitted when a lender deposits debt asset into the pool.
    event LenderDeposited(address indexed lender, uint256 amount);

    // Emitted when a lender withdraws debt asset from the pool.
    event LenderWithdrawn(address indexed lender, uint256 amount);
}
