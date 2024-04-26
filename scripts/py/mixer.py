import hashlib
import json
import os
import secrets

# field prime from BLS12381, a really big prime with 114 digits
q = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab
# security parameter; how many bits are used in x, r, c, etc
sec_param = 256


def rerandomizer(data: dict, scale: int) -> dict:
    data = {
        "secret": data['secret'],
        "a": pow(int(data["a"], 16), scale, q),
        "b": pow(int(data["b"], 16), scale, q)
    }
    return data


def hexify(n: int) -> str:
    hex_n = hex(n)[2:]  # Remove the '0x' prefix
    if len(hex_n) % 2 != 0:
        hex_n = '0' + hex_n  # Prepend '0' if length is odd
    return hex_n


def data_hash(data: dict) -> str:
    data_str = json.dumps(data, sort_keys=True)
    return hashlib.sha256(data_str.encode()).hexdigest()


def write_token_to_file(data: dict, file_path: str):
    # Convert the data to a JSON string with sorted keys to ensure consistent ordering
    data_str = json.dumps(data, sort_keys=True)
    # Compute the hash of the data
    data_hash = hashlib.sha256(data_str.encode()).hexdigest()
    # Use the hash as the filename
    filename = f"{file_path}/{data_hash}.json"
    # Write the data to the file
    with open(filename, 'w+') as file:
        file.write(data_str)


def read_data_from_file(filename: str) -> dict:
    # Open the file and read the JSON data
    with open(filename, 'r') as file:
        data_str = file.read()
    # Convert the JSON string back to a dictionary
    data = json.loads(data_str)
    return data


def create_token(length: int = sec_param) -> dict:
    x = rng(length)  # Assuming rng is a function that generates a random number.
    u = pow(2, x, q)  # Assuming q is predefined somewhere in your code.
    # Convert to hexadecimal and ensure even length
    hex_a = hexify(2)
    hex_b = hexify(u)
    # force correct size for plutus integers
    data = {
        "secret": x,
        "a": hex_a,
        "b": hex_b,
    }
    return data


def z(r: int, c: int, x: int) -> int:
    return r + c * x


def rng(length: int = sec_param) -> int:
    return secrets.randbits(length)


def create_zk(x: int, g: int) -> None:
    ri = rng()
    ci = rng(64)
    zi = z(ri, ci, x)
    # do teh g^r term
    r = pow(g, ri, q)
    # print(x, ri, ci, zi)
    rb = hexify(r)
    cb = hexify(ci)
    zb = hexify(zi)

    redeemer = {
        "constructor": 1,
        "fields": [
            {
                "constructor": 0,
                "fields": [
                    {
                        "bytes": zb
                    },
                    {
                        "bytes": rb
                    },
                    {
                        "bytes": cb
                    }
                ]
            }
        ]
    }
    script_dir = os.path.dirname(__file__)
    # Construct the path to the file relative to the script location
    # Correcting the path and filename typo
    file_path = os.path.join(script_dir, '../data/lock/remove-redeemer.json')
    with open(file_path, 'w') as file:
        json.dump(redeemer, file, indent=2)


if __name__ == "__main__":
    print(create_token())
