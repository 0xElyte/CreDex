// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {CredexSBT} from "../src/core/CredexSBT.sol";
import {CredexErrors} from "../src/libraries/CredexErrors.sol";
import {CredexTypes} from "../src/types/CredexTypes.sol";

contract CredexSBTTest is Test {
    CredexSBT internal sbt;

    address internal constant OWNER = address(0xA11CE);
    address internal constant UPDATER = address(0xB0B);
    address internal constant BORROWER = address(0xCAFE);
    address internal constant RECEIVER = address(0xD00D);

    function setUp() external {
        vm.prank(OWNER);
        sbt = new CredexSBT("CreDex Credit", "cCREDIT");

        vm.prank(OWNER);
        sbt.setAuthorizedUpdater(UPDATER, true);
    }

    function testMintForBorrowerStoresMetadata() external {
        vm.prank(UPDATER);
        uint256 tokenId = sbt.mintForBorrower(BORROWER, CredexTypes.CreditTier.Gold);

        assertEq(tokenId, 1);
        assertEq(sbt.ownerOf(tokenId), BORROWER);
        assertEq(sbt.tokenOfOwner(BORROWER), tokenId);

        CredexTypes.SBTMetadata memory metadata = sbt.getMetadata(tokenId);
        assertEq(uint256(metadata.currentTier), uint256(CredexTypes.CreditTier.Gold));
        assertEq(metadata.totalLoansRepaid, 0);
        assertEq(metadata.repaymentStreak, 0);
        assertEq(metadata.defaultFlag, false);
    }

    function testUpdateBorrowerStateMutatesMetadata() external {
        vm.startPrank(UPDATER);
        uint256 tokenId = sbt.mintForBorrower(BORROWER, CredexTypes.CreditTier.Silver);
        sbt.updateBorrowerState(BORROWER, CredexTypes.CreditTier.Gold, 2, 2, false);
        vm.stopPrank();

        CredexTypes.SBTMetadata memory metadata = sbt.getMetadata(tokenId);
        assertEq(uint256(metadata.currentTier), uint256(CredexTypes.CreditTier.Gold));
        assertEq(metadata.totalLoansRepaid, 2);
        assertEq(metadata.repaymentStreak, 2);
        assertEq(metadata.defaultFlag, false);
    }

    function testNonTransferableReverts() external {
        vm.prank(UPDATER);
        uint256 tokenId = sbt.mintForBorrower(BORROWER, CredexTypes.CreditTier.Bronze);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.SoulboundTransferForbidden.selector);
        sbt.transferFrom(BORROWER, RECEIVER, tokenId);
    }

    function testUnauthorizedUpdaterReverts() external {
        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.UnauthorizedSBTUpdater.selector);
        sbt.mintForBorrower(BORROWER, CredexTypes.CreditTier.Bronze);
    }

    function testOwnerCanActAsUpdater() external {
        vm.prank(OWNER);
        uint256 tokenId = sbt.mintForBorrower(BORROWER, CredexTypes.CreditTier.Platinum);

        assertEq(tokenId, 1);
        assertEq(sbt.ownerOf(tokenId), BORROWER);
    }

    function testSetAuthorizedUpdaterZeroAddressReverts() external {
        vm.prank(OWNER);
        vm.expectRevert(CredexErrors.ZeroAddressNotAllowed.selector);
        sbt.setAuthorizedUpdater(address(0), true);
    }

    function testMintForBorrowerZeroAddressReverts() external {
        vm.prank(UPDATER);
        vm.expectRevert(CredexErrors.ZeroAddressNotAllowed.selector);
        sbt.mintForBorrower(address(0), CredexTypes.CreditTier.Bronze);
    }

    function testMintForBorrowerDuplicateReverts() external {
        vm.startPrank(UPDATER);
        sbt.mintForBorrower(BORROWER, CredexTypes.CreditTier.Bronze);
        vm.expectRevert(CredexErrors.BorrowerAlreadyHasSBT.selector);
        sbt.mintForBorrower(BORROWER, CredexTypes.CreditTier.Gold);
        vm.stopPrank();
    }

    function testUpdateBorrowerStateMissingTokenReverts() external {
        vm.prank(UPDATER);
        vm.expectRevert(CredexErrors.TokenDoesNotExist.selector);
        sbt.updateBorrowerState(BORROWER, CredexTypes.CreditTier.Gold, 1, 1, false);
    }

    function testGetMetadataMissingTokenReverts() external {
        vm.expectRevert(CredexErrors.TokenDoesNotExist.selector);
        sbt.getMetadata(999);
    }

    function testApproveReverts() external {
        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.SoulboundApprovalForbidden.selector);
        sbt.approve(RECEIVER, 1);
    }

    function testSetApprovalForAllReverts() external {
        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.SoulboundApprovalForbidden.selector);
        sbt.setApprovalForAll(RECEIVER, true);
    }

    function testSafeTransferFromReverts() external {
        vm.prank(UPDATER);
        uint256 tokenId = sbt.mintForBorrower(BORROWER, CredexTypes.CreditTier.Bronze);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.SoulboundTransferForbidden.selector);
        sbt.safeTransferFrom(BORROWER, RECEIVER, tokenId, "");
    }

    function testHasTokenFalseByDefault() external view {
        assertFalse(sbt.hasToken(BORROWER));
        assertEq(sbt.tokenOfOwner(BORROWER), 0);
    }

    function testDisabledUpdaterCanNoLongerMint() external {
        vm.prank(OWNER);
        sbt.setAuthorizedUpdater(UPDATER, false);

        vm.prank(UPDATER);
        vm.expectRevert(CredexErrors.UnauthorizedSBTUpdater.selector);
        sbt.mintForBorrower(BORROWER, CredexTypes.CreditTier.Bronze);
    }
}
