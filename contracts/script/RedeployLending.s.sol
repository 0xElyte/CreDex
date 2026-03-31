// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CredexLending} from "../src/core/CredexLending.sol";
import {CredexSBT} from "../src/core/CredexSBT.sol";
import {CredexTypes} from "../src/types/CredexTypes.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev Redeploys CredexLending + CredexSBT using existing tokens and the
///      already-deployed RelayedCreditVerifier. Seeds pool with 10,000 mUSDC.
///
/// Usage (Sepolia):
///   forge script script/RedeployLending.s.sol \
///     --rpc-url $RPC --broadcast --slow
contract RedeployLending is Script {
    uint256 constant ONE_USDC = 1e6;

    // ── Existing deployed contracts ───────────────────────────────────────────
    address constant MUSDC     = 0x0ed7269d9Cc82b16E9E6D0f40c3bbF64c6Be17c2;
    address constant MCOLL_NEW = 0x2858Cb1D9C7b2e0420d04A0E988c4C425eF50964;
    address constant VERIFIER  = 0x9280972165D77a710AbBBAE7a6476ED61DaFDf80;
    address constant RELAYER   = 0x9D9033Ffa946D73B1A9530A47386Fe206CDb4Da0;

    uint256 constant SEED_LIQUIDITY = 10_000 * ONE_USDC;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy fresh SBT
        CredexSBT sbt = new CredexSBT("CreDex Credit", "cCREDIT");

        // 2. Deploy CredexLending with new mCOLL
        // Long durations for testnet: 365 day loans, 30 day grace, 30 day liquidation delay
        CredexLending lending = new CredexLending(
            MUSDC,
            MCOLL_NEW,
            VERIFIER,
            address(sbt),
            365 days,
            30 days,
            30 days
        );

        // 3. Authorise lending to update SBT state
        sbt.setAuthorizedUpdater(address(lending), true);

        // 4. Configure tiers
        lending.setTierConfig(CredexTypes.CreditTier.Bronze,   400,  549,  6500, 2200,  500 * ONE_USDC, true);
        lending.setTierConfig(CredexTypes.CreditTier.Silver,   550,  699,  5000, 1400, 2000 * ONE_USDC, true);
        lending.setTierConfig(CredexTypes.CreditTier.Gold,     700,  849,  3500,  800, 5000 * ONE_USDC, true);
        lending.setTierConfig(CredexTypes.CreditTier.Platinum, 850, 1000,  2000,  400, 10000 * ONE_USDC, true);

        // 5. Mint 10,000 mUSDC to deployer and seed pool
        MockERC20(MUSDC).mint(deployer, SEED_LIQUIDITY);
        IERC20(MUSDC).approve(address(lending), SEED_LIQUIDITY);
        lending.supplyLiquidity(SEED_LIQUIDITY);

        vm.stopBroadcast();

        console2.log("CredexSBT deployed at:     ", address(sbt));
        console2.log("CredexLending deployed at: ", address(lending));
        console2.log("Collateral asset:          ", MCOLL_NEW);
        console2.log("Pool seeded with:           10,000 mUSDC");
    }
}
