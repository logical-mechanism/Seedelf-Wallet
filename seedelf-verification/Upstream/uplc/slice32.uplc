(program 1.1.0
  (lam bs
    [ (lam s
        [ [ (lam f [ f f ]) (lam self (lam n (force [ [ [ (force (builtin ifThenElse)) [ [ (builtin lessThanEqualsInteger) n ] (con integer 0) ] ] (delay [ (builtin lengthOfByteString) s ]) ] (delay [ [ self self ] [ [ (builtin subtractInteger) n ] (con integer 1) ] ]) ]))) ] (con integer 40) ])
      [ [ [ (builtin sliceByteString) (con integer 0) ] (con integer 32) ] bs ] ]))
