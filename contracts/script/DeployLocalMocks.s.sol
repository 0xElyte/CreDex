// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {MockCreditVerifier} from "../src/mocks/MockCreditVerifier.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract DeployLocalMocks is Script {
    function run() external returns (MockERC20 debtAsset, MockERC20 collateralAsset, MockCreditVerifier verifier) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        debtAsset = new MockERC20("Mock USDC", "mUSDC", 6);
        collateralAsset = new MockERC20("Mock Collateral", "mCOLL", 6);
        verifier = new MockCreditVerifier();

        vm.stopBroadcast();

        console2.log("Mock debt asset:", address(debtAsset));
        console2.log("Mock collateral asset:", address(collateralAsset));
        console2.log("Mock verifier:", address(verifier));
    }
}