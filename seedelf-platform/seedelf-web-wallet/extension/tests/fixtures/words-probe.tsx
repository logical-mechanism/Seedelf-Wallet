// words.test.ts reads this file to check its own check: each lowercase
// "seedelf" a person would read is caught, and code is left alone.
const kind = "seedelf";
const key = "seedelf.moveIn.built";

export function Probe() {
  if (kind !== "seedelf") throw new Error("No seedelf with that name.");
  return (
    <section id="panel-seedelf" data-testid="seedelf-balance" title={key}>
      <h2>Your seedelfs</h2>
      <span aria-label="seedelf">Seedelf</span>
      <p>Paying a Seedelf in Seedelf Wallet</p>
      <p>{`in a Seedelf wallet`}</p>
    </section>
  );
}
