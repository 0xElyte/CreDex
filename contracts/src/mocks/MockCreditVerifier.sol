// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICreditVerifier} from "../interfaces/ICreditVerifier.sol";
import {CredexErrors} from "../libraries/CredexErrors.sol";
import {CredexTypes} from "../types/CredexTypes.sol";

contract MockCreditVerifier is ICreditVerifier {
    mapping(bytes32 proofId => CredexTypes.ProofContext proofContext) private _proofContexts;

    function setProofContext(CredexTypes.ProofContext calldata proofContext) external {
        _proofContexts[proofContext.proofId] = proofContext;
    }

    function setProofStatus(bytes32 proofId, CredexTypes.ProofStatus status) external {
        CredexTypes.ProofContext storage proofContext = _proofContexts[proofId];
        if (proofContext.proofId == bytes32(0)) revert CredexErrors.InvalidProof();
        proofContext.status = status;
    }

    function verifyProof(address, bytes calldata proofData)
        external
        view
        returns (CredexTypes.ProofContext memory proofContext)
    {
        bytes32 proofId = abi.decode(proofData, (bytes32));
        proofContext = _proofContexts[proofId];
        if (proofContext.proofId == bytes32(0)) revert CredexErrors.InvalidProof();
    }

    function isProofConsumed(bytes32 proofId) external view returns (bool consumed) {
        consumed = _proofContexts[proofId].status == CredexTypes.ProofStatus.Consumed;
    }

    function getProofStatus(bytes32 proofId) external view returns (CredexTypes.ProofStatus status) {
        status = _proofContexts[proofId].status;
    }
}
