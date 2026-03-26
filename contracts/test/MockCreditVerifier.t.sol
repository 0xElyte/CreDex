// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {CredexErrors} from "../src/libraries/CredexErrors.sol";
import {MockCreditVerifier} from "../src/mocks/MockCreditVerifier.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {CredexTypes} from "../src/types/CredexTypes.sol";

contract MockCreditVerifierTest is Test {
    MockCreditVerifier internal verifier;
    MockERC20 internal token;

    address internal constant BORROWER = address(0xCAFE);

    function setUp() external {
        verifier = new MockCreditVerifier();
        token = new MockERC20("Mock Token", "MTK", 6);
    }

    function testVerifyProofReturnsStoredContext() external {
        bytes32 proofId = _storeProof(CredexTypes.ProofStatus.Unused);

        CredexTypes.ProofContext memory proofContext = verifier.verifyProof(BORROWER, abi.encode(proofId));

        assertEq(proofContext.proofId, proofId);
        assertEq(proofContext.borrower, BORROWER);
        assertEq(uint256(proofContext.approvedTier), uint256(CredexTypes.CreditTier.Gold));
    }

    function testVerifyProofRejectsUnknownProof() external {
        vm.expectRevert(CredexErrors.InvalidProof.selector);
        verifier.verifyProof(BORROWER, abi.encode(bytes32(uint256(7))));
    }

    function testSetProofStatusAndStatusReadersWork() external {
        bytes32 proofId = _storeProof(CredexTypes.ProofStatus.Unused);

        verifier.setProofStatus(proofId, CredexTypes.ProofStatus.Consumed);

        assertTrue(verifier.isProofConsumed(proofId));
        assertEq(uint256(verifier.getProofStatus(proofId)), uint256(CredexTypes.ProofStatus.Consumed));
    }

    function testSetProofStatusRejectsUnknownProof() external {
        vm.expectRevert(CredexErrors.InvalidProof.selector);
        verifier.setProofStatus(bytes32(uint256(9)), CredexTypes.ProofStatus.Revoked);
    }

    function testMockErc20MintAndDecimalsWork() external {
        token.mint(BORROWER, 123e6);

        assertEq(token.balanceOf(BORROWER), 123e6);
        assertEq(token.decimals(), 6);
    }

    function _storeProof(CredexTypes.ProofStatus status) internal returns (bytes32 proofId) {
        proofId = keccak256(abi.encode(BORROWER, status, block.timestamp));
        verifier.setProofContext(
            CredexTypes.ProofContext({
                proofId: proofId,
                borrower: BORROWER,
                approvedTier: CredexTypes.CreditTier.Gold,
                maxBorrowAmount: 1_000e6,
                validUntil: block.timestamp + 1 days,
                issuedAt: block.timestamp,
                sourceChainId: block.chainid,
                status: status,
                scoreReference: keccak256(abi.encodePacked(proofId))
            })
        );
    }
}