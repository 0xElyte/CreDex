// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {CredexLending} from "../src/core/CredexLending.sol";
import {CredexSBT} from "../src/core/CredexSBT.sol";
import {RelayedCreditVerifier} from "../src/core/RelayedCreditVerifier.sol";
import {MockCreditVerifier} from "../src/mocks/MockCreditVerifier.sol";
import {ICreditVerifier} from "../src/interfaces/ICreditVerifier.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {CredexTypes} from "../src/types/CredexTypes.sol";

contract DeployCredexProtocol is Script {
    uint256 internal constant DEFAULT_ONE_USDC = 1e6;

    struct DeployConfig {
        uint256 deployerKey;
        bool useMockAssets;
        address debtAsset;
        address collateralAsset;
        uint256 loanDurationSeconds;
        uint256 gracePeriodSeconds;
        uint256 liquidationDelaySeconds;
        uint256 initialLiquidity;
        string sbtName;
        string sbtSymbol;
        address relayerAddress;
        bool useMockVerifier;
    }

    struct DeployResult {
        address debtAsset;
        address collateralAsset;
        address verifier;
        address sbt;
        address lending;
    }

    function run() external returns (DeployResult memory result) {
        DeployConfig memory config = _loadConfig();

        vm.startBroadcast(config.deployerKey);

        MockERC20 debtMock;
        MockERC20 collateralMock;

        if (config.useMockAssets) {
            debtMock = new MockERC20("Mock USDC", "mUSDC", 6);
            collateralMock = new MockERC20("Mock Collateral", "mCOLL", 6);
            config.debtAsset = address(debtMock);
            config.collateralAsset = address(collateralMock);
        }

        address verifierAddress = vm.envOr("CREDIT_VERIFIER", address(0));
        ICreditVerifier verifier;
        if (verifierAddress != address(0)) {
            verifier = ICreditVerifier(verifierAddress);
        } else if (config.useMockVerifier) {
            verifier = ICreditVerifier(address(new MockCreditVerifier()));
        } else {
            address relayerAddr = config.relayerAddress != address(0)
                ? config.relayerAddress
                : vm.addr(config.deployerKey);
            verifier = ICreditVerifier(address(new RelayedCreditVerifier(relayerAddr)));
            console2.log("RelayedCreditVerifier deployed with relayer:", relayerAddr);
        }

        CredexSBT sbt = new CredexSBT(config.sbtName, config.sbtSymbol);
        CredexLending lending = new CredexLending(
            config.debtAsset,
            config.collateralAsset,
            address(verifier),
            address(sbt),
            config.loanDurationSeconds,
            config.gracePeriodSeconds,
            config.liquidationDelaySeconds
        );

        sbt.setAuthorizedUpdater(address(lending), true);
        _configureDefaultTiers(lending);

        if (config.initialLiquidity > 0) {
            if (config.useMockAssets) {
                debtMock.mint(vm.addr(config.deployerKey), config.initialLiquidity);
            }
            IERC20(config.debtAsset).approve(address(lending), config.initialLiquidity);
            lending.supplyLiquidity(config.initialLiquidity);
        }

        vm.stopBroadcast();

        result = DeployResult({
            debtAsset: config.debtAsset,
            collateralAsset: config.collateralAsset,
            verifier: address(verifier),
            sbt: address(sbt),
            lending: address(lending)
        });

        _logDeployment(result, config);
    }

    function _loadConfig() internal view returns (DeployConfig memory config) {
        config.deployerKey = vm.envUint("PRIVATE_KEY");
        config.useMockAssets = vm.envOr("USE_MOCK_ASSETS", true);
        config.debtAsset = vm.envOr("DEBT_ASSET", address(0));
        config.collateralAsset = vm.envOr("COLLATERAL_ASSET", address(0));
        config.loanDurationSeconds = vm.envOr("LOAN_DURATION_SECONDS", uint256(30 days));
        config.gracePeriodSeconds = vm.envOr("GRACE_PERIOD_SECONDS", uint256(7 days));
        config.liquidationDelaySeconds = vm.envOr("LIQUIDATION_DELAY_SECONDS", uint256(30 days));
        config.initialLiquidity = vm.envOr("INITIAL_LIQUIDITY", uint256(50_000 * DEFAULT_ONE_USDC));
        config.sbtName = vm.envOr("SBT_NAME", string("CreDex Credit"));
        config.sbtSymbol = vm.envOr("SBT_SYMBOL", string("cCREDIT"));
        config.relayerAddress = vm.envOr("RELAYER_ADDRESS", address(0));
        config.useMockVerifier = vm.envOr("USE_MOCK_VERIFIER", false);

        if (!config.useMockAssets) {
            require(config.debtAsset != address(0), "DEBT_ASSET required");
            require(config.collateralAsset != address(0), "COLLATERAL_ASSET required");
        }
    }

    function _configureDefaultTiers(CredexLending lending) internal {
        lending.setTierConfig(CredexTypes.CreditTier.Bronze, 400, 549, 6500, 2200, 500 * DEFAULT_ONE_USDC, true);
        lending.setTierConfig(CredexTypes.CreditTier.Silver, 550, 699, 5000, 1400, 2_000 * DEFAULT_ONE_USDC, true);
        lending.setTierConfig(CredexTypes.CreditTier.Gold, 700, 849, 3500, 800, 5_000 * DEFAULT_ONE_USDC, true);
        lending.setTierConfig(
            CredexTypes.CreditTier.Platinum, 850, 1000, 2000, 400, 10_000 * DEFAULT_ONE_USDC, true
        );
    }

    function _logDeployment(DeployResult memory result, DeployConfig memory config) internal pure {
        console2.log("Deployer:", vm.addr(config.deployerKey));
        console2.log("Use mock assets:", config.useMockAssets);
        console2.log("Debt asset:", result.debtAsset);
        console2.log("Collateral asset:", result.collateralAsset);
        console2.log("Verifier:", result.verifier);
        console2.log("SBT:", result.sbt);
        console2.log("Lending:", result.lending);
        console2.log("Initial liquidity:", config.initialLiquidity);
    }
}