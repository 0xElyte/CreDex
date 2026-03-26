## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

## CreDex Scripts

### Deploy Local Mocks

Deploy mock USDC, mock collateral, and the mock verifier.

```shell
$ forge script script/DeployLocalMocks.s.sol:DeployLocalMocks --rpc-url <your_rpc_url> --broadcast
```

Required env:

```shell
PRIVATE_KEY=<deployer_private_key>
```

### Deploy Full CreDex Protocol

Deploy the verifier, SBT, lending contract, configure the default tier rules, and optionally seed liquidity.

```shell
$ forge script script/DeployCredexProtocol.s.sol:DeployCredexProtocol --rpc-url <your_rpc_url> --broadcast
```

Core env:

```shell
PRIVATE_KEY=<deployer_private_key>
USE_MOCK_ASSETS=true
INITIAL_LIQUIDITY=50000000000
SBT_NAME="CreDex Credit"
SBT_SYMBOL="cCREDIT"
```

If using real assets instead of mocks:

```shell
PRIVATE_KEY=<deployer_private_key>
USE_MOCK_ASSETS=false
DEBT_ASSET=<existing_usdc_address>
COLLATERAL_ASSET=<existing_collateral_address>
INITIAL_LIQUIDITY=<amount_in_token_decimals>
```

Optional timing overrides:

```shell
LOAN_DURATION_SECONDS=2592000
GRACE_PERIOD_SECONDS=604800
LIQUIDATION_DELAY_SECONDS=2592000
```

Notes:

- The full deploy script automatically authorizes the lending contract as an SBT updater.
- The full deploy script automatically configures Bronze, Silver, Gold, and Platinum tiers using the current MVP terms.
- If `USE_MOCK_ASSETS=true`, the script deploys mocks and mints initial debt liquidity to the deployer before seeding the pool.
- If `USE_MOCK_ASSETS=false`, the deployer must already hold the configured debt asset for `INITIAL_LIQUIDITY` seeding to succeed.

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
