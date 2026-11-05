(program
  1.1.0
  (lam
    i_0
    (case
      (constr
        0
      (force (builtin tailList))
        (force (builtin headList))
        (force (force (builtin sndPair)))
        (force (force (builtin fstPair)))
        (force (builtin ifThenElse))
      )
    (lam
        i_1
        (lam
          i_2
          (lam
            i_3
            (lam
              i_4
              (lam
                i_5
                (force
                  (case
                    (constr
                      0
                    [
                        (lam
                          i_6
                          [
                            (lam
                              i_7
                              (case
                                (constr
                                  0
                                [ i_2 i_7 ]
                                  [ i_2 [ i_1 i_7 ] ]
                                  [ i_2 i_6 ]
                                )
                              (lam
                                  i_8
                                  (lam
                                    i_9
                                    (lam
                                      i_10
                                      (force
                                        (case
                                          (constr
                                            0
                                          [
                                              [
                                                (builtin equalsInteger)
                                                (con integer 1)
                                              ]
                                              [
                                                i_4
                                                [ (builtin unConstrData) i_9 ]
                                              ]
                                            ]
                                            (delay
                                              [
                                                (lam
                                                  i_11
                                                  [
                                                    [
                                                      (lam
                                                        i_12
                                                        (lam
                                                          i_13
                                                          (con bool False)
                                                        )
                                                      )
                                                      [ i_2 i_11 ]
                                                    ]
                                                    [ i_2 [ i_1 i_11 ] ]
                                                  ]
                                                )
                                                [
                                                  i_3
                                                  [ (builtin unConstrData) i_9 ]
                                                ]
                                              ]
                                            )
                                            (delay (error))
                                          )
                                        i_5
                                        )
                                      )
                                    )
                                  )
                                )
                              )
                            )
                            [ i_1 i_6 ]
                          ]
                        )
                        [ i_3 [ (builtin unConstrData) i_0 ] ]
                      ]
                      (delay (con unit ()))
                      (delay [ (error) (force (error)) ])
                    )
                  i_5
                  )
                )
              )
            )
          )
        )
      )
    )
  )
)
