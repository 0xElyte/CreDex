// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ICreditVerifier} from "../interfaces/ICreditVerifier.sol";
import {CredexErrors} from "../libraries/CredexErrors.sol";
import {CredexTypes} from "../types/CredexTypes.sol";

/// @title  RelayedCreditVerifier
/// @notice EVM-side bridge adapter that accepts proof contexts relayed from the
///         Starknet Cairo CreditVerifier. The protocol backend validates a borrower's
///         credit score via the Cairo circuit on Starknet, then calls relay() here so
///         CredexLending can consume the proof synchronously on EVM.
///
/// @dev    Trust model: only wallet addresses explicitly authorised as relayers
///         (or the contract owner) may register proofs. The backend relayer wallet
///         is authorised at deploy time and can be rotated by the owner.
///
///         sourceChainId is set to 0 in relayed proofs so CredexLending accepts
///         them on any EVM chain (per its _validateProofContext logic).
contract RelayedCreditVerifier is ICreditVerifier, Ownable {
    // ── State ─────────────────────────────────────────────────────────────────

    mapping(address => bool) public authorizedRelayers;
    mapping(bytes32 => CredexTypes.ProofContext) private _proofs;

    // ── Events ────────────────────────────────────────────────────────────────

    event ProofRelayed(bytes32 indexed proofId, address indexed borrower, CredexTypes.CreditTier tier);
    event RelayerSet(address indexed relayer, bool authorized);

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @param initialRelayer  Backend wallet address authorised to relay proofs.
    ///                        Pass address(0) to skip (owner can add one later).
    constructor(address initialRelayer) Ownable(msg.sender) {
        if (initialRelayer != address(0)) {
            authorizedRelayers[initialRelayer] = true;
            emit RelayerSet(initialRelayer, true);
        }
    }

    // ── Access Control ────────────────────────────────────────────────────────

    modifier onlyRelayer() {
        if (msg.sender != owner() && !authorizedRelayers[msg.sender]) {
            revert CredexErrors.UnauthorizedCaller();
        }
        _;
    }

    /// @notice Grants or revokes relay authority for an address.
    function setAuthorizedRelayer(address relayer, bool authorized) external onlyOwner {
        if (relayer == address(0)) revert CredexErrors.ZeroAddressNotAllowed();
        authorizedRelayers[relayer] = authorized;
        emit RelayerSet(relayer, authorized);
    }

    // ── Relay (write path) ────────────────────────────────────────────────────

    /// @notice Called by the backend after validating a score via the Starknet Cairo
    ///         CreditVerifier. Registers the proof context on-chain so the borrower
    ///         can call CredexLending.requestLoan() in the same block or shortly after.
    ///
    /// @param ctx  Proof context produced by the backend relay, sourced from Starknet.
    function relay(CredexTypes.ProofContext calldata ctx) external onlyRelayer {
        if (ctx.proofId == bytes32(0)) revert CredexErrors.InvalidProof();
        if (ctx.borrower == address(0)) revert CredexErrors.ZeroAddressNotAllowed();
        if (ctx.approvedTier == CredexTypes.CreditTier.None) revert CredexErrors.ProofTierMismatch();
        if (ctx.validUntil != 0 && block.timestamp > ctx.validUntil) revert CredexErrors.ProofExpired();

        _proofs[ctx.proofId] = ctx;
        emit ProofRelayed(ctx.proofId, ctx.borrower, ctx.approvedTier);
    }

    // ── ICreditVerifier (read path) ───────────────────────────────────────────

    /// @inheritdoc ICreditVerifier
    function verifyProof(address borrower, bytes calldata proofData)
        external
        view
        returns (CredexTypes.ProofContext memory proofContext)
    {
        bytes32 proofId = abi.decode(proofData, (bytes32));
        proofContext = _proofs[proofId];

        if (proofContext.proofId == bytes32(0)) revert CredexErrors.InvalidProof();
        if (proofContext.borrower != borrower) revert CredexErrors.ProofBorrowerMismatch();
        if (proofContext.validUntil != 0 && block.timestamp > proofContext.validUntil) {
            revert CredexErrors.ProofExpired();
        }
        if (proofContext.status == CredexTypes.ProofStatus.Consumed) revert CredexErrors.ProofAlreadyConsumed();
        if (proofContext.status == CredexTypes.ProofStatus.Revoked) revert CredexErrors.InvalidProof();
    }

    /// @inheritdoc ICreditVerifier
    function isProofConsumed(bytes32 proofId) external view returns (bool consumed) {
        consumed = _proofs[proofId].status == CredexTypes.ProofStatus.Consumed;
    }

    /// @inheritdoc ICreditVerifier
    function getProofStatus(bytes32 proofId) external view returns (CredexTypes.ProofStatus status) {
        status = _proofs[proofId].status;
    }
}
