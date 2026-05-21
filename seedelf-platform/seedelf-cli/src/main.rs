/// Thin binary shim. All logic lives in the `seedelf_cli` library target so
/// integration tests (see `tests/cli/`) can link against the command modules.
#[tokio::main]
async fn main() {
    seedelf_cli::run().await;
}
