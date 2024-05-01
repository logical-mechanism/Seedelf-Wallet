import qrcode
import words


def create(data, file_path='qr_code.png'):
    """
    Takes an integer and creates a QR code image from it.
d
    Parameters:
    - data (int): The integer to be converted into a QR code.

    Returns:
    - The QR code image.
    """
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(data)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    img.save(file_path)


if __name__ == "__main__":
    m = words.generate_bip39_mnemonic()
    print(m)
    i = words.mnemonic_to_int(m)
    create(i)
