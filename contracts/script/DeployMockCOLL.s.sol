// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Deploys only the mCOLL MockERC20 token to fill the missing deployment.
contract DeployMockCOLL is Script {
    function run() external returns (address mcoll) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        MockERC20 token = new MockERC20("Mock Collateral", "mCOLL", 6);
        vm.stopBroadcast();
        mcoll = address(token);
        console2.log("mCOLL deployed at:", mcoll);
    }
}
