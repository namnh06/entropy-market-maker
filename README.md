# Entropy Market Maker
Docs:
https://org-docs.friktion.fi/entropy/market-making-bot-python/overview

Trade:
https://entropy.trade

## Setup
To run the market maker you will need:
* A Solana account with some SOL deposited to cover transaction fees
* A Entropy Account with some collateral deposited and a name (tip: use the UI)
* Your wallet keypair saved as a JSON file
* `node` and `yarn`

```shell
git clone https://github.com/Friktion-Labs/entropy-market-maker
cd market-maker-ts
yarn install

## Set mangoAccountName in entropy-market-maker/params/quote_params.json file to reflect the name of your MangoAccount
```

## Run via terminal
```shell
ts-node src/mm2.ts
```


## Environment Variables
| Variable | Default | Description |
| -------- | ------- | ----------- |
| `ENDPOINT_URL` | `https://mango.rpcpool.com` | Your RPC node endpoint |
| `KEYPAIR` | `${HOME}/.config/solana/id.json` | The location of your wallet keypair |
| `PARAMS` | `default.json` | params file |


## Market Maker Params
### See params/default.json for an example
| Variable            | Default     | Description                                                                       |
|---------------------|-------------|-----------------------------------------------------------------------------------|
| `group`             | `mainnet.1` | Name of the group in ids.json                                                     |
| `interval`          | `10000`     | Milliseconds to wait before updating quotes                                       |
| `mangoAccountName`  | N/A         | The MangoAccount name you input when initializing the MangoAccount via UI         |
| `mangoAccountPubkey` | N/A        | If no MangoAccount name, just pass in the pubkey                                  |
| `assets`            | N/A         | Mapping of symbols to trade and their specific params                             |
| `size_perc`         | `0.1`       | The size of each order as a percentage of equity                                  |
| `edge`              | `0.0010`    | How much to increase quote width from centralized exchange                        |
| `lean_coeff`        | `0.0005`    | How much to move the quotes per unit size of inventory                            |
| `bias`              | `0`         | Fixed amount to bias. Negative values bias downward. e.g. -0.0005 biases down 5bps|
| `requoteThresh`     | `0`         | How much new bid/ask price must change to requote; e.g. 0.0002 implies 2bps       |
| `ftxSize`           | `100000`    | How much to look up spread on centralized exchange                                |
| `disableFtxBooks`   | `false`     | Whether to try to find a FTX market for quoting.                                  |

