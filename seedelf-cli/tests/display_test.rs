use seedelf_cli::display::hex_to_ascii;
#[test]
fn test_label_extraction() {
    let seedelf: String =
        "5eed0e1f5b416e6369656e744b72616b656e5d016ad73d1216555b07ad5a449ff2".to_string();
    let answer: String = "5b416e6369656e744b72616b656e5d".to_string();
    let substring: String = seedelf[8..38].to_string();
    assert_eq!(substring, answer);
}

#[test]
fn test_label_truncation1() {
    let mut answer: String = "5b416e6369656e744b72616b656e5d".to_string();
    answer.truncate(30);
    assert_eq!(answer.len(), 30);
}
#[test]
fn test_label_truncation2() {
    let mut answer: String = "5b416e6369656e744b7261".to_string();
    answer.truncate(30);
    assert_eq!(answer.len(), 22);
}

#[test]
fn test_label_to_ascii1() {
    let seedelf: String =
        "5eed0e1f5b416e6369656e744b72616b656e5d016ad73d1216555b07ad5a449ff2".to_string();
    let answer: String = "[AncientKraken]".to_string();
    let substring: String = seedelf[8..38].to_string();

    let ascii = hex_to_ascii(&substring).unwrap();
    assert_eq!(ascii, answer);
}

#[test]
fn test_label_to_ascii2() {
    let seedelf: String =
        "5eed0e1f416e6369656e744b72616b656e01cc4661ad78707b02687b1e7d7363".to_string();
    let answer: String = "AncientKraken..".to_string();
    let substring: String = seedelf[8..38].to_string();

    let ascii = hex_to_ascii(&substring).unwrap();
    assert_eq!(ascii, answer);
}

#[test]
fn test_fail_label_to_ascii1() {
    let seedelf: String =
        "5eed0e1f5b416e6369656e744b000acab000016ad73d1216555b07ad5a449ff2".to_string();
    let answer: String = "[AncientK......".to_string();
    let substring: String = seedelf[8..38].to_string();

    match hex_to_ascii(&substring) {
        Ok(ascii) => assert_eq!(ascii, answer),
        Err(err) => println!("Error: {}", err),
    }
}

#[test]
fn test_fail_label_to_ascii2() {
    let seedelf: String =
        "5eed0e1f00000acab00000018732122c62aea887cd16d743c3045e524f019aea".to_string();
    let answer: String = ".........2.,b..".to_string();
    let substring: String = seedelf[8..38].to_string();
    if answer.chars().next() == Some('.') {
        assert_eq!(true, true)
    } else {
        assert_eq!(false, true)
    }

    match hex_to_ascii(&substring) {
        Ok(ascii) => assert_eq!(ascii, answer),
        Err(err) => println!("Error: {}", err),
    }
}
