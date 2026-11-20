D=calls/review7/l7merge_2
SRC=$D/seedelf-platform/seedelf-core/src/build.rs
cp $SRC $D/build-head.rs
export CARGO_TARGET_DIR=$HOME/.cache/seedelf-calls/r7-target-l7merge_2
cd $D/seedelf-platform
for v in 88e1c84d 1e1b0647; do
  git -C . show $v:seedelf-platform/seedelf-core/src/build.rs > $SRC
  nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 40m cargo test -j 4 --locked -p seedelf-core --test l7merge2_test -- --nocapture > $D/$v.log 2>&1
  echo "$v exit $?" >> $D/$v.log
done
cp $D/build-head.rs $SRC
cmp $SRC seedelf-platform/seedelf-core/src/build.rs && echo restored-head
