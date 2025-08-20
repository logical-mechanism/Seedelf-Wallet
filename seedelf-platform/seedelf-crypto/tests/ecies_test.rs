use blstrs::Scalar;
use seedelf_crypto::ecies::Ecies;
use seedelf_crypto::register::Register;

#[test]
fn simple_encrypt() {
    let sk: Scalar = Scalar::from(18446744073709551606u64);
    let user: Register = Register::create(sk).unwrap();
    let message: &'static str = "Place Secret Message Here";
    let cypher: Ecies = Ecies::encrypt(message, &user).unwrap_or_default();
    println!("{:?}", cypher);
    let msg: String = cypher.decrypt(sk, &user).unwrap_or_default().unwrap_or_default();
    println!("{:?}", msg);
    assert_eq!(message, msg)
}


#[test]
fn long_message() {
    let sk: Scalar = Scalar::from(18446744073709551606u64);
    let user: Register = Register::create(sk).unwrap();
    let message: &'static str = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum ante justo, pulvinar non pulvinar at, porta eu orci. Nullam molestie erat eget dui eleifend scelerisque. Phasellus feugiat ligula nec urna elementum finibus. Nunc ut dolor gravida, pulvinar erat eget, interdum nisl. Integer et molestie nisi. Nullam malesuada finibus odio quis mollis. In vitae fermentum erat. Nunc condimentum est eget risus consectetur, a convallis arcu lacinia. Praesent non leo accumsan, laoreet turpis sit amet, luctus nibh. Pellentesque vel felis feugiat magna vestibulum aliquet at a lectus. Vivamus in condimentum lorem. Pellentesque convallis nisl vel sem placerat, et convallis eros feugiat.";
    let cypher: Ecies = Ecies::encrypt(message, &user).unwrap_or_default();
    println!("{:?}", cypher);
    let msg: String = cypher.decrypt(sk, &user).unwrap_or_default().unwrap_or_default();
    assert_eq!(message, msg)
}