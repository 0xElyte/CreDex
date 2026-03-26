// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ICredexSBT} from "../interfaces/ICredexSBT.sol";
import {CredexErrors} from "../libraries/CredexErrors.sol";
import {CredexEvents} from "../libraries/CredexEvents.sol";
import {CredexTypes} from "../types/CredexTypes.sol";

contract CredexSBT is ERC721, Ownable, ICredexSBT {
    uint256 private _nextTokenId = 1;

    mapping(address borrower => uint256 tokenId) private _tokenIdByOwner;
    mapping(uint256 tokenId => CredexTypes.SBTMetadata metadata) private _metadataByTokenId;
    mapping(address updater => bool isAuthorized) public authorizedUpdaters;

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) Ownable(msg.sender) {}

    modifier onlyUpdater() {
        if (msg.sender != owner() && !authorizedUpdaters[msg.sender]) {
            revert CredexErrors.UnauthorizedSBTUpdater();
        }
        _;
    }

    function setAuthorizedUpdater(address updater, bool isAuthorized) external onlyOwner {
        if (updater == address(0)) revert CredexErrors.ZeroAddressNotAllowed();
        authorizedUpdaters[updater] = isAuthorized;
    }

    function mintForBorrower(address borrower, CredexTypes.CreditTier initialTier)
        external
        onlyUpdater
        returns (uint256 tokenId)
    {
        if (borrower == address(0)) revert CredexErrors.ZeroAddressNotAllowed();
        if (_tokenIdByOwner[borrower] != 0) revert CredexErrors.BorrowerAlreadyHasSBT();

        tokenId = _nextTokenId++;
        _safeMint(borrower, tokenId);

        _tokenIdByOwner[borrower] = tokenId;
        _metadataByTokenId[tokenId] = CredexTypes.SBTMetadata({
            tokenId: tokenId,
            owner: borrower,
            currentTier: initialTier,
            totalLoansRepaid: 0,
            repaymentStreak: 0,
            defaultFlag: false,
            issuedAt: block.timestamp,
            updatedAt: block.timestamp,
            metadataVersion: 1
        });

        emit CredexEvents.CreditSBTMinted(tokenId, borrower, block.timestamp);
    }

    function updateBorrowerState(
        address borrower,
        CredexTypes.CreditTier currentTier,
        uint256 totalLoansRepaid,
        uint256 repaymentStreak,
        bool defaultFlag
    ) external onlyUpdater {
        uint256 tokenId = _tokenIdByOwner[borrower];
        if (tokenId == 0) revert CredexErrors.TokenDoesNotExist();

        CredexTypes.SBTMetadata storage metadata = _metadataByTokenId[tokenId];
        metadata.currentTier = currentTier;
        metadata.totalLoansRepaid = totalLoansRepaid;
        metadata.repaymentStreak = repaymentStreak;
        metadata.defaultFlag = defaultFlag;
        metadata.updatedAt = block.timestamp;

        emit CredexEvents.CreditSBTUpdated(
            tokenId, borrower, currentTier, repaymentStreak, totalLoansRepaid, defaultFlag, block.timestamp
        );
    }

    function tokenOfOwner(address borrower) external view returns (uint256 tokenId) {
        tokenId = _tokenIdByOwner[borrower];
    }

    function hasToken(address borrower) external view returns (bool exists) {
        exists = _tokenIdByOwner[borrower] != 0;
    }

    function getMetadata(uint256 tokenId) external view returns (CredexTypes.SBTMetadata memory metadata) {
        metadata = _metadataByTokenId[tokenId];
        if (metadata.tokenId == 0) revert CredexErrors.TokenDoesNotExist();
    }

    function approve(address, uint256) public pure override {
        revert CredexErrors.SoulboundApprovalForbidden();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert CredexErrors.SoulboundApprovalForbidden();
    }

    function transferFrom(address, address, uint256) public pure override {
        revert CredexErrors.SoulboundTransferForbidden();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert CredexErrors.SoulboundTransferForbidden();
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) revert CredexErrors.SoulboundTransferForbidden();
    }
}
