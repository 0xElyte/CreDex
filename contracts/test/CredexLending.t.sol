// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {CredexLending} from "../src/core/CredexLending.sol";
import {CredexSBT} from "../src/core/CredexSBT.sol";
import {ICredexSBT} from "../src/interfaces/ICredexSBT.sol";
import {CredexErrors} from "../src/libraries/CredexErrors.sol";
import {MockCreditVerifier} from "../src/mocks/MockCreditVerifier.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {CredexTypes} from "../src/types/CredexTypes.sol";

contract CredexLendingTest is Test {
    uint256 internal constant ONE_USDC = 1e6;
    uint256 internal constant LOAN_DURATION = 30 days;
    uint256 internal constant GRACE_PERIOD = 7 days;
    uint256 internal constant LIQUIDATION_DELAY = 30 days;

    address internal constant OWNER = address(0xA11CE);
    address internal constant BORROWER = address(0xB0B0);
    address internal constant OTHER = address(0x0A73);

    MockERC20 internal usdc;
    MockERC20 internal collateral;
    MockCreditVerifier internal verifier;
    CredexSBT internal sbt;
    CredexLending internal lending;

    function setUp() external {
        vm.startPrank(OWNER);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        collateral = new MockERC20("Mock Collateral", "mCOLL", 6);
        verifier = new MockCreditVerifier();
        sbt = new CredexSBT("CreDex Credit", "cCREDIT");
        lending = new CredexLending(
            address(usdc),
            address(collateral),
            address(verifier),
            address(sbt),
            LOAN_DURATION,
            GRACE_PERIOD,
            LIQUIDATION_DELAY
        );

        sbt.setAuthorizedUpdater(address(lending), true);

        lending.setTierConfig(CredexTypes.CreditTier.Bronze, 400, 549, 6500, 2200, 500 * ONE_USDC, true);
        lending.setTierConfig(CredexTypes.CreditTier.Silver, 550, 699, 5000, 1400, 2_000 * ONE_USDC, true);
        lending.setTierConfig(CredexTypes.CreditTier.Gold, 700, 849, 3500, 800, 5_000 * ONE_USDC, true);
        lending.setTierConfig(CredexTypes.CreditTier.Platinum, 850, 1000, 2000, 400, 10_000 * ONE_USDC, true);

        usdc.mint(OWNER, 100_000 * ONE_USDC);
        usdc.approve(address(lending), type(uint256).max);
        lending.supplyLiquidity(50_000 * ONE_USDC);
        vm.stopPrank();

        collateral.mint(BORROWER, 20_000 * ONE_USDC);
        collateral.mint(OTHER, 20_000 * ONE_USDC);
        usdc.mint(BORROWER, 5_000 * ONE_USDC);

        vm.prank(BORROWER);
        collateral.approve(address(lending), type(uint256).max);
        vm.prank(BORROWER);
        usdc.approve(address(lending), type(uint256).max);

        vm.prank(OTHER);
        collateral.approve(address(lending), type(uint256).max);
    }

    function testRequestLoanCreatesLoanAndMintsSBT() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        uint256 loanId = lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));

        CredexTypes.Loan memory loan = lending.getLoan(loanId);
        assertEq(loan.loanId, loanId);
        assertEq(loan.borrower, BORROWER);
        assertEq(loan.principalAmount, 500 * ONE_USDC);
        assertEq(uint256(loan.status), uint256(CredexTypes.LoanStatus.Active));

        CredexTypes.BorrowerProfile memory profile = lending.getBorrowerProfile(BORROWER);
        assertTrue(profile.hasActiveLoan);
        assertEq(profile.activeLoanId, loanId);
        assertTrue(ICredexSBT(address(sbt)).hasToken(BORROWER));
    }

    function testRequestLoanRevertsOnInsufficientCollateral() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.InsufficientCollateral.selector);
        lending.requestLoan(500 * ONE_USDC, 100 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRevertsOnExpiredProof() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp - 1);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.ProofExpired.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRevertsWhenBorrowerAlreadyHasActiveLoan() external {
        bytes32 firstProofId =
            _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);
        bytes32 secondProofId =
            _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days + 1);

        vm.startPrank(BORROWER);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(firstProofId));
        vm.expectRevert(CredexErrors.ActiveLoanExists.selector);
        lending.requestLoan(400 * ONE_USDC, 140 * ONE_USDC, abi.encode(secondProofId));
        vm.stopPrank();
    }

    function testRepayLoanReleasesCollateralAndUpdatesProfile() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        uint256 loanId = lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));

        vm.warp(block.timestamp + 10 days);
        uint256 amountDue = lending.getAmountDue(loanId);

        uint256 collateralBefore = collateral.balanceOf(BORROWER);
        vm.prank(BORROWER);
        lending.repayLoan(loanId);

        CredexTypes.Loan memory loan = lending.getLoan(loanId);
        assertEq(uint256(loan.status), uint256(CredexTypes.LoanStatus.Repaid));

        CredexTypes.BorrowerProfile memory profile = lending.getBorrowerProfile(BORROWER);
        assertFalse(profile.hasActiveLoan);
        assertEq(profile.totalLoansRepaid, 1);
        assertEq(profile.currentRepaymentStreak, 1);

        assertEq(collateral.balanceOf(BORROWER), collateralBefore + 175 * ONE_USDC);
        assertGt(amountDue, 500 * ONE_USDC);
    }

    function testCannotReuseConsumedProofAfterRepayment() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        uint256 loanId = lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));

        vm.prank(BORROWER);
        lending.repayLoan(loanId);

        bytes32 nextProofId =
            _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 2 days);

        vm.startPrank(BORROWER);
        vm.expectRevert(CredexErrors.ProofAlreadyConsumed.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));

        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(nextProofId));
        vm.stopPrank();
    }

    function testCannotRepayAfterGracePeriod() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        uint256 loanId = lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));

        vm.warp(block.timestamp + LOAN_DURATION + GRACE_PERIOD + 1);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.LoanPastDue.selector);
        lending.repayLoan(loanId);
    }

    function testMarkDefaultFlagsBorrowerAndSBT() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        uint256 loanId = lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));

        vm.warp(block.timestamp + LOAN_DURATION + GRACE_PERIOD + 1);
        lending.markDefault(loanId);

        CredexTypes.Loan memory loan = lending.getLoan(loanId);
        assertEq(uint256(loan.status), uint256(CredexTypes.LoanStatus.Defaulted));

        CredexTypes.BorrowerProfile memory profile = lending.getBorrowerProfile(BORROWER);
        assertTrue(profile.permanentlyFlagged);
        assertEq(profile.totalDefaults, 1);

        uint256 tokenId = sbt.tokenOfOwner(BORROWER);
        CredexTypes.SBTMetadata memory metadata = sbt.getMetadata(tokenId);
        assertTrue(metadata.defaultFlag);
    }

    function testLiquidateDefaultedLoanSeizesCollateral() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        uint256 loanId = lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));

        vm.warp(block.timestamp + LOAN_DURATION + GRACE_PERIOD + 1);
        lending.markDefault(loanId);

        uint256 ownerCollateralBefore = collateral.balanceOf(OWNER);

        vm.warp(block.timestamp + (LIQUIDATION_DELAY - GRACE_PERIOD));
        lending.liquidateLoan(loanId);

        CredexTypes.Loan memory loan = lending.getLoan(loanId);
        assertEq(uint256(loan.status), uint256(CredexTypes.LoanStatus.Liquidated));
        assertEq(collateral.balanceOf(OWNER), ownerCollateralBefore + 175 * ONE_USDC);

        CredexTypes.BorrowerProfile memory profile = lending.getBorrowerProfile(BORROWER);
        assertFalse(profile.hasActiveLoan);
    }

    function testConstructorRevertsOnZeroAddresses() external {
        vm.expectRevert(CredexErrors.ZeroAddressNotAllowed.selector);
        new CredexLending(address(0), address(collateral), address(verifier), address(sbt), LOAN_DURATION, GRACE_PERIOD, LIQUIDATION_DELAY);
    }

    function testConstructorRevertsOnInvalidTiming() external {
        vm.expectRevert(CredexErrors.InvalidTierConfig.selector);
        new CredexLending(address(usdc), address(collateral), address(verifier), address(sbt), LOAN_DURATION, GRACE_PERIOD, GRACE_PERIOD - 1);
    }

    function testSetTierConfigRejectsNoneTier() external {
        vm.prank(OWNER);
        vm.expectRevert(CredexErrors.InvalidTierConfig.selector);
        lending.setTierConfig(CredexTypes.CreditTier.None, 0, 1, 1, 1, 1, true);
    }

    function testSetTierConfigRejectsInvalidBounds() external {
        vm.prank(OWNER);
        vm.expectRevert(CredexErrors.InvalidTierConfig.selector);
        lending.setTierConfig(CredexTypes.CreditTier.Gold, 900, 100, 3500, 800, 5_000 * ONE_USDC, true);
    }

    function testSetVerifierRejectsZeroAddress() external {
        vm.prank(OWNER);
        vm.expectRevert(CredexErrors.ZeroAddressNotAllowed.selector);
        lending.setVerifier(address(0));
    }

    function testSetSBTRejectsZeroAddress() external {
        vm.prank(OWNER);
        vm.expectRevert(CredexErrors.ZeroAddressNotAllowed.selector);
        lending.setSBT(address(0));
    }

    function testSupplyLiquidityRejectsZeroAmount() external {
        vm.prank(OWNER);
        vm.expectRevert(CredexErrors.InvalidBorrowAmount.selector);
        lending.supplyLiquidity(0);
    }

    function testWithdrawLiquidityRejectsZeroAddress() external {
        vm.prank(OWNER);
        vm.expectRevert(CredexErrors.ZeroAddressNotAllowed.selector);
        lending.withdrawLiquidity(1, address(0));
    }

    function testWithdrawLiquidityRejectsZeroAmount() external {
        vm.prank(OWNER);
        vm.expectRevert(CredexErrors.InvalidBorrowAmount.selector);
        lending.withdrawLiquidity(0, OWNER);
    }

    function testWithdrawLiquidityRejectsInsufficientAvailable() external {
        vm.prank(OWNER);
        vm.expectRevert(CredexErrors.PoolInsufficientLiquidity.selector);
        lending.withdrawLiquidity(50_001 * ONE_USDC, OWNER);
    }

    function testWithdrawLiquidityUpdatesPoolState() external {
        vm.prank(OWNER);
        lending.withdrawLiquidity(10_000 * ONE_USDC, OWNER);

        CredexTypes.PoolState memory pool = lending.getPoolState();
        assertEq(pool.totalLiquidity, 40_000 * ONE_USDC);
        assertEq(pool.availableLiquidity, 40_000 * ONE_USDC);
    }

    function testRequestLoanRejectsZeroPrincipal() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.InvalidBorrowAmount.selector);
        lending.requestLoan(0, 175 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsZeroCollateral() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.InvalidCollateralAmount.selector);
        lending.requestLoan(500 * ONE_USDC, 0, abi.encode(proofId));
    }

    function testRequestLoanRejectsInvalidProof() external {
        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.InvalidProof.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(bytes32(uint256(123))));
    }

    function testRequestLoanRejectsProofBorrowerMismatch() external {
        bytes32 proofId = _setProof(OTHER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.ProofBorrowerMismatch.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsProofTierNone() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.None, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.ProofTierMismatch.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsUnsupportedProofSource() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);
        verifier.setProofContext(
            CredexTypes.ProofContext({
                proofId: proofId,
                borrower: BORROWER,
                approvedTier: CredexTypes.CreditTier.Gold,
                maxBorrowAmount: 1_000 * ONE_USDC,
                validUntil: block.timestamp + 1 days,
                issuedAt: block.timestamp,
                sourceChainId: block.chainid + 1,
                status: CredexTypes.ProofStatus.Unused,
                scoreReference: keccak256(abi.encodePacked(proofId))
            })
        );

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.UnsupportedProofSource.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsConsumedProofStatus() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);
        verifier.setProofStatus(proofId, CredexTypes.ProofStatus.Consumed);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.ProofAlreadyConsumed.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsExpiredProofStatus() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);
        verifier.setProofStatus(proofId, CredexTypes.ProofStatus.Expired);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.ProofExpired.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsRevokedProofStatus() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);
        verifier.setProofStatus(proofId, CredexTypes.ProofStatus.Revoked);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.InvalidProof.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsAmountAboveProofLimit() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 400 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.ProofAmountExceeded.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsInactiveTier() external {
        vm.prank(OWNER);
        lending.setTierConfig(CredexTypes.CreditTier.Gold, 700, 849, 3500, 800, 5_000 * ONE_USDC, false);

        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.InvalidTierConfig.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsAmountAboveTierMax() external {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Bronze, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.InvalidBorrowAmount.selector);
        lending.requestLoan(600 * ONE_USDC, 390 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsInsufficientPoolLiquidity() external {
        vm.prank(OWNER);
        lending.withdrawLiquidity(45_100 * ONE_USDC, OWNER);

        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Platinum, 10_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.PoolInsufficientLiquidity.selector);
        lending.requestLoan(5_000 * ONE_USDC, 1_000 * ONE_USDC, abi.encode(proofId));
    }

    function testRequestLoanRejectsPermanentlyFlaggedBorrower() external {
        bytes32 firstProofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        uint256 loanId = lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(firstProofId));

        vm.warp(block.timestamp + LOAN_DURATION + GRACE_PERIOD + 1);
        lending.markDefault(loanId);
        vm.warp(block.timestamp + (LIQUIDATION_DELAY - GRACE_PERIOD));
        lending.liquidateLoan(loanId);

        bytes32 nextProofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);
        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.UnauthorizedCaller.selector);
        lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(nextProofId));
    }

    function testRepayLoanRejectsMissingLoan() external {
        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.LoanNotFound.selector);
        lending.repayLoan(999);
    }

    function testRepayLoanRejectsUnauthorizedCaller() external {
        uint256 loanId = _originateStandardGoldLoan();

        vm.prank(OTHER);
        vm.expectRevert(CredexErrors.UnauthorizedCaller.selector);
        lending.repayLoan(loanId);
    }

    function testRepayLoanRejectsInvalidStatusAfterRepayment() external {
        uint256 loanId = _originateStandardGoldLoan();

        vm.prank(BORROWER);
        lending.repayLoan(loanId);

        vm.prank(BORROWER);
        vm.expectRevert(CredexErrors.InvalidLoanStatus.selector);
        lending.repayLoan(loanId);
    }

    function testMarkDefaultRejectsMissingLoan() external {
        vm.expectRevert(CredexErrors.LoanNotFound.selector);
        lending.markDefault(999);
    }

    function testMarkDefaultRejectsBeforeGracePeriodEnds() external {
        uint256 loanId = _originateStandardGoldLoan();

        vm.warp(block.timestamp + LOAN_DURATION + GRACE_PERIOD - 1);
        vm.expectRevert(CredexErrors.LoanNotPastGracePeriod.selector);
        lending.markDefault(loanId);
    }

    function testMarkDefaultRejectsInvalidStatus() external {
        uint256 loanId = _originateStandardGoldLoan();

        vm.prank(BORROWER);
        lending.repayLoan(loanId);

        vm.expectRevert(CredexErrors.InvalidLoanStatus.selector);
        lending.markDefault(loanId);
    }

    function testLiquidateLoanRejectsMissingLoan() external {
        vm.expectRevert(CredexErrors.LoanNotFound.selector);
        lending.liquidateLoan(999);
    }

    function testLiquidateLoanRejectsNonDefaultedLoan() external {
        uint256 loanId = _originateStandardGoldLoan();

        vm.expectRevert(CredexErrors.LoanNotDefaulted.selector);
        lending.liquidateLoan(loanId);
    }

    function testLiquidateLoanRejectsBeforeDelay() external {
        uint256 loanId = _originateStandardGoldLoan();

        vm.warp(block.timestamp + LOAN_DURATION + GRACE_PERIOD + 1);
        lending.markDefault(loanId);

        vm.expectRevert(CredexErrors.LiquidationNotAllowed.selector);
        lending.liquidateLoan(loanId);
    }

    function testGetAmountDueRejectsMissingLoan() external {
        vm.expectRevert(CredexErrors.LoanNotFound.selector);
        lending.getAmountDue(999);
    }

    function testGetAmountDueRejectsInactiveStatus() external {
        uint256 loanId = _originateStandardGoldLoan();

        vm.prank(BORROWER);
        lending.repayLoan(loanId);

        vm.expectRevert(CredexErrors.InvalidLoanStatus.selector);
        lending.getAmountDue(loanId);
    }

    function testGetAmountDueCapsAccrualAtDueTimestamp() external {
        uint256 loanId = _originateStandardGoldLoan();

        vm.warp(block.timestamp + LOAN_DURATION);
        uint256 dueAtMaturity = lending.getAmountDue(loanId);

        vm.warp(block.timestamp + 5 days);
        uint256 dueAfterMaturity = lending.getAmountDue(loanId);

        assertEq(dueAtMaturity, dueAfterMaturity);
    }

    function testGetLoanRejectsMissingLoan() external {
        vm.expectRevert(CredexErrors.LoanNotFound.selector);
        lending.getLoan(999);
    }

    function testGetTierConfigAndPreviewRequiredCollateral() external view {
        CredexTypes.TierConfig memory config = lending.getTierConfig(CredexTypes.CreditTier.Gold);
        assertEq(config.maxLoanAmount, 5_000 * ONE_USDC);

        uint256 requiredCollateral = lending.previewRequiredCollateral(CredexTypes.CreditTier.Gold, 500 * ONE_USDC);
        assertEq(requiredCollateral, 175 * ONE_USDC);
    }

    function testPreviewRequiredCollateralRejectsInactiveTier() external {
        vm.prank(OWNER);
        lending.setTierConfig(CredexTypes.CreditTier.Gold, 700, 849, 3500, 800, 5_000 * ONE_USDC, false);

        vm.expectRevert(CredexErrors.InvalidTierConfig.selector);
        lending.previewRequiredCollateral(CredexTypes.CreditTier.Gold, 500 * ONE_USDC);
    }

    function testSetVerifierAndSetSBTWork() external {
        MockCreditVerifier newVerifier = new MockCreditVerifier();
        CredexSBT newSbt = new CredexSBT("New CreDex Credit", "ncCREDIT");

        vm.startPrank(OWNER);
        lending.setVerifier(address(newVerifier));
        lending.setSBT(address(newSbt));
        vm.stopPrank();

        assertEq(address(lending.verifier()), address(newVerifier));
        assertEq(address(lending.sbt()), address(newSbt));
    }

    function testGetPoolStateTracksOrigination() external {
        uint256 loanId = _originateStandardGoldLoan();
        loanId;

        CredexTypes.PoolState memory pool = lending.getPoolState();
        assertEq(pool.availableLiquidity, 49_500 * ONE_USDC);
        assertEq(pool.totalPrincipalOutstanding, 500 * ONE_USDC);
        assertEq(pool.totalCollateralLocked, 175 * ONE_USDC);
    }

    function _originateStandardGoldLoan() internal returns (uint256 loanId) {
        bytes32 proofId = _setProof(BORROWER, CredexTypes.CreditTier.Gold, 1_000 * ONE_USDC, block.timestamp + 1 days);

        vm.prank(BORROWER);
        loanId = lending.requestLoan(500 * ONE_USDC, 175 * ONE_USDC, abi.encode(proofId));
    }

    function _setProof(
        address borrower,
        CredexTypes.CreditTier approvedTier,
        uint256 maxBorrowAmount,
        uint256 validUntil
    ) internal returns (bytes32 proofId) {
        proofId = keccak256(abi.encode(borrower, approvedTier, maxBorrowAmount, validUntil, block.timestamp));
        verifier.setProofContext(
            CredexTypes.ProofContext({
                proofId: proofId,
                borrower: borrower,
                approvedTier: approvedTier,
                maxBorrowAmount: maxBorrowAmount,
                validUntil: validUntil,
                issuedAt: block.timestamp,
                sourceChainId: block.chainid,
                status: CredexTypes.ProofStatus.Unused,
                scoreReference: keccak256(abi.encodePacked(proofId))
            })
        );
    }
}
