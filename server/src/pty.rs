//! PTY 起動・非同期 I/O の低レベルプリミティブ。
//!
//! `nix::pty::forkpty`（glibc の `forkpty(3)` 相当 = openpty + fork + login_tty を
//! 1ステップで行う）を使い、CPython の `os.forkpty()` と同じ土台に乗る。fork 後の
//! 子プロセスは execve 呼び出しまで async-signal-safe な操作（syscall のみ）に
//! 限定しなければならない（マルチスレッドプロセスの fork 直後、他スレッドが保持
//! していたロック — アロケータ含む — は子に引き継がれず、確保しようとした時点で
//! 永久にブロックしうるため）。argv/envp の `CString` 化・`PATH` 探索は必ず fork
//! **前**に完了させ、子プロセスの分岐では既に用意済みのポインタで `execve` する
//! だけにする（Python `os.execvpe` は内部で PATH 探索してから `execve` する実装の
//! ため、この手順は Python と同じ意味論になる）。

use std::ffi::CString;
use std::io;
use std::os::fd::{AsRawFd, OwnedFd, RawFd};

use nix::pty::{ForkptyResult, Winsize};
use nix::unistd::Pid;

/// 子プロセスへ渡す実行環境（Python `attach_tmux_session` の env dict に対応）。
#[derive(Debug)]
pub struct ExecSpec {
    program_path: CString,
    argv: Vec<CString>,
    envp: Vec<CString>,
}

impl ExecSpec {
    /// `program` を `path_env`（"KEY1=v1:KEY2=v2..." 形式ではなく素の PATH 値）で
    /// 探索し、フルパスへ解決してから組み立てる（Python `os.execvpe` の PATH 探索
    /// 相当）。見つからなければ `ErrorKind::NotFound`。
    pub fn resolve(program: &str, args: &[&str], env: &[(&str, &str)]) -> io::Result<Self> {
        let path_env = env
            .iter()
            .find(|(k, _)| *k == "PATH")
            .map(|(_, v)| *v)
            .unwrap_or("/usr/bin:/bin");
        let program_path = resolve_in_path(program, path_env).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("{program}: not found in PATH"),
            )
        })?;
        let argv = std::iter::once(program)
            .chain(args.iter().copied())
            .map(|s| CString::new(s).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e)))
            .collect::<io::Result<Vec<_>>>()?;
        let envp = env
            .iter()
            .map(|(k, v)| {
                CString::new(format!("{k}={v}"))
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))
            })
            .collect::<io::Result<Vec<_>>>()?;
        Ok(Self {
            program_path: CString::new(program_path)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?,
            argv,
            envp,
        })
    }
}

fn resolve_in_path(program: &str, path_env: &str) -> Option<String> {
    if program.contains('/') {
        return std::path::Path::new(program)
            .is_file()
            .then(|| program.to_string());
    }
    for dir in path_env.split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = std::path::Path::new(dir).join(program);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

pub struct PtyChild {
    pub master: OwnedFd,
    pub pid: Pid,
}

/// PTY 上でプロセスを fork+exec する（Python `pty.fork()` + `os.execvpe` 相当）。
/// `spec` は呼び出し前に完全に組み立て済みであること（fork 後の子は syscall のみ）。
pub fn spawn(spec: &ExecSpec, cols: u16, rows: u16) -> io::Result<PtyChild> {
    let winsize = Winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // argv/envp の生ポインタ配列は fork 前に確保しておく（子プロセスでは
    // 追加のメモリ確保を一切行わず、既存ポインタで execve するだけにするため）。
    let mut argv_ptrs: Vec<*const libc::c_char> = spec.argv.iter().map(|s| s.as_ptr()).collect();
    argv_ptrs.push(std::ptr::null());
    let mut envp_ptrs: Vec<*const libc::c_char> = spec.envp.iter().map(|s| s.as_ptr()).collect();
    envp_ptrs.push(std::ptr::null());
    let program_ptr = spec.program_path.as_ptr();

    // SAFETY: 子プロセス分岐は execve 呼び出しまで async-signal-safe な操作
    // （syscall のみ）に限定している。argv_ptrs/envp_ptrs/program_ptr は
    // fork 前に構築済みで、子はそれらのポインタを読むだけ（新規確保なし）。
    match unsafe { nix::pty::forkpty(&winsize, None) } {
        Ok(ForkptyResult::Child) => {
            // ここから execve まではメモリ確保・Rust の Drop 実行を一切行わない。
            unsafe {
                libc::execve(program_ptr, argv_ptrs.as_ptr(), envp_ptrs.as_ptr());
            }
            // execve が返ってきたら失敗。バッファリング等を経由せず直接終了する。
            unsafe { libc::_exit(1) }
        }
        Ok(ForkptyResult::Parent { child, master }) => {
            set_nonblocking(master.as_raw_fd())?;
            Ok(PtyChild { master, pid: child })
        }
        Err(e) => Err(io::Error::from(e)),
    }
}

fn set_nonblocking(fd: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// アタッチ済みクライアント PTY の winsize を更新する（Python `resize_client_pty`）。
/// stale fd 上での ioctl 失敗は無視する（クローズ済み fd でのクラッシュを避けるため）。
pub fn resize(fd: RawFd, cols: u16, rows: u16) {
    let winsize = Winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    unsafe {
        libc::ioctl(fd, libc::TIOCSWINSZ, &winsize);
    }
}

/// master 側を async に読む薄いラッパー。`AsyncFd` は non-blocking fd を要求する
/// （`spawn` が既に O_NONBLOCK を設定済み）。
pub struct AsyncPty {
    inner: tokio::io::unix::AsyncFd<OwnedFd>,
}

impl AsyncPty {
    pub fn new(fd: OwnedFd) -> io::Result<Self> {
        Ok(Self {
            // SAFETY: OwnedFd は有効な fd を所有し、AsyncFd が所有中は閉じも差し替えもしない。
            inner: unsafe { tokio::io::unix::AsyncFd::register(fd)? },
        })
    }

    pub fn as_raw_fd(&self) -> RawFd {
        self.inner.get_ref().as_raw_fd()
    }

    /// 内部の `OwnedFd` を取り出す（クローズ責務を呼び出し側へ返す）。
    pub fn into_inner(self) -> OwnedFd {
        self.inner.into_inner()
    }

    /// 1回分の read。EOF は `Ok(0)`、PTY が刈り取られた後の `EIO` も EOF 扱いにする
    /// （tmux セッション終了時、Linux の PTY マスタは close ではなく EIO を返す）。
    pub async fn read(&self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            let mut guard = self.inner.readable().await?;
            let fd = self.inner.get_ref().as_raw_fd();
            let result = guard.try_io(|_| {
                let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
                if n < 0 {
                    let err = io::Error::last_os_error();
                    if err.raw_os_error() == Some(libc::EIO) {
                        return Ok(0); // 相手側 PTY が閉じた（子プロセス終了）
                    }
                    Err(err)
                } else {
                    Ok(n as usize)
                }
            });
            match result {
                Ok(inner) => return inner,
                Err(_would_block) => continue,
            }
        }
    }

    /// `data` を全バイト書き込むまでリトライする（non-blocking fd での
    /// short write・EAGAIN を吸収する）。生の `libc::write` を1回呼ぶだけだと、
    /// PTY 入力バッファが埋まっている時に一部バイトしか書けない・EAGAIN で
    /// 丸ごと失敗することがあり、長文ペーストが途中で欠落する原因になっていた。
    pub async fn write_all(&self, data: &[u8]) -> io::Result<()> {
        let fd = self.inner.get_ref().as_raw_fd();
        let mut written = 0;
        while written < data.len() {
            let mut guard = self.inner.writable().await?;
            let remaining = &data[written..];
            let result = guard.try_io(|_| {
                let n = unsafe {
                    libc::write(
                        fd,
                        remaining.as_ptr() as *const libc::c_void,
                        remaining.len(),
                    )
                };
                if n < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(n as usize)
                }
            });
            match result {
                Ok(Ok(n)) => written += n,
                Ok(Err(e)) => return Err(e),
                Err(_would_block) => continue,
            }
        }
        Ok(())
    }
}

/// SIGTERM 後に自然終了を待つ猶予（Python の 0.1 秒猶予と同一）。
const TERMINATE_GRACE: std::time::Duration = std::time::Duration::from_millis(100);
/// SIGKILL 後、呼び出し元をブロックして刈り取りを待つ上限。
const REAP_FAST_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(200);
/// バックグラウンドで刈り取りを待ち続ける上限。
const REAP_BACKGROUND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
const REAP_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(5);
const REAP_BACKGROUND_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);

/// 子の終了を刈り取り済みか（終了済みを今回刈り取った、または既に刈り取り済み）。
fn try_reap(pid: Pid) -> bool {
    use nix::sys::wait::{waitpid, WaitPidFlag, WaitStatus};
    !matches!(
        waitpid(pid, Some(WaitPidFlag::WNOHANG)),
        Ok(WaitStatus::StillAlive)
    )
}

fn poll_reap(pid: Pid, timeout: std::time::Duration, interval: std::time::Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if try_reap(pid) {
            return true;
        }
        std::thread::sleep(interval);
    }
    try_reap(pid)
}

/// 子プロセスへ SIGTERM → (未刈り取りなら) SIGKILL の順で送り、刈り取る
/// （Python `close_pty` の後半部分相当）。fd のクローズは呼び出し側の責務
/// （`Arc<AsyncPty>` 等、複数箇所が参照を共有する場合は最後の drop で自然に
/// close されるため、ここでは pid の刈り取りだけを独立して行えるようにする）。
///
/// SIGKILL 後も、未読の出力が溜まった PTY の子は master が閉じられるまで終了が
/// 遅れる（tty のクローズ待ち）。ここで待ち続けると呼び出し元を長くブロックするため、
/// 短い待ちで刈り取れなければバックグラウンドのスレッドで刈り取り切る
/// （放置するとゾンビとして残り続け、プロセス数の上限を食い潰す）。
pub fn terminate(pid: Pid) {
    use nix::sys::signal::{kill, Signal};
    // 既に終了・刈り取り済み（ESRCH）でも waitpid は試す
    let _ = kill(pid, Signal::SIGTERM);
    if try_reap(pid) {
        return;
    }
    std::thread::sleep(TERMINATE_GRACE);
    if try_reap(pid) {
        return;
    }
    let _ = kill(pid, Signal::SIGKILL);
    if poll_reap(pid, REAP_FAST_TIMEOUT, REAP_POLL_INTERVAL) {
        return;
    }
    std::thread::spawn(move || {
        if !poll_reap(pid, REAP_BACKGROUND_TIMEOUT, REAP_BACKGROUND_POLL_INTERVAL) {
            tracing::warn!("child not reaped after SIGKILL pid={pid}");
        }
    });
}

/// PTY をクローズし、子プロセスへ SIGTERM → (未刈り取りなら) SIGKILL の順で送る
/// （Python `close_pty` 相当。fd を排他所有している場合に使う）。
pub fn close(master: OwnedFd, pid: Pid) {
    drop(master); // fd を閉じる
    terminate(pid);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_in_path_finds_known_binary() {
        // /bin/sh か /usr/bin/sh のどちらかは大半の POSIX 環境に存在する
        let resolved = resolve_in_path("sh", "/usr/bin:/bin");
        assert!(resolved.is_some(), "sh should resolve via PATH");
        assert!(resolved.unwrap().ends_with("/sh"));
    }

    #[test]
    fn resolve_in_path_missing_returns_none() {
        assert!(resolve_in_path("no-such-binary-xyz-123", "/usr/bin:/bin").is_none());
    }

    #[test]
    fn resolve_in_path_absolute_checks_existence() {
        assert!(
            resolve_in_path("/bin/sh", "").is_some()
                || resolve_in_path("/usr/bin/sh", "").is_some()
        );
        assert!(resolve_in_path("/no/such/path-xyz", "").is_none());
    }

    /// SIGTERM を無視する子（終了に時間が掛かる tmux クライアント相当）でも、
    /// `terminate` が返った時点で刈り取り済み（ゾンビが残らない）であること。
    /// master は開いたまま呼ぶ（本番の `close_client_bridge` と同じ順序）。
    #[test]
    fn terminate_reaps_child_that_ignores_sigterm() {
        use nix::errno::Errno;
        use nix::sys::wait::{waitpid, WaitPidFlag};
        let spec = ExecSpec::resolve(
            "sh",
            &["-c", "trap '' TERM HUP; while :; do sleep 1; done"],
            &[("PATH", "/usr/bin:/bin")],
        )
        .unwrap();
        let child = spawn(&spec, 80, 24).unwrap();
        let pid = child.pid;
        std::thread::sleep(std::time::Duration::from_millis(300));
        terminate(pid);
        assert_eq!(
            waitpid(pid, Some(WaitPidFlag::WNOHANG)),
            Err(Errno::ECHILD),
            "child must already be reaped by terminate()"
        );
        drop(child.master);
    }

    /// 未読の出力が溜まった PTY の子は、SIGKILL 後も tty のクローズ待ちで終了が遅れうる。
    /// `terminate` は長くブロックせず、遅れて終了した子もゾンビのまま残さないこと
    /// （テスト自身が waitpid しないよう、状態は ps で観測する）。
    #[test]
    fn terminate_eventually_reaps_child_with_unread_output() {
        let spec = ExecSpec::resolve(
            "sh",
            &[
                "-c",
                "trap '' TERM; head -c 2000000 /dev/zero | tr '\\0' x; sleep 1000",
            ],
            &[("PATH", "/usr/bin:/bin")],
        )
        .unwrap();
        let child = spawn(&spec, 80, 24).unwrap();
        let pid = child.pid;
        std::thread::sleep(std::time::Duration::from_millis(500));
        let started = std::time::Instant::now();
        terminate(pid);
        let took = started.elapsed();
        assert!(
            took < std::time::Duration::from_millis(800),
            "terminate must not block long: {took:?}"
        );
        // master を閉じて tty のドレイン待ちを解く（本番ではブリッジ破棄で fd が閉じる）
        drop(child.master);
        let stat = |pid: Pid| -> String {
            let out = std::process::Command::new("ps")
                .args(["-o", "stat=", "-p", &pid.to_string()])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while std::time::Instant::now() < deadline && !stat(pid).is_empty() {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(stat(pid), "", "child must be reaped, not left as zombie");
    }

    #[tokio::test]
    async fn spawn_and_read_echo() {
        let spec = ExecSpec::resolve(
            "sh",
            &["-c", "echo hello-pty"],
            &[("PATH", "/usr/bin:/bin"), ("TERM", "xterm-256color")],
        )
        .unwrap();
        let child = spawn(&spec, 80, 24).unwrap();
        let pid = child.pid;
        let pty = AsyncPty::new(child.master).unwrap();
        let mut collected = Vec::new();
        let mut buf = [0u8; 1024];
        loop {
            match tokio::time::timeout(std::time::Duration::from_secs(5), pty.read(&mut buf)).await
            {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => collected.extend_from_slice(&buf[..n]),
                Ok(Err(e)) => panic!("read error: {e}"),
                Err(_) => panic!("timed out waiting for PTY output"),
            }
        }
        let text = String::from_utf8_lossy(&collected);
        assert!(text.contains("hello-pty"), "output was: {text:?}");
        let _ = nix::sys::wait::waitpid(pid, None);
    }

    /// 大きなペースト（PTY入力バッファを超えるサイズ）を `write_all` で送っても
    /// エラーにならないことを確認する（short write / EAGAIN のリトライ経路）。
    /// echo経由でのバイト完全一致検証は tty line discipline 依存で環境ごとに
    /// 挙動が揺れるため行わず、`write_all` 自体が全バイト分の書き込みを完遂して
    /// `Ok(())` を返すことだけを見る。
    #[tokio::test]
    async fn write_all_completes_for_payload_larger_than_pty_buffer() {
        // stdoutは/dev/nullに捨て、echoに依存しない（catが読み切ることで
        // PTY入力バッファが空くのを確認するのが目的）。
        let spec = ExecSpec::resolve(
            "sh",
            &["-c", "cat > /dev/null"],
            &[("PATH", "/usr/bin:/bin")],
        )
        .unwrap();
        let child = spawn(&spec, 80, 24).unwrap();
        let pid = child.pid;
        let pty = AsyncPty::new(child.master).unwrap();

        let payload = vec![b'A'; 1_000_000];
        tokio::time::timeout(std::time::Duration::from_secs(10), pty.write_all(&payload))
            .await
            .expect("write_all timed out")
            .expect("write_all should succeed");

        let _ = nix::sys::signal::kill(pid, nix::sys::signal::Signal::SIGTERM);
        let _ = nix::sys::wait::waitpid(pid, None);
    }

    #[tokio::test]
    async fn resize_does_not_error_on_live_fd() {
        let spec =
            ExecSpec::resolve("sh", &["-c", "sleep 2"], &[("PATH", "/usr/bin:/bin")]).unwrap();
        let child = spawn(&spec, 80, 24).unwrap();
        resize(child.master.as_raw_fd(), 120, 40);
        close(child.master, child.pid);
    }

    #[test]
    fn missing_program_errors() {
        let err = ExecSpec::resolve("no-such-binary-xyz-123", &[], &[("PATH", "/usr/bin:/bin")])
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn close_reaps_terminated_child() {
        let spec =
            ExecSpec::resolve("sh", &["-c", "exit 0"], &[("PATH", "/usr/bin:/bin")]).unwrap();
        let child = spawn(&spec, 80, 24).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(200));
        close(child.master, child.pid);
    }
}
