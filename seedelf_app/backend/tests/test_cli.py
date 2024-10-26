import os

import pytest

from src import cli


@pytest.fixture
def config():
    # Get the path to the current file, then navigate to the `bin` folder relative to it
    base_dir = os.path.dirname(os.path.dirname(__file__))
    bin_path = os.path.join(base_dir, 'bin', 'cardano-cli')
    keys_path = os.path.join(base_dir, 'keys')
    tmp_path = os.path.join(base_dir, 'tmp')

    return {
        "cli": bin_path,
        "keys_path": keys_path,
        "tmp_path": tmp_path,
        "network": "--testnet-magic 1",
    }


def test_cardano_cli_version(config):
    version = cli.version(config["cli"])
    assert "cardano-cli 9.4.1.0" in version, "Incorrect cardano-cli version"


def test_key_gen(config):
    # Run the key generation function
    cli.key_gen(config['cli'], config['keys_path'])

    # Paths to the generated key files
    vkey_path = os.path.join(config['keys_path'], 'payment.vkey')
    skey_path = os.path.join(config['keys_path'], 'payment.skey')

    # Assert that both files exist
    assert os.path.exists(vkey_path), f"Verification key file not found at {vkey_path}"
    assert os.path.exists(skey_path), f"Signing key file not found at {skey_path}"


def test_key_hash(config):
    # Run the key generation function
    cli.key_gen(config['cli'], config['keys_path'])
    vkey_hash = cli.key_hash(config['cli'], config['keys_path'])
    assert len(vkey_hash) == 56


def test_address_build(config):
    addr = cli.address_build(config['cli'], config['keys_path'], config['network'])
    assert len(addr) == 63


def test_calculate_minimum_lovelace1(config):
    addr = cli.address_build(config['cli'], config['keys_path'], config['network'])
    min_utxo = cli.calculate_minimum_lovelace(config['cli'], config['tmp_path'], addr)
    assert min_utxo == 849070


def test_calculate_minimum_lovelace2(config):
    addr = cli.address_build(config['cli'], config['keys_path'], config['network'])
    min_utxo = cli.calculate_minimum_lovelace(config['cli'], config['tmp_path'], addr, "1234567890 12345678919752d1292b4be71b7f5d2b3219a15859c028f7454f66cd.acab")
    assert min_utxo == 1025780
