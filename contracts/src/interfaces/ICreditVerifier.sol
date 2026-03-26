// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CredexTypes} from "../types/CredexTypes.sol";

interface ICreditVerifier {
    // Validates proof payload and returns a normalized eligibility context for lending.
    function verifyProof(address borrower, bytes calldata proofData)
        external
        view
        returns (CredexTypes.ProofContext memory proofContext);

    // Returns whether a proof identifier has already been consumed.
    function isProofConsumed(bytes32 proofId) external view returns (bool consumed);

    // Returns the current tracked status of a proof identifier.
    function getProofStatus(bytes32 proofId) external view returns (CredexTypes.ProofStatus status);
}
