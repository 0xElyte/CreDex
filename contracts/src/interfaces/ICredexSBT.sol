// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CredexTypes} from "../types/CredexTypes.sol";

interface ICredexSBT {
    // Mints a borrower soulbound token during first successful origination.
    function mintForBorrower(address borrower, CredexTypes.CreditTier initialTier) external returns (uint256 tokenId);

    // Updates borrower reputation metadata after repayment, default, or tier changes.
    function updateBorrowerState(
        address borrower,
        CredexTypes.CreditTier currentTier,
        uint256 totalLoansRepaid,
        uint256 repaymentStreak,
        bool defaultFlag
    ) external;

    // Returns the soulbound token id owned by a borrower.
    function tokenOfOwner(address borrower) external view returns (uint256 tokenId);

    // Returns whether a borrower already owns a soulbound token.
    function hasToken(address borrower) external view returns (bool exists);

    // Returns the current metadata stored for a soulbound token.
    function getMetadata(uint256 tokenId) external view returns (CredexTypes.SBTMetadata memory metadata);
}
