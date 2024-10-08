import json

import requests


def collat_witness(tx_cbor: str, network: str) -> str:
    """
    Inputs:
        tx_cbor: The transaction CBOR as a string.
        network: Either 'preprod' or 'mainnet'.

    Returns:
        The collateral witness if successful, otherwise raises an error.
    """
    url = f"https://www.giveme.my/{network}/collateral/"
    headers = {'Content-Type': 'application/json'}
    data = {
        "tx_body": tx_cbor
    }

    # Perform the POST request
    response = requests.post(url, headers=headers, json=data)

    # Check if the response is valid (status code 200)
    if response.status_code == 200:
        response_json = response.json()
        collat_witness = response_json.get('witness')

        # If 'witness' is present in the response, return it
        if collat_witness:
            return collat_witness
        else:
            # If no witness, raise an error with the full response
            error_message = json.dumps(response_json, indent=2)
            raise Exception(
                f"Error: Failed to retrieve witness. Response:\n{error_message}")
    else:
        # Raise an error if the request fails
        raise Exception(
            f"HTTP Error: {response.status_code} - {response.text}")


# Example usage

try:
    tx_cbor = '84ab00d9010281825820f85e90f08b13c840ea978556a93dcbc14ab95813ee07042b10df579009567033010dd90102818258201d388e615da2dca607e28f704130d04e39da6f251d551d66d054b75607e0393f0012d9010281825820d21a082be2c486a4f8303c719ab62836e561b09ecad23f8b0fbb0aab40dc8974010182a300581d7009b8028c6334b82d951adebb8bb2a1749cd6a13a76643e03431268e201821a0018dbfca1581c09b8028c6334b82d951adebb8bb2a1749cd6a13a76643e03431268e2a158205eed0e1f6173646601f85e90f08b13c840ea978556a93dcbc14ab95813ee070401028201d8185868d8799f583097f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb5830877ad9c3cbd7724210870fbb28fb04822c2f54632445e2a960018426d64ca881d2899082852d7191890945809513d81eff82581d608b9993f39117c0c70dc04868e216d0b2f29858c08b0555460d02a2cd1a02d492a31082581d608b9993f39117c0c70dc04868e216d0b2f29858c08b0555460d02a2cd1a00469320111a0005b820021a0003d0150ed9010282581c7c24c22d1dc252d31f6022ff22ccc838c2ab83a461172d7c2dae61f4581c8b9993f39117c0c70dc04868e216d0b2f29858c08b0555460d02a2cd09a1581c09b8028c6334b82d951adebb8bb2a1749cd6a13a76643e03431268e2a158205eed0e1f6173646601f85e90f08b13c840ea978556a93dcbc14ab95813ee0704010b5820be7962ca44f69d277253dabea54be33a27c7c8f4fbbc2541df8ada67c40e049b07582081c9ab8a4bcdccff7b0e928b51c085dae13ca4099cc42b89ba2d10228f5f8df9a105a1820100824461736466821a000179681a01a30693f5d90103a100a1006461636162'  # Replace this with the actual tx_cbor value
    witness = collat_witness(tx_cbor, "preprod")
    print(witness)
except Exception as e:
    print(e)
    exit
