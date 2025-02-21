# **seedelf-contracts**

The folder holds the Seedelf wallet smart contracts. [Aiken](https://aiken-lang.org/) is used to write the **Seedelf** smart contracts. The folder contains the happy path scripts. These files are used for testing purposes only. Users wishing to use the Seedelf wallet are encouraged to use [seedelf-cli](../seedelf-cli/README.md).

## Building

Compile the contracts with the `complete_build.sh` script. 

The random seed used in production is `acabcafe`.

Contract Hashes:

```
wallet:  94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469
seedelf: 84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255
```

## Testing

The command below will run all the tests.
```bash
aiken check
```

## Contact

For questions, suggestions, or concerns, please reach out to support@logicalmechanism.io.