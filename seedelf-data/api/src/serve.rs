//! Serving, and a stop that ends: `axum::serve` with a graceful shutdown
//! waits for every open connection with no deadline, so one request held
//! open (a body that never comes, half a request's head) kept the server
//! from stopping, systemd killed it, and the relay's pools were left with
//! no clean mark (`messaging::Relay::save`). Here a stop waits
//! [`STOP_DEADLINE`] for the requests under way, then drops what's still
//! open and returns, so whatever comes after it (the month's traffic
//! written down, the pools saved and marked clean) always runs, with
//! nothing more coming in.

use std::future::{Future, IntoFuture};
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::{Mutex, PoisonError};
use std::task::{Context, Poll};
use std::time::Duration;

use axum::Router;
use axum::serve::{Listener, ListenerExt};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::{oneshot, watch};

/// How long a stop waits for the requests under way before it drops what's
/// still open. A request is answered in moments, and a submit that waits on
/// home is told "maybe sent" by its wallet when its answer is lost, as for
/// any lost answer. The unit's `TimeoutStopSec` leaves this and the saving
/// after it their time (deploy/edge/seedelf-data-api.service).
pub const STOP_DEADLINE: Duration = Duration::from_secs(10);

/// Serves `app` on `listener` until `signal` completes and the stop after
/// it has ended: at once if nothing is under way, at most
/// [`STOP_DEADLINE`] later. From the signal on no connection is taken, an
/// idle one is closed, and a request under way is answered if it ends in
/// time. When this returns no connection is open and no request is running.
pub async fn serve<L, F>(listener: L, app: Router, signal: F) -> io::Result<()>
where
    L: Listener<Addr = SocketAddr>,
    L::Io: Sync,
    F: Future<Output = ()> + Send + 'static,
{
    let (stop, stopped) = watch::channel(false);
    let (signalled, on_signal) = oneshot::channel::<()>();
    // A tap that does nothing: axum names a connection's address for the
    // edge (`ConnectInfo<SocketAddr>`) from a listener of its own or a
    // tapped one, and this one is neither.
    let listener = Stopping { listener, stopped }.tap_io(|_| {});
    let served = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        signal.await;
        let _ = signalled.send(());
    })
    .into_future();
    let deadline = async move {
        // Without a signal there's no deadline: this waits for good.
        if on_signal.await.is_ok() {
            tokio::time::sleep(STOP_DEADLINE).await;
            // Every connection still open fails its next read or write, and
            // is dropped; `served` ends once the last has gone.
            let _ = stop.send(true);
        }
        std::future::pending::<()>().await
    };
    tokio::select! {
        result = served => result,
        () = deadline => unreachable!("it never ends"),
    }
}

/// A listener whose connections end when the stop's deadline passes.
struct Stopping<L> {
    listener: L,
    stopped: watch::Receiver<bool>,
}

impl<L: Listener> Listener for Stopping<L> {
    type Io = Open<L::Io>;
    type Addr = L::Addr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        let (stream, address) = self.listener.accept().await;
        let mut stopped = self.stopped.clone();
        let open = Open {
            stream,
            // Ready when the deadline has passed, or when the server that
            // would say so is gone.
            stopped: Mutex::new(Box::pin(async move {
                let _ = stopped.wait_for(|stopped| *stopped).await;
            })),
            over: false,
        };
        (open, address)
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.listener.local_addr()
    }
}

/// A connection that's open until the stop's deadline: after it, every read
/// and write fails, which ends the connection whatever it was waiting for.
struct Open<S> {
    stream: S,
    /// In a mutex only to be `Sync`, which axum asks of a connection: it's
    /// polled through `&mut self` alone.
    stopped: Mutex<Pin<Box<dyn Future<Output = ()> + Send>>>,
    /// `stopped` has completed, and isn't polled again.
    over: bool,
}

impl<S> Open<S> {
    /// Whether the stop's deadline has passed. While it hasn't, the task
    /// polling this connection is woken when it does: every read, write and
    /// flush asks, so whatever the connection waits on, it has asked.
    fn over(&mut self, cx: &mut Context<'_>) -> bool {
        if !self.over {
            let stopped = self
                .stopped
                .get_mut()
                .unwrap_or_else(PoisonError::into_inner);
            self.over = stopped.as_mut().poll(cx).is_ready();
        }
        self.over
    }
}

fn dropped() -> io::Error {
    io::Error::new(io::ErrorKind::ConnectionAborted, "the server stopped")
}

impl<S: AsyncRead + Unpin> AsyncRead for Open<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.over(cx) {
            return Poll::Ready(Err(dropped()));
        }
        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Open<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.over(cx) {
            return Poll::Ready(Err(dropped()));
        }
        Pin::new(&mut self.stream).poll_write(cx, buf)
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        if self.over(cx) {
            return Poll::Ready(Err(dropped()));
        }
        Pin::new(&mut self.stream).poll_write_vectored(cx, bufs)
    }

    fn is_write_vectored(&self) -> bool {
        self.stream.is_write_vectored()
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.over(cx) {
            return Poll::Ready(Err(dropped()));
        }
        Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}
