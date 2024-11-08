import os
import subprocess


def version(cli_path: str) -> str:
    func = [
        cli_path,
        '--version',
    ]

    p = subprocess.Popen(func, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output, _ = p.communicate()
    return output.decode('utf-8')


def key_gen(cli_path: str, key_path: str, prefix: str = 'payment') -> None:
    func = [
        cli_path,
        'conway',
        'address',
        'key-gen',
        '--verification-key-file',
        os.path.join(key_path, f'{prefix}.vkey'),
        '--signing-key-file',
        os.path.join(key_path, f'{prefix}.skey'),
    ]

    p = subprocess.Popen(func, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _, _ = p.communicate()
    return


def key_hash(cli_path: str, key_path: str, prefix: str = 'payment') -> str:
    func = [
        cli_path,
        'conway',
        'address',
        'key-hash',
        '--payment-verification-key-file',
        os.path.join(key_path, f'{prefix}.vkey'),
    ]

    p = subprocess.Popen(func, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output, _ = p.communicate()
    return output.decode('utf-8').rstrip()


def address_build(cli_path: str, key_path: str, network: str, prefix: str = 'payment') -> str:
    func = [
        cli_path,
        'conway',
        'address',
        'build',
        '--payment-verification-key-file',
        os.path.join(key_path, f'{prefix}.vkey'),
    ]
    func += network.split(" ")

    p = subprocess.Popen(func, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output, _ = p.communicate()
    return output.decode('utf-8').rstrip()


def calculate_minimum_lovelace(cli_path: str, protocol_path: str, address: str, tokens: str = "", datum_path: str = "") -> int:
    func = [
        cli_path,
        'conway',
        'transaction',
        'calculate-min-required-utxo',
        '--protocol-params-file',
        os.path.join(protocol_path, 'protocol.json'),
        '--tx-out',
        f'{address} + 5000000' if tokens == "" else f'{address} + 5000000 + {tokens}'
    ]
    if datum_path != "":
        func += [
            "--tx-out-inline-datum-file",
            os.path.join(datum_path, 'datum.json')
        ]

    p = subprocess.Popen(func, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output, _ = p.communicate()
    return int(output.decode('utf-8').rstrip().split(' ')[1])
