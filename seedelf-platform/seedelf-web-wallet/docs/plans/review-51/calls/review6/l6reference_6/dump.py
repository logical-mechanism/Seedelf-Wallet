import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
old = """    let picked_text = match &picked {
        Ok(inputs) => describe_inputs(balance, inputs),
        Err(e) => format!("nothing: {e}"),
    };
"""
new = old + """    println!("PICK {spend:?} over [{}]: {picked_text}", balance.describe());
    {
        let plain = paying.apart(&available, &balance.histories(purpose.clone(), false));
        println!(
            "PLAIN {spend:?} over [{}]: {}",
            balance.describe(),
            match &plain {
                Ok(inputs) => describe_inputs(balance, inputs),
                Err(e) => format!("nothing: {e}"),
            }
        );
    }
"""
assert s.count(old) == 1
s = s.replace(old, new)
open(dst, "w").write(s)
print("wrote", dst)
