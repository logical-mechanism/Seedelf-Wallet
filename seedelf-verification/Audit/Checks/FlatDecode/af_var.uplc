(program
  1.1.0
  [
    [
      (lam
        i_0
        [
          (lam
            i_1
            [
              (lam
                i_2
                [
                  (lam
                    i_3
                    (lam
                      i_4
                      (lam
                        i_5
                        (force
                          [
                            [
                              [
                                i_3
                                [
                                  (lam
                                    i_6
                                    [
                                      (lam
                                        i_7
                                        [
                                          (lam
                                            i_8
                                            [
                                              (lam
                                                i_9
                                                [
                                                  (lam i_10 (error))
                                                  [ i_1 [ i_0 i_7 ] ]
                                                ]
                                              )
                                              [ i_0 i_7 ]
                                            ]
                                          )
                                          [ i_1 i_6 ]
                                        ]
                                      )
                                      [ i_0 i_6 ]
                                    ]
                                  )
                                  [ i_2 [ (builtin unConstrData) i_5 ] ]
                                ]
                              ]
                              (delay (con unit ()))
                            ]
                            (delay [ (error) (force (error)) ])
                          ]
                        )
                      )
                    )
                  )
                  (force (builtin ifThenElse))
                ]
              )
              (force (force (builtin sndPair)))
            ]
          )
          (force (builtin headList))
        ]
      )
      (force (builtin tailList))
    ]
    (con data (B #acabcafe))
  ]
)
