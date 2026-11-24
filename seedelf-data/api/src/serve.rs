//! Serving: the listener, what each connection carries, and a stop that
//! ends.
//!
//! - **The listener** ([`listen`]): every connection it accepts has the
//!   kernel's deadline on what it sends, `TCP_USER_TIMEOUT` of
//!   [`USER_TIMEOUT`]: a connection whose peer takes nothing of what's been
//!   sent it for 60 s is ended, wherever the answer waits (in the kernel or
//!   in the API). That's 60 s without progress, not 60 s an answer: a
//!   reader that takes a little each minute keeps its answer coming. Each
//!   has a small send buffer ([`SEND_BUFFER`]), so a stalled connection
//!   holds little in the kernel, and the listener a backlog of [`BACKLOG`].
//! - **A cap on connections** ([`CONNECTIONS`]): past it, a new connection
//!   is closed at once, and Caddy answers that one request 502, rather than
//!   the server running out of file handles or Caddy out of ports. A
//!   backstop: the edge's totals keep far fewer open (`edge::Caps`).
//! - **A record of each connection** ([`Line`]), which the edge reads
//!   through [`Peer`]: what its socket has taken, so an answer is handed on
//!   only as fast as it's read, and the last answer's place in flight,
//!   parked until the connection asks again or ends (`edge::Sent`).
//! - **A stop that ends**: `axum::serve` with a graceful shutdown waits for
//!   every open connection with no deadline, so one request held open (a
//!   body that never comes, half a request's head) kept the server from
//!   stopping, systemd killed it, and the relay's pools were left with no
//!   clean mark (`messaging::Relay::save`). Here a stop waits
//!   [`STOP_DEADLINE`] for the requests under way, then drops what's still
//!   open and returns, so whatever comes after it (the month's traffic
//!   written down, the pools saved and marked clean) always runs, with
//!   nothing more coming in.

use std::future::{Future, IntoFuture};
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll, Waker};
use std::time::Duration;

use axum::Router;
use axum::extract::connect_info::Connected;
use axum::serve::{IncomingStream, Listener};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpSocket};
use tokio::sync::{OwnedSemaphorePermit, Semaphore, oneshot, watch};

use crate::edge::InFlight;

/// How long a stop waits for the requests under way before it drops what's
/// still open. A request is answered in moments, and a submit that waits on
/// home is told "maybe sent" by its wallet when its answer is lost, as for
/// any lost answer. The unit's `TimeoutStopSec` leaves this and the saving
/// after it their time (deploy/edge/seedelf-data-api.service).
pub const STOP_DEADLINE: Duration = Duration::from_secs(10);

/// A connection whose peer has taken nothing for this long is ended by the
/// kernel (`TCP_USER_TIMEOUT`, which counts unacknowledged data and a
/// window held shut alike on Linux 5.11 and later): Caddy's own `write`
/// timeout, so nothing Caddy would still deliver is cut. A submit waiting
/// on home has nothing unsent meanwhile, so its clock doesn't run.
pub const USER_TIMEOUT: Duration = Duration::from_secs(60);

/// The send buffer asked for each connection; the kernel doubles it, so a
/// stalled connection holds at most 64 KiB in the kernel, against about
/// 258 KB with the kernel's own tuning, and the edge paces the rest
/// (`edge::Sent`).
pub const SEND_BUFFER: u32 = 32 * 1024;

/// Connections the kernel holds for the server before it accepts them.
pub const BACKLOG: u32 = 1024;

/// The most connections open at once [choice]: far above what the edge's
/// totals leave open (`edge::Caps`), and far below the unit's 65,536 file
/// handles and Linux's 28,232 loopback ports. The owner's to tune:
/// `DATA_CONNECTIONS` (config.rs).
pub const CONNECTIONS: usize = 8192;

/// The API's listener on `addr`, as [`USER_TIMEOUT`], [`SEND_BUFFER`] and
/// [`BACKLOG`] say. Every socket it accepts inherits the options.
pub fn listen(addr: SocketAddr) -> io::Result<TcpListener> {
    listen_with(addr, USER_TIMEOUT)
}

/// [`listen`] with another deadline than [`USER_TIMEOUT`]: a test's.
pub fn listen_with(addr: SocketAddr, user_timeout: Duration) -> io::Result<TcpListener> {
    let socket = if addr.is_ipv4() {
        TcpSocket::new_v4()?
    } else {
        TcpSocket::new_v6()?
    };
    socket.set_reuseaddr(true)?;
    socket.set_send_buffer_size(SEND_BUFFER)?;
    socket2::SockRef::from(&socket).set_tcp_user_timeout(Some(user_timeout))?;
    socket.bind(addr)?;
    socket.listen(BACKLOG)
}

/// Serves `app` on `listener` until `signal` completes and the stop after
/// it has ended, with at most [`CONNECTIONS`] open: [`serve_with`].
pub async fn serve<L, F>(listener: L, app: Router, signal: F) -> io::Result<()>
where
    L: Listener<Addr = SocketAddr>,
    L::Io: Sync,
    F: Future<Output = ()> + Send + 'static,
{
    serve_with(listener, app, signal, CONNECTIONS).await
}

/// Serves `app` on `listener`, with at most `connections` open at once,
/// until `signal` completes and the stop after it has ended: at once if
/// nothing is under way, at most [`STOP_DEADLINE`] later. From the signal
/// on no connection is taken, an idle one is closed, and a request under
/// way is answered if it ends in time. When this returns no connection is
/// open and no request is running.
pub async fn serve_with<L, F>(
    listener: L,
    app: Router,
    signal: F,
    connections: usize,
) -> io::Result<()>
where
    L: Listener<Addr = SocketAddr>,
    L::Io: Sync,
    F: Future<Output = ()> + Send + 'static,
{
    let (stop, stopped) = watch::channel(false);
    let (signalled, on_signal) = oneshot::channel::<()>();
    let listener = Stopping {
        listener,
        stopped,
        permits: Arc::new(Semaphore::new(connections)),
    };
    let served = axum::serve(listener, app.into_make_service_with_connect_info::<Peer>())
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

/// One connection's record: what its socket has taken, who waits on that,
/// and its last answer's place in flight, parked.
#[derive(Default)]
pub struct Line {
    /// Bytes the socket has taken, heads and framing included.
    written: AtomicU64,
    /// Woken at the socket's next write: an answer waiting to hand more.
    waiting: Mutex<Option<Waker>>,
    /// The last answer's place in flight, handed whole and not yet read:
    /// until the connection asks again, or ends.
    parked: Mutex<Option<InFlight>>,
}

impl Line {
    /// Bytes the socket has taken.
    pub fn written(&self) -> u64 {
        self.written.load(Ordering::Acquire)
    }

    /// Wakes `waker` at the socket's next write.
    pub fn wake_on_write(&self, waker: &Waker) {
        let mut waiting = held(&self.waiting);
        if !waiting.as_ref().is_some_and(|w| w.will_wake(waker)) {
            *waiting = Some(waker.clone());
        }
    }

    /// Keeps `flying` counted until the connection asks again, or ends.
    pub fn park(&self, flying: InFlight) {
        let before = held(&self.parked).replace(flying);
        drop(before);
    }

    pub(crate) fn wrote(&self, bytes: usize) {
        self.written.fetch_add(bytes as u64, Ordering::AcqRel);
        let waker = held(&self.waiting).take();
        if let Some(waker) = waker {
            waker.wake();
        }
    }

    /// The connection asked again, or ended: what was parked is answered.
    pub(crate) fn asked(&self) {
        let parked = held(&self.parked).take();
        drop(parked);
    }
}

fn held<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What a request knows of its connection (`ConnectInfo<Peer>`): its
/// peer's address, and its [`Line`].
#[derive(Clone)]
pub struct Peer {
    pub addr: SocketAddr,
    pub line: Arc<Line>,
}

impl<L> Connected<IncomingStream<'_, Stopping<L>>> for Peer
where
    L: Listener<Addr = SocketAddr>,
{
    fn connect_info(stream: IncomingStream<'_, Stopping<L>>) -> Self {
        Peer {
            addr: *stream.remote_addr(),
            line: stream.io().line.clone(),
        }
    }
}

/// A listener whose connections end when the stop's deadline passes, at
/// most so many open at once.
pub struct Stopping<L> {
    listener: L,
    stopped: watch::Receiver<bool>,
    permits: Arc<Semaphore>,
}

impl<L: Listener> Listener for Stopping<L> {
    type Io = Open<L::Io>;
    type Addr = L::Addr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            let (stream, address) = self.listener.accept().await;
            // At the cap: closed at once, and the next one taken.
            let Ok(permit) = self.permits.clone().try_acquire_owned() else {
                drop(stream);
                continue;
            };
            let mut stopped = self.stopped.clone();
            let open = Open {
                stream,
                // Ready when the deadline has passed, or when the server that
                // would say so is gone.
                stopped: Mutex::new(Box::pin(async move {
                    let _ = stopped.wait_for(|stopped| *stopped).await;
                })),
                over: false,
                line: Arc::new(Line::default()),
                _permit: permit,
            };
            return (open, address);
        }
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.listener.local_addr()
    }
}

/// A connection that's open until the stop's deadline: after it, every read
/// and write fails, which ends the connection whatever it was waiting for.
/// Its [`Line`] counts what it writes and frees what's parked when it reads.
pub struct Open<S> {
    stream: S,
    /// In a mutex only to be `Sync`, which axum asks of a connection: it's
    /// polled through `&mut self` alone.
    stopped: Mutex<Pin<Box<dyn Future<Output = ()> + Send>>>,
    /// `stopped` has completed, and isn't polled again.
    over: bool,
    line: Arc<Line>,
    /// Its place under [`CONNECTIONS`].
    _permit: OwnedSemaphorePermit,
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

impl<S> Drop for Open<S> {
    fn drop(&mut self) {
        self.line.asked();
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
        let before = buf.filled().len();
        let read = Pin::new(&mut self.stream).poll_read(cx, buf);
        // The connection asks again: its last answer was read.
        if matches!(read, Poll::Ready(Ok(()))) && buf.filled().len() > before {
            self.line.asked();
        }
        read
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
        let wrote = Pin::new(&mut self.stream).poll_write(cx, buf);
        if let Poll::Ready(Ok(bytes)) = wrote {
            self.line.wrote(bytes);
        }
        wrote
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        if self.over(cx) {
            return Poll::Ready(Err(dropped()));
        }
        let wrote = Pin::new(&mut self.stream).poll_write_vectored(cx, bufs);
        if let Poll::Ready(Ok(bytes)) = wrote {
            self.line.wrote(bytes);
        }
        wrote
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
