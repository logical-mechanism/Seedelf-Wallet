pub fn run() {
    // other things can be added to this message
    println!("\nWelcome to seedelf-cli! 🌱");
    println!("\nYour wallet file should be stored in the home directory under .seedelf folder.");
    println!("\nSeedelf is a stealth wallet that hides the receiver and spender with Schnorr proofs using the BLS12-381 curve.");
    println!("UTxOs inside the wallet are indistinguishable from one-another.");
    println!("It is not possible to deduce the intended receiver assuming that the Elliptic Curve Decisional-Diffie-Hellman (ECDDH) problem is hard.");
    println!("\n")
}
