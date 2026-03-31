// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {CredexLending} from "../src/core/CredexLending.sol";

/// @notice Mints mUSDC to the deployer and seeds the lending pool with liquidity.
/// Run whenever the pool needs to be topped up.
contract SeedPoolLiquidity is Script {
    // Deployed contract addresses on Sepolia
    address constant MUSDC           = 0x0ed7269d9Cc82b16E9E6D0f40c3bbF64c6Be17c2;
    address constant LENDING         = 0x4fe010Fe5911f48fbB3497b8A6165E21E86B32a4;
    uint256 constant SEED_AMOUNT_USDC = 100_000; // 100,000 USDC

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        uint256 seedAmount = SEED_AMOUNT_USDC * 1e6; // 6 decimals

        vm.startBroadcast(deployerKey);

        // 1. Mint mUSDC to deployer (MockERC20 has permissionless mint)
        MockERC20(MUSDC).mint(deployer, seedAmount);
        console2.log("Minted", SEED_AMOUNT_USDC, "mUSDC to deployer");

        // 2. Approve lending contract
        IERC20(MUSDC).approve(LENDING, seedAmount);

        // 3. Seed pool — onlyOwner, so deployer key must be the owner
        CredexLending(LENDING).supplyLiquidity(seedAmount);
        console2.log("Pool seeded with", SEED_AMOUNT_USDC, "mUSDC");
        console2.log("Lending contract:", LENDING);

        vm.stopBroadcast();

        // Sanity check
        uint256 available = CredexLending(LENDING).getPoolState().availableLiquidity;
        console2.log("Pool availableLiquidity (raw):", available);
        console2.log("Pool availableLiquidity (USDC):", available / 1e6);
    }
}
