//! Lovejoin's token pools (web wallet chunk 34's 34c): which pools are shown,
//! from the holder every launch uses, and how many deposits each pool's boxes
//! could have come from. The data layer's own copy of the checks the wallet
//! makes (seedelf-core keeps its own; the two are held to shared vectors).

pub mod crowd;
pub mod datum;
pub mod db;
pub mod discovery;
pub mod flat;
pub mod routes;
pub mod standard;
pub mod templates;
