#[test]
fn test_split_vector_with_at_most_len_k_elements1() {
    let vec: Vec<u64> = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    let k: usize = 3; // Maximum length of each part

    // Split into chunks of size `k`
    let parts: Vec<Vec<_>> = vec.chunks(k).map(|chunk| chunk.to_vec()).collect();

    // Print the resulting parts
    for (i, part) in parts.iter().enumerate() {
        println!("Part {}: {:?}", i + 1, part);
    }
}

#[test]
fn test_split_vector_with_at_most_len_k_elements2() {
    let vec: Vec<u64> = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let k: usize = 10; // Maximum length of each part

    // Split into chunks of size `k`
    let parts: Vec<Vec<_>> = vec.chunks(k).map(|chunk| chunk.to_vec()).collect();

    // Print the resulting parts
    for (i, part) in parts.iter().enumerate() {
        println!("Part {}: {:?}", i + 1, part);
    }
}

#[test]
fn backwards_loop() {
    let n = 5;
    for i in 0..n {
        println!("Iteration {} {}", i, n - i);
    }
}
