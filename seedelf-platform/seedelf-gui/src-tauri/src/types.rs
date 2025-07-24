use seedelf_koios::koios::TxResponse;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum UTxOSide {
    Input,
    Output,
}

#[derive(Debug, Clone, Serialize)]
pub struct TxResponseWithSide {
    pub side: UTxOSide,
    pub tx: TxResponse,
}
