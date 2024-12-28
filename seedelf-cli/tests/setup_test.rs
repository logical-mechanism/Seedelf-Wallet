use seedelf_cli::setup::password_complexity_check;

#[test]
fn test_short_password() {
    let pw: String = "i@G37xzM".to_string();
    assert_eq!(password_complexity_check(pw), false)
}


#[test]
fn test_no_lowercase() {
    let pw: String = "I@G37XZM@QCGK3G".to_string();
    assert_eq!(password_complexity_check(pw), false)
}

#[test]
fn test_no_uppercase() {
    let pw: String = "i@g37xzm@qcgk3g".to_string();
    assert_eq!(password_complexity_check(pw), false)
}

#[test]
fn test_no_special() {
    let pw: String = "iaG37xzMaqcgk3g".to_string();
    assert_eq!(password_complexity_check(pw), false)
}

#[test]
fn test_good_password() {
    let pw: String = "i@G37xzM@qcgk3g".to_string();
    assert_eq!(password_complexity_check(pw), true)
}
