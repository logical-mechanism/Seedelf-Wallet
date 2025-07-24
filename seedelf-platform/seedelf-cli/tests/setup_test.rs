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

#[test]
fn test_remove_white_spaces_no_spaces() {
    let name: String = "NoSpacesHere".to_string();
    let final_name = name
        .split_whitespace() // breaks on any whitespace sequence
        .collect::<Vec<_>>() // collect the pieces
        .join("_");
    assert_eq!(name, final_name)
}

#[test]
fn test_remove_white_spaces_single_spaces() {
    let name: String = "Single Space".to_string();
    let final_name: String = name
        .split_whitespace() // breaks on any whitespace sequence
        .collect::<Vec<_>>() // collect the pieces
        .join("_");
    let expected: String = "Single_Space".to_string();
    assert_eq!(expected, final_name)
}

#[test]
fn test_remove_white_spaces_multiple_spaces() {
    let name: String = "Multiple      Space".to_string();
    let final_name: String = name
        .split_whitespace() // breaks on any whitespace sequence
        .collect::<Vec<_>>() // collect the pieces
        .join("_");
    let expected: String = "Multiple_Space".to_string();
    assert_eq!(expected, final_name)
}

#[test]
fn test_remove_white_spaces_tab() {
    let name: String = "Tab     Space".to_string();
    let final_name: String = name
        .split_whitespace() // breaks on any whitespace sequence
        .collect::<Vec<_>>() // collect the pieces
        .join("_");
    let expected: String = "Tab_Space".to_string();
    assert_eq!(expected, final_name)
}

#[test]
fn test_remove_white_spaces_trailing() {
    let name: String = " Single Space ".to_string();
    let final_name: String = name
        .split_whitespace() // breaks on any whitespace sequence
        .collect::<Vec<_>>() // collect the pieces
        .join("_");
    let expected: String = "Single_Space".to_string();
    assert_eq!(expected, final_name)
}
