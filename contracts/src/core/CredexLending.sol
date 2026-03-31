// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {ICreditVerifier} from "../interfaces/ICreditVerifier.sol";
import {ICredexSBT} from "../interfaces/ICredexSBT.sol";
import {CredexErrors} from "../libraries/CredexErrors.sol";
import {CredexEvents} from "../libraries/CredexEvents.sol";
import {CredexTypes} from "../types/CredexTypes.sol";

contract CredexLending is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant YEAR_IN_SECONDS = 365 days;

    IERC20 public immutable debtAsset;
    IERC20 public immutable collateralAsset;

    ICreditVerifier public verifier;
    ICredexSBT public sbt;

    uint256 public nextLoanId = 1;
    uint256 public immutable loanDurationSeconds;
    uint256 public immutable gracePeriodSeconds;
    uint256 public immutable liquidationDelaySeconds;

    mapping(uint256 loanId => CredexTypes.Loan loan) private loans;
    mapping(address borrower => CredexTypes.BorrowerProfile profile) private borrowerProfiles;
    mapping(bytes32 proofId => bool consumed) public consumedProofs;
    mapping(CredexTypes.CreditTier tier => CredexTypes.TierConfig config) private tierConfigs;
    mapping(address lender => uint256 amount) public lenderDeposits;

    CredexTypes.PoolState private _poolState;

    struct OriginationContext {
        CredexTypes.ProofContext proofContext;
        CredexTypes.TierConfig tierConfig;
        uint256 requiredCollateral;
    }

    constructor(
        address debtAsset_,
        address collateralAsset_,
        address verifier_,
        address sbt_,
        uint256 loanDurationSeconds_,
        uint256 gracePeriodSeconds_,
        uint256 liquidationDelaySeconds_
    ) Ownable(msg.sender) {
        if (debtAsset_ == address(0) || collateralAsset_ == address(0) || verifier_ == address(0) || sbt_ == address(0))
        {
            revert CredexErrors.ZeroAddressNotAllowed();
        }
        if (loanDurationSeconds_ == 0 || gracePeriodSeconds_ == 0 || liquidationDelaySeconds_ < gracePeriodSeconds_) {
            revert CredexErrors.InvalidTierConfig();
        }

        debtAsset = IERC20(debtAsset_);
        collateralAsset = IERC20(collateralAsset_);
        verifier = ICreditVerifier(verifier_);
        sbt = ICredexSBT(sbt_);
        loanDurationSeconds = loanDurationSeconds_;
        gracePeriodSeconds = gracePeriodSeconds_;
        liquidationDelaySeconds = liquidationDelaySeconds_;
    }

    function setTierConfig(
        CredexTypes.CreditTier tier,
        uint256 minScore,
        uint256 maxScore,
        uint256 minCollateralRatioBps,
        uint256 annualInterestRateBps,
        uint256 maxLoanAmount,
        bool active
    ) external onlyOwner {
        if (tier == CredexTypes.CreditTier.None) revert CredexErrors.InvalidTierConfig();
        if (minScore > maxScore || minCollateralRatioBps == 0 || maxLoanAmount == 0) {
            revert CredexErrors.InvalidTierConfig();
        }

        tierConfigs[tier] = CredexTypes.TierConfig({
            tier: tier,
            minScore: minScore,
            maxScore: maxScore,
            minCollateralRatioBps: minCollateralRatioBps,
            annualInterestRateBps: annualInterestRateBps,
            maxLoanAmount: maxLoanAmount,
            active: active
        });

        emit CredexEvents.TierConfigUpdated(tier, minCollateralRatioBps, annualInterestRateBps, maxLoanAmount, active);
    }

    function setVerifier(address verifier_) external onlyOwner {
        if (verifier_ == address(0)) revert CredexErrors.ZeroAddressNotAllowed();
        verifier = ICreditVerifier(verifier_);
        emit CredexEvents.VerifierUpdated(verifier_);
    }

    function setSBT(address sbt_) external onlyOwner {
        if (sbt_ == address(0)) revert CredexErrors.ZeroAddressNotAllowed();
        sbt = ICredexSBT(sbt_);
    }

    function supplyLiquidity(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert CredexErrors.InvalidBorrowAmount();
        debtAsset.safeTransferFrom(msg.sender, address(this), amount);
        _poolState.totalLiquidity += amount;
        _poolState.availableLiquidity += amount;
    }

    /// @notice Deposit lending asset into the pool to earn yield.
    /// @dev Caller must approve this contract for `amount` of `debtAsset` first.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert CredexErrors.InvalidBorrowAmount();
        debtAsset.safeTransferFrom(msg.sender, address(this), amount);
        lenderDeposits[msg.sender] += amount;
        _poolState.totalLiquidity += amount;
        _poolState.availableLiquidity += amount;
        emit CredexEvents.LenderDeposited(msg.sender, amount);
    }

    /// @notice Withdraw previously deposited lending asset.
    /// @dev Can only withdraw up to your deposited balance and available liquidity.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert CredexErrors.InvalidBorrowAmount();
        if (lenderDeposits[msg.sender] < amount) revert CredexErrors.PoolInsufficientLiquidity();
        if (_poolState.availableLiquidity < amount) revert CredexErrors.PoolInsufficientLiquidity();
        lenderDeposits[msg.sender] -= amount;
        _poolState.availableLiquidity -= amount;
        _poolState.totalLiquidity -= amount;
        debtAsset.safeTransfer(msg.sender, amount);
        emit CredexEvents.LenderWithdrawn(msg.sender, amount);
    }

    function withdrawLiquidity(uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert CredexErrors.ZeroAddressNotAllowed();
        if (amount == 0) revert CredexErrors.InvalidBorrowAmount();
        if (_poolState.availableLiquidity < amount) revert CredexErrors.PoolInsufficientLiquidity();

        _poolState.availableLiquidity -= amount;
        _poolState.totalLiquidity -= amount;
        debtAsset.safeTransfer(to, amount);
    }

    function requestLoan(uint256 principalAmount, uint256 collateralAmount, bytes calldata proofData)
        external
        nonReentrant
        returns (uint256 loanId)
    {
        if (principalAmount == 0) revert CredexErrors.InvalidBorrowAmount();
        if (collateralAmount == 0) revert CredexErrors.InvalidCollateralAmount();

        CredexTypes.BorrowerProfile storage profile = borrowerProfiles[msg.sender];
        if (profile.hasActiveLoan) revert CredexErrors.ActiveLoanExists();
        if (profile.permanentlyFlagged) revert CredexErrors.UnauthorizedCaller();

        OriginationContext memory context = _buildOriginationContext(msg.sender, principalAmount, collateralAmount, proofData);

        collateralAsset.safeTransferFrom(msg.sender, address(this), collateralAmount);

        loanId = _createLoan(msg.sender, principalAmount, collateralAmount, context);
        _updateBorrowerAfterOrigination(profile, context.proofContext.approvedTier, loanId);
        _updatePoolAfterOrigination(principalAmount, collateralAmount);

        debtAsset.safeTransfer(msg.sender, principalAmount);

        if (!sbt.hasToken(msg.sender)) {
            sbt.mintForBorrower(msg.sender, context.proofContext.approvedTier);
        }
        sbt.updateBorrowerState(
            msg.sender,
            profile.currentTier,
            profile.totalLoansRepaid,
            profile.currentRepaymentStreak,
            profile.permanentlyFlagged
        );

        emit CredexEvents.CollateralDeposited(loanId, msg.sender, address(collateralAsset), collateralAmount);
        emit CredexEvents.BorrowerProfileUpdated(
            msg.sender, profile.currentTier, profile.hasActiveLoan, profile.activeLoanId, block.timestamp
        );
        emit CredexEvents.LoanApproved(
            loanId, msg.sender, principalAmount, collateralAmount, context.proofContext.approvedTier, block.timestamp
        );
    }

    function repayLoan(uint256 loanId) external nonReentrant {
        CredexTypes.Loan storage loan = loans[loanId];
        if (loan.loanId == 0) revert CredexErrors.LoanNotFound();
        if (loan.borrower != msg.sender) revert CredexErrors.UnauthorizedCaller();
        if (loan.status != CredexTypes.LoanStatus.Active) revert CredexErrors.InvalidLoanStatus();
        if (block.timestamp > loan.gracePeriodEndsAt) revert CredexErrors.LoanPastDue();

        uint256 amountDue = getAmountDue(loanId);
        uint256 interestAccrued = amountDue - loan.principalAmount;

        debtAsset.safeTransferFrom(msg.sender, address(this), amountDue);
        collateralAsset.safeTransfer(msg.sender, loan.collateralAmount);

        loan.status = CredexTypes.LoanStatus.Repaid;
        loan.repaidTimestamp = block.timestamp;

        CredexTypes.BorrowerProfile storage profile = borrowerProfiles[msg.sender];
        profile.hasActiveLoan = false;
        profile.activeLoanId = 0;
        profile.totalLoansRepaid += 1;
        if (block.timestamp <= loan.dueTimestamp) {
            profile.currentRepaymentStreak += 1;
            if (profile.currentRepaymentStreak > profile.bestRepaymentStreak) {
                profile.bestRepaymentStreak = profile.currentRepaymentStreak;
            }
        } else {
            profile.currentRepaymentStreak = 0;
        }
        profile.lastLoanClosedAt = block.timestamp;

        _poolState.availableLiquidity += amountDue;
        _poolState.totalLiquidity += interestAccrued;
        _poolState.totalPrincipalOutstanding -= loan.principalAmount;
        _poolState.totalCollateralLocked -= loan.collateralAmount;
        _poolState.totalInterestCollected += interestAccrued;

        sbt.updateBorrowerState(
            msg.sender,
            profile.currentTier,
            profile.totalLoansRepaid,
            profile.currentRepaymentStreak,
            profile.permanentlyFlagged
        );

        emit CredexEvents.CollateralReleased(loanId, msg.sender, address(collateralAsset), loan.collateralAmount);
        emit CredexEvents.BorrowerProfileUpdated(
            msg.sender, profile.currentTier, profile.hasActiveLoan, profile.activeLoanId, block.timestamp
        );
        emit CredexEvents.LoanRepaid(loanId, msg.sender, amountDue, block.timestamp);
    }

    function markDefault(uint256 loanId) external nonReentrant {
        CredexTypes.Loan storage loan = loans[loanId];
        if (loan.loanId == 0) revert CredexErrors.LoanNotFound();
        if (loan.status != CredexTypes.LoanStatus.Active) revert CredexErrors.InvalidLoanStatus();
        if (block.timestamp < loan.gracePeriodEndsAt) revert CredexErrors.LoanNotPastGracePeriod();

        loan.status = CredexTypes.LoanStatus.Defaulted;

        CredexTypes.BorrowerProfile storage profile = borrowerProfiles[loan.borrower];
        profile.totalDefaults += 1;
        profile.currentRepaymentStreak = 0;
        profile.permanentlyFlagged = true;

        _poolState.totalDefaults += 1;

        sbt.updateBorrowerState(
            loan.borrower, profile.currentTier, profile.totalLoansRepaid, profile.currentRepaymentStreak, true
        );

        emit CredexEvents.BorrowerFlagged(loan.borrower, true, block.timestamp);
        emit CredexEvents.LoanDefaulted(loanId, loan.borrower, block.timestamp);
    }

    function liquidateLoan(uint256 loanId) external nonReentrant {
        CredexTypes.Loan storage loan = loans[loanId];
        if (loan.loanId == 0) revert CredexErrors.LoanNotFound();
        if (loan.status != CredexTypes.LoanStatus.Defaulted) revert CredexErrors.LoanNotDefaulted();
        if (block.timestamp < loan.dueTimestamp + liquidationDelaySeconds) revert CredexErrors.LiquidationNotAllowed();

        loan.status = CredexTypes.LoanStatus.Liquidated;
        loan.liquidatedTimestamp = block.timestamp;

        collateralAsset.safeTransfer(owner(), loan.collateralAmount);

        CredexTypes.BorrowerProfile storage profile = borrowerProfiles[loan.borrower];
        profile.hasActiveLoan = false;
        profile.activeLoanId = 0;
        profile.lastLoanClosedAt = block.timestamp;

        _poolState.totalPrincipalOutstanding -= loan.principalAmount;
        _poolState.totalCollateralLocked -= loan.collateralAmount;
        _poolState.totalLiquidations += 1;
        _poolState.totalSeizedCollateral += loan.collateralAmount;

        sbt.updateBorrowerState(
            loan.borrower, profile.currentTier, profile.totalLoansRepaid, profile.currentRepaymentStreak, true
        );

        emit CredexEvents.CollateralSeized(loanId, loan.borrower, address(collateralAsset), loan.collateralAmount);
        emit CredexEvents.BorrowerProfileUpdated(
            loan.borrower, profile.currentTier, profile.hasActiveLoan, profile.activeLoanId, block.timestamp
        );
        emit CredexEvents.LoanLiquidated(loanId, loan.borrower, loan.collateralAmount, block.timestamp);
    }

    function getAmountDue(uint256 loanId) public view returns (uint256 amountDue) {
        CredexTypes.Loan memory loan = loans[loanId];
        if (loan.loanId == 0) revert CredexErrors.LoanNotFound();
        if (loan.status != CredexTypes.LoanStatus.Active) revert CredexErrors.InvalidLoanStatus();

        uint256 accrualEndsAt = block.timestamp;
        if (accrualEndsAt > loan.dueTimestamp) {
            accrualEndsAt = loan.dueTimestamp;
        }

        uint256 elapsed = accrualEndsAt - loan.startTimestamp;
        uint256 interestAccrued =
            Math.mulDiv(loan.principalAmount, loan.interestRateBps * elapsed, BPS_DENOMINATOR * YEAR_IN_SECONDS);

        amountDue = loan.principalAmount + interestAccrued;
    }

    function getLoan(uint256 loanId) external view returns (CredexTypes.Loan memory loan) {
        loan = loans[loanId];
        if (loan.loanId == 0) revert CredexErrors.LoanNotFound();
    }

    function getBorrowerProfile(address borrower) external view returns (CredexTypes.BorrowerProfile memory profile) {
        profile = borrowerProfiles[borrower];
    }

    function getTierConfig(CredexTypes.CreditTier tier) external view returns (CredexTypes.TierConfig memory config) {
        config = tierConfigs[tier];
    }

    function getPoolState() external view returns (CredexTypes.PoolState memory poolState) {
        poolState = _poolState;
    }

    function previewRequiredCollateral(CredexTypes.CreditTier tier, uint256 principalAmount)
        external
        view
        returns (uint256 collateralAmount)
    {
        CredexTypes.TierConfig memory tierConfig = tierConfigs[tier];
        if (!tierConfig.active) revert CredexErrors.InvalidTierConfig();
        collateralAmount =
            Math.mulDiv(principalAmount, tierConfig.minCollateralRatioBps, BPS_DENOMINATOR, Math.Rounding.Ceil);
    }

    function _validateProofContext(
        address borrower,
        uint256 principalAmount,
        CredexTypes.ProofContext memory proofContext
    ) internal view {
        if (proofContext.proofId == bytes32(0)) revert CredexErrors.InvalidProof();
        if (proofContext.borrower != borrower) revert CredexErrors.ProofBorrowerMismatch();
        if (proofContext.approvedTier == CredexTypes.CreditTier.None) revert CredexErrors.ProofTierMismatch();
        if (proofContext.validUntil < block.timestamp) revert CredexErrors.ProofExpired();
        if (proofContext.sourceChainId != 0 && proofContext.sourceChainId != block.chainid) {
            revert CredexErrors.UnsupportedProofSource();
        }
        if (proofContext.status == CredexTypes.ProofStatus.Consumed || consumedProofs[proofContext.proofId]) {
            revert CredexErrors.ProofAlreadyConsumed();
        }
        if (proofContext.status == CredexTypes.ProofStatus.Expired) revert CredexErrors.ProofExpired();
        if (proofContext.status == CredexTypes.ProofStatus.Revoked) revert CredexErrors.InvalidProof();
        if (principalAmount > proofContext.maxBorrowAmount) revert CredexErrors.ProofAmountExceeded();
    }

    function _buildOriginationContext(
        address borrower,
        uint256 principalAmount,
        uint256 collateralAmount,
        bytes calldata proofData
    ) internal view returns (OriginationContext memory context) {
        context.proofContext = verifier.verifyProof(borrower, proofData);
        _validateProofContext(borrower, principalAmount, context.proofContext);

        context.tierConfig = tierConfigs[context.proofContext.approvedTier];
        if (!context.tierConfig.active) revert CredexErrors.InvalidTierConfig();
        if (principalAmount > context.tierConfig.maxLoanAmount) revert CredexErrors.InvalidBorrowAmount();

        context.requiredCollateral = Math.mulDiv(
            principalAmount, context.tierConfig.minCollateralRatioBps, BPS_DENOMINATOR, Math.Rounding.Ceil
        );
        if (collateralAmount < context.requiredCollateral) revert CredexErrors.InsufficientCollateral();
        if (_poolState.availableLiquidity < principalAmount) revert CredexErrors.PoolInsufficientLiquidity();
    }

    function _createLoan(
        address borrower,
        uint256 principalAmount,
        uint256 collateralAmount,
        OriginationContext memory context
    ) internal returns (uint256 loanId) {
        loanId = nextLoanId++;
        loans[loanId] = CredexTypes.Loan({
            loanId: loanId,
            borrower: borrower,
            principalAmount: principalAmount,
            collateralAmount: collateralAmount,
            interestRateBps: context.tierConfig.annualInterestRateBps,
            collateralRatioBps: context.tierConfig.minCollateralRatioBps,
            creditTier: context.proofContext.approvedTier,
            startTimestamp: block.timestamp,
            dueTimestamp: block.timestamp + loanDurationSeconds,
            gracePeriodEndsAt: block.timestamp + loanDurationSeconds + gracePeriodSeconds,
            repaidTimestamp: 0,
            liquidatedTimestamp: 0,
            status: CredexTypes.LoanStatus.Active,
            collateralAsset: address(collateralAsset),
            debtAsset: address(debtAsset),
            proofId: context.proofContext.proofId,
            proofTimestamp: context.proofContext.issuedAt,
            scoreReference: context.proofContext.scoreReference
        });

        consumedProofs[context.proofContext.proofId] = true;
    }

    function _updateBorrowerAfterOrigination(
        CredexTypes.BorrowerProfile storage profile,
        CredexTypes.CreditTier approvedTier,
        uint256 loanId
    ) internal {
        profile.wallet = msg.sender;
        profile.currentTier = approvedTier;
        profile.hasActiveLoan = true;
        profile.activeLoanId = loanId;
        profile.totalLoansOriginated += 1;
        profile.lastScoreUpdateAt = block.timestamp;
    }

    function _updatePoolAfterOrigination(uint256 principalAmount, uint256 collateralAmount) internal {
        _poolState.availableLiquidity -= principalAmount;
        _poolState.totalPrincipalOutstanding += principalAmount;
        _poolState.totalCollateralLocked += collateralAmount;
    }
}
