// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {RelayedCreditVerifier} from "../src/core/RelayedCreditVerifier.sol";
import {CredexErrors} from "../src/libraries/CredexErrors.sol";
import {CredexTypes} from "../src/types/CredexTypes.sol";

contract RelayedCreditVerifierTest is Test {
    RelayedCreditVerifier internal verifier;

    address internal constant OWNER   = address(0xA11CE);
    address internal constant RELAYER = address(0xBEEF);
    address internal constant BORROWER = address(0xCAFE);
    address internal constant OTHER   = address(0xDEAD);

    bytes32 internal constant PROOF_ID = keccak256("test-proof-1");

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() external {
        vm.prank(OWNER);
        verifier = new RelayedCreditVerifier(RELAYER);
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    function testConstructorSetsOwner() external {
        assertEq(verifier.owner(), OWNER);
    }

    function testConstructorAuthorizesInitialRelayer() external {
        assertTrue(verifier.authorizedRelayers(RELAYER));
    }

    function testConstructorZeroRelayerSkipsAuthorization() external {
        vm.prank(OWNER);
        RelayedCreditVerifier v2 = new RelayedCreditVerifier(address(0));
        assertFalse(v2.authorizedRelayers(address(0)));
    }

    // ── setAuthorizedRelayer ──────────────────────────────────────────────────

    function testOwnerCanGrantRelayer() external {
        vm.prank(OWNER);
        verifier.setAuthorizedRelayer(OTHER, true);
        assertTrue(verifier.authorizedRelayers(OTHER));
    }

    function testOwnerCanRevokeRelayer() external {
        vm.prank(OWNER);
        verifier.setAuthorizedRelayer(RELAYER, false);
        assertFalse(verifier.authorizedRelayers(RELAYER));
    }

    function testNonOwnerCannotSetRelayer() external {
        vm.prank(OTHER);
        vm.expectRevert();
        verifier.setAuthorizedRelayer(OTHER, true);
    }

    function testSetRelayerRejectsZeroAddress() external {
        vm.prank(OWNER);
        vm.expectRevert(CredexErrors.ZeroAddressNotAllowed.selector);
        verifier.setAuthorizedRelayer(address(0), true);
    }

    function testSetRelayerEmitsEvent() external {
        vm.prank(OWNER);
        vm.expectEmit(true, false, false, true);
        emit RelayedCreditVerifier.RelayerSet(OTHER, true);
        verifier.setAuthorizedRelayer(OTHER, true);
    }

    // ── relay: access control ─────────────────────────────────────────────────

    function testRelayAuthorizedRelayerSucceeds() external {
        vm.prank(RELAYER);
        verifier.relay(_makeCtx(PROOF_ID, BORROWER, block.timestamp + 1 hours));
    }

    function testRelayOwnerSucceedsWithoutBeingInMapping() external {
        // OWNER is not in authorizedRelayers but passes the onlyRelayer modifier
        assertFalse(verifier.authorizedRelayers(OWNER));
        vm.prank(OWNER);
        verifier.relay(_makeCtx(PROOF_ID, BORROWER, block.timestamp + 1 hours));
    }

    function testRelayUnauthorizedReverts() external {
        vm.prank(OTHER);
        vm.expectRevert(CredexErrors.UnauthorizedCaller.selector);
        verifier.relay(_makeCtx(PROOF_ID, BORROWER, block.timestamp + 1 hours));
    }

    // ── relay: input validation ───────────────────────────────────────────────

    function testRelayRejectsZeroProofId() external {
        vm.prank(RELAYER);
        vm.expectRevert(CredexErrors.InvalidProof.selector);
        verifier.relay(_makeCtx(bytes32(0), BORROWER, block.timestamp + 1 hours));
    }

    function testRelayRejectsZeroBorrower() external {
        vm.prank(RELAYER);
        vm.expectRevert(CredexErrors.ZeroAddressNotAllowed.selector);
        verifier.relay(_makeCtx(PROOF_ID, address(0), block.timestamp + 1 hours));
    }

    function testRelayRejectsNoneTier() external {
        CredexTypes.ProofContext memory ctx = _makeCtx(PROOF_ID, BORROWER, block.timestamp + 1 hours);
        ctx.approvedTier = CredexTypes.CreditTier.None;

        vm.prank(RELAYER);
        vm.expectRevert(CredexErrors.ProofTierMismatch.selector);
        verifier.relay(ctx);
    }

    function testRelayRejectsExpiredProof() external {
        vm.warp(1_000); // move past genesis so block.timestamp - 1 is non-zero
        vm.prank(RELAYER);
        vm.expectRevert(CredexErrors.ProofExpired.selector);
        verifier.relay(_makeCtx(PROOF_ID, BORROWER, block.timestamp - 1));
    }

    function testRelayAcceptsZeroValidUntil() external {
        CredexTypes.ProofContext memory ctx = _makeCtx(PROOF_ID, BORROWER, 0);

        vm.prank(RELAYER);
        verifier.relay(ctx); // should not revert
    }

    function testRelayEmitsEvent() external {
        CredexTypes.ProofContext memory ctx = _makeCtx(PROOF_ID, BORROWER, block.timestamp + 1 hours);

        vm.prank(RELAYER);
        vm.expectEmit(true, true, false, true);
        emit RelayedCreditVerifier.ProofRelayed(PROOF_ID, BORROWER, CredexTypes.CreditTier.Gold);
        verifier.relay(ctx);
    }

    // ── verifyProof ───────────────────────────────────────────────────────────

    function testVerifyProofReturnsStoredContext() external {
        _relay(PROOF_ID, BORROWER, block.timestamp + 1 hours);

        CredexTypes.ProofContext memory ctx = verifier.verifyProof(BORROWER, abi.encode(PROOF_ID));

        assertEq(ctx.proofId, PROOF_ID);
        assertEq(ctx.borrower, BORROWER);
        assertEq(uint256(ctx.approvedTier), uint256(CredexTypes.CreditTier.Gold));
        assertEq(ctx.sourceChainId, 0);
    }

    function testVerifyProofUnknownProofReverts() external {
        vm.expectRevert(CredexErrors.InvalidProof.selector);
        verifier.verifyProof(BORROWER, abi.encode(keccak256("unknown")));
    }

    function testVerifyProofBorrowerMismatchReverts() external {
        _relay(PROOF_ID, BORROWER, block.timestamp + 1 hours);

        vm.expectRevert(CredexErrors.ProofBorrowerMismatch.selector);
        verifier.verifyProof(OTHER, abi.encode(PROOF_ID));
    }

    function testVerifyProofExpiredReverts() external {
        // relay at t=100 with validUntil=200, verify at t=201
        vm.warp(100);
        _relay(PROOF_ID, BORROWER, 200);

        vm.warp(201);
        vm.expectRevert(CredexErrors.ProofExpired.selector);
        verifier.verifyProof(BORROWER, abi.encode(PROOF_ID));
    }

    function testVerifyProofConsumedReverts() external {
        _relay(PROOF_ID, BORROWER, block.timestamp + 1 hours);
        _setStatus(PROOF_ID, CredexTypes.ProofStatus.Consumed);

        vm.expectRevert(CredexErrors.ProofAlreadyConsumed.selector);
        verifier.verifyProof(BORROWER, abi.encode(PROOF_ID));
    }

    function testVerifyProofRevokedReverts() external {
        _relay(PROOF_ID, BORROWER, block.timestamp + 1 hours);
        _setStatus(PROOF_ID, CredexTypes.ProofStatus.Revoked);

        vm.expectRevert(CredexErrors.InvalidProof.selector);
        verifier.verifyProof(BORROWER, abi.encode(PROOF_ID));
    }

    // ── isProofConsumed / getProofStatus ──────────────────────────────────────

    function testIsProofConsumedUnused() external {
        _relay(PROOF_ID, BORROWER, block.timestamp + 1 hours);
        assertFalse(verifier.isProofConsumed(PROOF_ID));
    }

    function testIsProofConsumedConsumed() external {
        _relay(PROOF_ID, BORROWER, block.timestamp + 1 hours);
        _setStatus(PROOF_ID, CredexTypes.ProofStatus.Consumed);
        assertTrue(verifier.isProofConsumed(PROOF_ID));
    }

    function testGetProofStatusUnknown() external {
        assertEq(
            uint256(verifier.getProofStatus(keccak256("unknown"))),
            uint256(CredexTypes.ProofStatus.Unused)
        );
    }

    function testGetProofStatusStored() external {
        _relay(PROOF_ID, BORROWER, block.timestamp + 1 hours);
        assertEq(
            uint256(verifier.getProofStatus(PROOF_ID)),
            uint256(CredexTypes.ProofStatus.Unused)
        );
    }

    // ── Scenario: owner rotates relayer key ───────────────────────────────────

    function testRotateRelayer() external {
        address newRelayer = address(0xFEED);

        vm.startPrank(OWNER);
        verifier.setAuthorizedRelayer(RELAYER, false);
        verifier.setAuthorizedRelayer(newRelayer, true);
        vm.stopPrank();

        assertFalse(verifier.authorizedRelayers(RELAYER));
        assertTrue(verifier.authorizedRelayers(newRelayer));

        // old relayer can no longer relay
        vm.prank(RELAYER);
        vm.expectRevert(CredexErrors.UnauthorizedCaller.selector);
        verifier.relay(_makeCtx(PROOF_ID, BORROWER, block.timestamp + 1 hours));

        // new relayer can
        vm.prank(newRelayer);
        verifier.relay(_makeCtx(PROOF_ID, BORROWER, block.timestamp + 1 hours));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _makeCtx(bytes32 proofId, address borrower, uint256 validUntil)
        internal
        view
        returns (CredexTypes.ProofContext memory ctx)
    {
        ctx = CredexTypes.ProofContext({
            proofId: proofId,
            borrower: borrower,
            approvedTier: CredexTypes.CreditTier.Gold,
            maxBorrowAmount: 5_000e6,
            validUntil: validUntil,
            issuedAt: block.timestamp,
            sourceChainId: 0,
            status: CredexTypes.ProofStatus.Unused,
            scoreReference: keccak256("score")
        });
    }

    function _relay(bytes32 proofId, address borrower, uint256 validUntil) internal {
        vm.prank(RELAYER);
        verifier.relay(_makeCtx(proofId, borrower, validUntil));
    }

    /// @dev Relays a second proof (different id) then overwrites status via relay.
    ///      Since there's no direct status setter on RelayedCreditVerifier, we
    ///      re-relay with the mutated status field.
    function _setStatus(bytes32 proofId, CredexTypes.ProofStatus s) internal {
        CredexTypes.ProofContext memory ctx = _makeCtx(proofId, BORROWER, block.timestamp + 1 hours);
        ctx.status = s;
        vm.prank(RELAYER);
        verifier.relay(ctx);
    }
}
