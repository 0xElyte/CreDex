// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {CredexLending} from "../src/core/CredexLending.sol";
import {RelayedCreditVerifier} from "../src/core/RelayedCreditVerifier.sol";

/// @notice Deploys a fresh RelayedCreditVerifier and wires it into CredexLending.
///         Run with the owner/relayer private key (same wallet owns both contracts).
contract DeployVerifier is Script {
    address constant LENDING = 0x4fe010Fe5911f48fbB3497b8A6165E21E86B32a4;
    address constant RELAYER = 0x9D9033Ffa946D73B1A9530A47386Fe206CDb4Da0;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        RelayedCreditVerifier rcv = new RelayedCreditVerifier(RELAYER);
        console2.log("RelayedCreditVerifier deployed at:", address(rcv));

        CredexLending(LENDING).setVerifier(address(rcv));
        console2.log("CredexLending.setVerifier updated to:", address(rcv));

        vm.stopBroadcast();
    }
}
